# rag_service/chat_routes.py
import asyncio
import html as html_escape
import json
import logging
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from queue import Queue as ThreadQueue
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from auth import get_admin_user, get_current_user
from clients import get_embedding, get_groq_client, groq_chat_completion
from config import (
    BASE_URL,
    GROQ_MODEL,
    GROQ_RERANK_MODEL,
    RERANK_CANDIDATES,
    SHARE_EXPIRE_DAYS,
    SITE_TITLE,
    TOP_K,
)
from db import chats_col, delete_chat_and_messages, documents_col, messages_col
from ingest import ingest_pdf_bytes, ingest_url
from models import ChatRequest, ChatResponse, IngestURLRequest, UpdateChatRequest
from rate_limiter import rate_limit_chat
from reranker import rerank
from resilience import CircuitOpenError, groq_breaker
from vectorstore import delete_chunks, search_similar

logger = logging.getLogger(__name__)
router = APIRouter()

# ── constants ─────────────────────────────────────────────────────────────────
_SUMMARY_THRESHOLD = 8   # messages in history before summarisation kicks in
_KEEP_RECENT = 4         # raw turns kept after summarising older ones


# ── helpers ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


_SYSTEM_PROMPT = (
    "You are MeddyCare assistant specializing in diabetic retinopathy and eye health. "
    "You provide helpful, evidence-based general medical information and recommend seeing "
    "an eye specialist when appropriate. Always include a short disclaimer that you are "
    "not making a diagnosis and encourage professional consultation."
)


def _fix_mongo_ids(doc: dict) -> dict:
    """Convert ObjectId / non-string _id fields to strings for JSON serialization."""
    if not doc:
        return doc
    for field in ("_id", "user_id", "chat_id"):
        if field in doc:
            doc[field] = str(doc[field])
    return doc


async def _build_conversation_context(chat_id: str) -> str:
    """
    Load chat history and summarise old turns when a conversation gets long.
    Call this BEFORE saving the current user message to avoid including it.
    """
    try:
        cursor = messages_col.find({"chat_id": chat_id}).sort("timestamp", -1).limit(12)
        recent = list(reversed([m async for m in cursor]))
    except Exception as exc:
        logger.warning("Failed to load conversation history: %s", exc)
        return ""

    if not recent:
        return ""

    if len(recent) <= _SUMMARY_THRESHOLD:
        return "\n".join(
            f"{m['role'].capitalize()}: {m['text']}" for m in recent if m.get("text")
        )

    # Summarise older turns; keep the last _KEEP_RECENT messages raw.
    to_summarise = recent[:-_KEEP_RECENT]
    to_keep = recent[-_KEEP_RECENT:]
    summary_input = "\n".join(
        f"{m['role'].capitalize()}: {m['text'][:300]}"
        for m in to_summarise if m.get("text")
    )
    try:
        resp = await groq_chat_completion(
            model=GROQ_RERANK_MODEL,
            messages=[{
                "role": "user",
                "content": f"Summarise this medical conversation in 2-3 sentences:\n\n{summary_input}",
            }],
            max_tokens=100,
            temperature=0.3,
        )
        summary = resp.choices[0].message.content.strip()
        recent_ctx = "\n".join(
            f"{m['role'].capitalize()}: {m['text']}" for m in to_keep if m.get("text")
        )
        return f"[Earlier conversation summary: {summary}]\n\n{recent_ctx}"
    except Exception as exc:
        logger.warning("Conversation summarisation failed: %s", exc)
        return "\n".join(
            f"{m['role'].capitalize()}: {m['text']}" for m in recent if m.get("text")
        )


async def _generate_suggestions(query: str, answer: str) -> List[str]:
    """Generate 3 follow-up questions using the small model."""
    try:
        resp = await groq_chat_completion(
            model=GROQ_RERANK_MODEL,
            messages=[{
                "role": "user",
                "content": (
                    "Based on this medical Q&A, suggest 3 short follow-up questions "
                    "a patient might ask next. Return ONLY a JSON array of 3 strings, "
                    "no other text.\n\n"
                    f"Q: {query}\n"
                    f"A: {answer[:400]}"
                ),
            }],
            max_tokens=120,
            temperature=0.5,
        )
        raw = resp.choices[0].message.content.strip()
        arrays = re.findall(r"\[.*?\]", raw, re.DOTALL)
        if arrays:
            items = json.loads(arrays[-1])
            return [s.strip() for s in items if isinstance(s, str)][:3]
    except Exception as exc:
        logger.warning("Suggestion generation failed: %s", exc)
    return []


async def _auto_title(chat_id: str, first_message: str) -> Optional[str]:
    """Generate a short title for a new chat, persist it, and return it."""
    try:
        resp = await groq_chat_completion(
            model=GROQ_RERANK_MODEL,
            messages=[{
                "role": "user",
                "content": (
                    "Generate a concise 3-5 word title (MAX 5 words, NO exceptions) "
                    "for this eye-health chatbot conversation. "
                    "'DR' means diabetic retinopathy, never doctor. "
                    f"User's first message: \"{first_message[:120]}\"\n"
                    "Reply with ONLY the title. No quotes, no punctuation, no explanation."
                ),
            }],
            max_tokens=20,
            temperature=0.3,
        )
        title = resp.choices[0].message.content.strip().strip('"\'').rstrip(".")
        # Hard cap: keep at most 5 words
        words = title.split()
        if len(words) > 5:
            title = " ".join(words[:5])
        if title:
            await chats_col.update_one({"_id": chat_id}, {"$set": {"title": title}})
            return title
    except Exception as exc:
        logger.warning("Auto-title generation failed: %s", exc)
    return None


async def _enrich_snippets(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach human-readable doc titles to context snippets (single batch lookup)."""
    doc_ids = list({h.get("doc_id", "") for h in hits if h.get("doc_id")})
    doc_titles: Dict[str, str] = {}
    if doc_ids:
        async for doc in documents_col.find({"_id": {"$in": doc_ids}}, {"title": 1}):
            doc_titles[str(doc["_id"])] = doc.get("title", "Document")
    return [
        {
            "doc_id": h.get("doc_id", ""),
            "doc_title": doc_titles.get(h.get("doc_id", ""), "Document"),
            "text": h.get("text", "")[:1200],
            "score": h.get("rrf_score", h.get("score", 0)),
        }
        for h in hits
        if h.get("doc_id")
    ]


def _build_prompt(system: str, retrieved_text: str, conversation_context: str, message: str) -> str:
    return (
        f"{system}\n\n"
        f"Retrieved content (use only if relevant):\n{retrieved_text}\n\n"
        f"Conversation history:\n{conversation_context}\n\n"
        f"User question:\n{message}\n\n"
        "Answer concisely, cite sources like [doc:ID] if you used retrieved content, "
        "and include a short recommendation about next steps (e.g., see a retina specialist). "
        "Include a brief disclaimer that this is informational only."
    )


# ── document ingestion (admin only) ──────────────────────────────────────────

@router.post("/ingest/url")
async def ingest_url_route(req: IngestURLRequest, _user=Depends(get_admin_user)):
    try:
        result = await ingest_url(str(req.url), title=req.title)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        logger.exception("URL ingest failed")
        raise HTTPException(status_code=500, detail="Ingest failed — check server logs.")
    return {"status": "ingested", **result}


@router.post("/ingest/pdf")
async def ingest_pdf_route(file: UploadFile = File(...), _user=Depends(get_admin_user)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    content = await file.read()
    try:
        result = await ingest_pdf_bytes(content, title=file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        logger.exception("PDF ingest failed")
        raise HTTPException(status_code=500, detail="Ingest failed — check server logs.")
    return {"status": "ingested", **result}


# ── document management ───────────────────────────────────────────────────────

@router.get("/documents")
async def list_documents(skip: int = 0, limit: int = 50, _user=Depends(get_current_user)):
    cursor = documents_col.find({}, {"meta": 0}).sort("added_at", -1).skip(skip).limit(limit)
    docs = [_fix_mongo_ids(d) async for d in cursor]
    return {"count": len(docs), "documents": docs}


@router.get("/documents/{doc_id}")
async def get_document(doc_id: str, _user=Depends(get_current_user)):
    doc = await documents_col.find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return _fix_mongo_ids(doc)


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, _user=Depends(get_admin_user)):
    result = await documents_col.delete_one({"_id": doc_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Document not found.")
    await delete_chunks(doc_id)
    return {"status": "deleted", "doc_id": doc_id}


# ── RAG chat — streaming (primary) ───────────────────────────────────────────

@router.post("/chat/stream")
async def chat_stream_endpoint(req: ChatRequest, user: dict = Depends(rate_limit_chat)):
    """
    SSE streaming chat endpoint.  Events emitted:
      {"type": "meta",   "chat_id": str, "sources": [...]}
      {"type": "delta",  "text": str}
      {"type": "done",   "message_id": str, "suggestions": [...], "title": str|null}
      {"type": "error",  "text": str}
    """
    async def generate():
        now = _utcnow()
        chat_id = req.chat_id or str(uuid.uuid4())
        is_new_chat = not req.chat_id
        top_k = req.top_k or TOP_K

        # ── 1. Retrieval ──────────────────────────────────────────────────────
        try:
            query_embedding = await get_embedding(req.message)
            candidates = await search_similar(
                query_embedding,
                query_text=req.message,
                top_k=RERANK_CANDIDATES,
                candidates=RERANK_CANDIDATES,
            )
            hits = await rerank(req.message, candidates, top_k=top_k)
        except Exception as exc:
            logger.error("Retrieval failed in stream: %s", exc)
            hits = []

        try:
            context_snippets = await _enrich_snippets(hits)
        except Exception as exc:
            logger.warning("_enrich_snippets failed, continuing with empty sources: %s", exc)
            context_snippets = []

        # ── 2. Conversation context (before saving new messages) ──────────────
        conversation_context = await _build_conversation_context(chat_id)

        retrieved_text = (
            "\n\n".join(f"[doc:{s['doc_id']}] {s['text']}" for s in context_snippets)
            if context_snippets else "No retrieved external content."
        )
        prompt = _build_prompt(_SYSTEM_PROMPT, retrieved_text, conversation_context, req.message)

        # ── 3. Persist chat + user message ────────────────────────────────────
        try:
            if is_new_chat:
                await chats_col.insert_one({
                    "_id": chat_id,
                    "user_id": user["_id"],
                    "created_at": now,
                    "updated_at": now,
                })
            await messages_col.insert_one({
                "chat_id": chat_id,
                "user_id": user["_id"],
                "role": "user",
                "text": req.message,
                "timestamp": now,
            })
        except Exception as exc:
            logger.error("Failed to persist chat/message to DB: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'text': 'Failed to save message. Please try again.'})}\n\n"
            return

        # ── 4. Meta event — gives frontend the chat_id and sources immediately ─
        yield f"data: {json.dumps({'type': 'meta', 'chat_id': chat_id, 'sources': context_snippets})}\n\n"

        # ── 5. Stream Groq generation via a background thread ─────────────────
        #    Circuit breaker checked before spawning the thread; retry is not
        #    practical for streaming (partial data already sent), so we rely on
        #    the circuit breaker to fail fast when Groq is down.
        sync_queue: ThreadQueue = ThreadQueue()

        if not groq_breaker.allow_request():
            yield f"data: {json.dumps({'type': 'error', 'text': 'AI service temporarily unavailable. Please try again shortly.'})}\n\n"
            return

        def _run_stream() -> None:
            try:
                stream = get_groq_client().chat.completions.create(
                    model=GROQ_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    stream=True,
                    temperature=0.7,
                )
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    sync_queue.put(delta)
                groq_breaker.record_success()
            except Exception as exc:
                groq_breaker.record_failure()
                sync_queue.put(exc)
            finally:
                sync_queue.put(None)  # sentinel

        thread = threading.Thread(target=_run_stream, daemon=True)
        thread.start()

        full_parts: List[str] = []
        stream_failed = False

        while True:
            item = await asyncio.to_thread(sync_queue.get)
            if item is None:
                break
            if isinstance(item, Exception):
                stream_failed = True
                logger.error("Groq stream error: %s", item)
                yield f"data: {json.dumps({'type': 'error', 'text': 'Generation failed. Please try again.'})}\n\n"
                break
            if item:
                full_parts.append(item)
                yield f"data: {json.dumps({'type': 'delta', 'text': item})}\n\n"

        thread.join(timeout=10)

        if stream_failed:
            return
        if not full_parts:
            logger.warning("Groq returned empty response for chat %s", chat_id)
            yield f"data: {json.dumps({'type': 'error', 'text': 'Empty response from AI model. Please try again.'})}\n\n"
            return

        answer_text = "".join(full_parts)
        reply_time = _utcnow()

        # ── 6. Save assistant message + suggestions + title (concurrently) ────
        async def _save_assistant() -> str:
            result = await messages_col.insert_one({
                "chat_id": chat_id,
                "user_id": user["_id"],
                "role": "assistant",
                "text": answer_text,
                "timestamp": reply_time,
                "meta": {"sources": context_snippets},
            })
            await chats_col.update_one({"_id": chat_id}, {"$set": {"updated_at": reply_time}})
            return str(result.inserted_id)

        if is_new_chat:
            message_id, suggestions, title = await asyncio.gather(
                _save_assistant(),
                _generate_suggestions(req.message, answer_text),
                _auto_title(chat_id, req.message),
            )
        else:
            message_id, suggestions = await asyncio.gather(
                _save_assistant(),
                _generate_suggestions(req.message, answer_text),
            )
            title = None

        # ── 7. Done event ──────────────────────────────────────────────────────
        yield f"data: {json.dumps({'type': 'done', 'message_id': message_id, 'suggestions': suggestions, 'title': title})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── RAG chat — non-streaming fallback ────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest, user: dict = Depends(rate_limit_chat)):
    now = _utcnow()
    chat_id = req.chat_id or str(uuid.uuid4())
    top_k = req.top_k or TOP_K

    # ── Retrieval ─────────────────────────────────────────────────────────────
    try:
        query_embedding = await get_embedding(req.message)
        candidates = await search_similar(
            query_embedding,
            query_text=req.message,
            top_k=RERANK_CANDIDATES,
            candidates=RERANK_CANDIDATES,
        )
        hits = await rerank(req.message, candidates, top_k=top_k)
    except Exception as exc:
        logger.error("Retrieval/rerank failed: %s", exc)
        hits = []

    context_snippets = await _enrich_snippets(hits)

    # ── Conversation context with summarisation ───────────────────────────────
    conversation_context = await _build_conversation_context(chat_id)

    retrieved_text = (
        "\n\n".join(f"[doc:{s['doc_id']}] {s['text']}" for s in context_snippets)
        if context_snippets else "No retrieved external content."
    )
    prompt = _build_prompt(_SYSTEM_PROMPT, retrieved_text, conversation_context, req.message)

    # ── Generation (with retry + circuit breaker) ──────────────────────────
    try:
        response = await groq_chat_completion(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        answer_text = response.choices[0].message.content
    except Exception as exc:
        logger.error("Groq generation failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="I apologize, but I'm having technical difficulties right now. Please try again in a moment.",
        )

    reply_time = _utcnow()

    # ── Persist ───────────────────────────────────────────────────────────────
    if not req.chat_id:
        await chats_col.insert_one(
            {"_id": chat_id, "user_id": user["_id"], "created_at": now, "updated_at": now}
        )
    await messages_col.insert_one(
        {"chat_id": chat_id, "user_id": user["_id"], "role": "user", "text": req.message, "timestamp": now}
    )
    result = await messages_col.insert_one({
        "chat_id": chat_id,
        "user_id": user["_id"],
        "role": "assistant",
        "text": answer_text,
        "timestamp": reply_time,
        "meta": {"sources": context_snippets},
    })
    await chats_col.update_one({"_id": chat_id}, {"$set": {"updated_at": reply_time}})

    # ── Suggestions + auto-title (concurrently) ───────────────────────────────
    if not req.chat_id:
        suggestions, _ = await asyncio.gather(
            _generate_suggestions(req.message, answer_text),
            _auto_title(chat_id, req.message),
        )
    else:
        suggestions = await _generate_suggestions(req.message, answer_text)

    return {
        "chat_id": chat_id,
        "message_id": str(result.inserted_id),
        "answer": answer_text,
        "sources": context_snippets,
        "suggestions": suggestions,
        "timestamp": reply_time,
    }


# ── chat management ───────────────────────────────────────────────────────────

@router.get("/chats")
async def list_chats(user=Depends(get_current_user)):
    cursor = chats_col.find({"user_id": user["_id"]}).sort("updated_at", -1)
    return {"chats": [_fix_mongo_ids(c) async for c in cursor]}


@router.get("/chats/{chat_id}/messages")
async def get_chat_messages(chat_id: str, user=Depends(get_current_user)):
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found.")
    if chat.get("user_id") != user["_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied.")
    cursor = messages_col.find({"chat_id": chat_id}).sort("timestamp", 1)
    return {"messages": [_fix_mongo_ids(m) async for m in cursor]}


@router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, user=Depends(get_current_user)):
    deleted = await delete_chat_and_messages(
        chat_id=chat_id,
        user_id=user["_id"],
        is_admin=(user.get("role") == "admin"),
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Chat not found or access denied.")
    return {"success": True, "chat_id": chat_id}


@router.patch("/chats/{chat_id}")
async def update_chat(chat_id: str, body: UpdateChatRequest, user=Depends(get_current_user)):
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found.")
    if chat.get("user_id") != user["_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied.")

    update: dict = {"updated_at": _utcnow()}
    if body.title is not None:
        if len(body.title.split()) > 10:
            raise HTTPException(status_code=400, detail="Title cannot exceed 10 words.")
        update["title"] = body.title
    if body.archived is not None:
        update["archived"] = body.archived

    await chats_col.update_one({"_id": chat_id}, {"$set": update})
    return {"success": True, "chat_id": chat_id}


# ── share ─────────────────────────────────────────────────────────────────────

@router.post("/chats/{chat_id}/share")
async def share_chat(chat_id: str, request: Request, user=Depends(get_current_user)):
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found.")
    if chat.get("user_id") != user["_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied.")

    shares_col = chats_col.database.get_collection("shared_chats")
    token = secrets.token_urlsafe(16)
    now = _utcnow()
    expires_at = now + timedelta(days=SHARE_EXPIRE_DAYS)

    await shares_col.insert_one({
        "token": token,
        "chat_id": chat_id,
        "owner_id": user["_id"],
        "created_at": now,
        "expires_at": expires_at,
        "title": chat.get("title"),
    })

    try:
        share_url = str(request.url_for("get_shared_chat", token=token))
    except Exception:
        base = BASE_URL or str(request.base_url).rstrip("/")
        share_url = f"{base}/api/rag/s/{token}"

    return {
        "success": True,
        "chat_id": chat_id,
        "shareUrl": share_url,
        "token": token,
        "expires_at": expires_at,
    }


@router.get("/s/{token}", name="get_shared_chat")
async def get_shared_chat(token: str, request: Request, format: Optional[str] = None):
    shares_col = chats_col.database.get_collection("shared_chats")
    share = await shares_col.find_one({"token": token})
    if not share:
        raise HTTPException(status_code=404, detail="Shared link not found.")

    expires_at = share.get("expires_at")
    if isinstance(expires_at, datetime) and expires_at < _utcnow():
        raise HTTPException(status_code=410, detail="Shared link has expired.")

    chat = await chats_col.find_one({"_id": share["chat_id"]})
    if not chat:
        raise HTTPException(status_code=404, detail="Original chat not found.")

    cursor = messages_col.find({"chat_id": share["chat_id"]}).sort("timestamp", 1)
    messages = [_fix_mongo_ids(m) async for m in cursor]
    simplified = [
        {"role": m.get("role"), "text": m.get("text"), "timestamp": m.get("timestamp")}
        for m in messages
    ]

    accept = request.headers.get("accept", "")
    if format == "json" or "application/json" in accept:
        return JSONResponse({
            "success": True,
            "token": token,
            "chat": {
                "_id": share["chat_id"],
                "title": chat.get("title"),
                "created_at": str(chat.get("created_at")),
                "updated_at": str(chat.get("updated_at")),
            },
            "messages": simplified,
            "shared_meta": {
                "created_at": str(share.get("created_at")),
                "expires_at": str(share.get("expires_at")),
                "owner_id": str(share.get("owner_id")),
            },
        })

    return HTMLResponse(content=_build_share_html(chat, simplified, share, request))


# ── share HTML helpers ────────────────────────────────────────────────────────

def _markdown_to_html(s: str) -> str:
    if not s:
        return ""
    s = html_escape.escape(s)
    s = re.sub(r"\*\*\*(.+?)\*\*\*", lambda m: f"<strong><em>{m.group(1)}</em></strong>", s, flags=re.DOTALL)
    s = re.sub(r"\*\*(.+?)\*\*", lambda m: f"<strong>{m.group(1)}</strong>", s, flags=re.DOTALL)
    s = re.sub(r"\*(.+?)\*", lambda m: f"<em>{m.group(1)}</em>", s, flags=re.DOTALL)
    return s.replace("\r\n", "\n").replace("\n", "<br>")


def _build_share_html(chat: dict, messages: list, share: dict, request: Request) -> str:
    title = html_escape.escape(chat.get("title") or f"{SITE_TITLE} chat")
    first_text = messages[0].get("text", "")[:300] if messages else ""
    desc = html_escape.escape(first_text or "Shared MeddyCare conversation")
    site = html_escape.escape(SITE_TITLE)
    share_url = html_escape.escape(str(request.url))

    rows = "".join(
        f"<div style='margin-bottom:14px;'>"
        f"<div style='font-weight:700;margin-bottom:6px;'>{html_escape.escape(m.get('role',''))}</div>"
        f"<div style='white-space:pre-wrap;margin-left:6px;'>{_markdown_to_html(m.get('text') or '')}</div>"
        f"<div style='font-size:12px;color:#666;margin-top:6px;'>{html_escape.escape(str(m.get('timestamp','')))}</div>"
        f"</div>"
        for m in messages
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>{title}</title>
  <meta property="og:title" content="{title}"/>
  <meta property="og:description" content="{desc}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:url" content="{share_url}"/>
  <meta property="og:site_name" content="{site}"/>
  <meta name="twitter:card" content="summary"/>
  <meta name="twitter:title" content="{title}"/>
  <meta name="twitter:description" content="{desc}"/>
  <style>
    body{{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial;background:#f7fafc;color:#111;padding:32px;}}
    .card{{max-width:820px;margin:28px auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.06);}}
    .meta{{color:#666;font-size:13px;margin-bottom:12px;}}
    .title{{font-size:20px;font-weight:600;margin-bottom:8px;}}
    .footer{{margin-top:18px;color:#888;font-size:13px;}}
    em{{font-style:italic;}} strong{{font-weight:700;}}
  </style>
</head>
<body>
  <div class="card">
    <div class="title">{title}</div>
    <div class="meta">
      Shared on {html_escape.escape(str(share.get("created_at")))} &middot;
      Expires {html_escape.escape(str(share.get("expires_at")))}
    </div>
    <div class="messages">{rows or "<em>No messages available.</em>"}</div>
    <div class="footer">Read-only shared conversation from {site}.</div>
  </div>
</body>
</html>"""
