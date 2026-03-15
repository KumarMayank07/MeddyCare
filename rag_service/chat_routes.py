from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from typing import Optional, List
from auth import get_current_user
from models import ChatRequest, ChatResponse, IngestURLRequest
from db import chats_col, messages_col, documents_col, delete_chat_and_messages
from ingest import ingest_url, ingest_pdf_bytes
from vectorstore_mongo import search_similar_local
from config import GOOGLE_GENAI_MODEL, TOP_K
from bson import ObjectId
from google import genai
from datetime import datetime, timedelta
import html as html_escape
import secrets
import config
import pytz
import uuid
import io
import re

router = APIRouter()

# Add this function at the top of chat_routes.py
async def get_embedding(text: str):
    try:
        from google import genai as google_genai
        from config import GOOGLE_GENAI_API_KEY, EMBEDDING_MODEL
        client = google_genai.Client(api_key=GOOGLE_GENAI_API_KEY)
        result = client.models.embed_content(model=EMBEDDING_MODEL, contents=text)
        return result.embeddings[0].values
    except Exception as e:
        print(f"Embedding error: {e}")
        return [0.0] * 3072


def get_client_time(timezone_str: str = 'UTC'):
    """Get current time in client's timezone"""
    try:
        client_tz = pytz.timezone(timezone_str)
        return datetime.now(client_tz).replace(tzinfo=None)
    except:
        # Fallback to UTC if timezone is invalid
        return datetime.utcnow()


# The genai_client is created in main.py at app startup and imported there.
# chat_routes imports it from main at runtime inside functions to avoid circular imports.

def build_system_prompt():
    return (
        "You are MeddyCare assistant specialized in diabetic retinopathy and eye health. "
        "You provide helpful, evidence-based general medical information and recommend seeing an eye specialist when appropriate. "
        "Always include a short disclaimer that you are not making a diagnosis and encourage professional consultation."
    )

# Admin-only: ingest URL
@router.post("/ingest/url")
async def ingest_url_route(req: IngestURLRequest, user=Depends(get_current_user)):
    # Admin-only check
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required to ingest documents.")
    # call ingestion (ingest_url returns dict with doc_id and stats)
    try:
        result = await ingest_url(req.url, title=req.title)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingest URL failed: {str(e)}")
    return {"status": "ingested", **result}

# Admin-only: ingest PDF
@router.post("/ingest/pdf")
async def ingest_pdf_route(file: UploadFile = File(...), user=Depends(get_current_user)):
    # Admin-only check
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required to ingest documents.")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported for upload.")
    try:
        content = await file.read()
        result = await ingest_pdf_bytes(content, title=file.filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingest PDF failed: {str(e)}")
    return {"status": "ingested", **result}

# Public (authenticated): list documents metadata
@router.get("/documents")
async def list_documents(skip: int = 0, limit: int = 50, user=Depends(get_current_user)):
    cursor = documents_col.find({}).sort("added_at", -1).skip(skip).limit(limit)
    docs = [d async for d in cursor]
    # remove heavy fields if any (safe)
    for d in docs:
        d.pop("meta", None)
    return {"count": len(docs), "documents": docs}

@router.get("/documents/{doc_id}")
async def get_document(doc_id: str, user=Depends(get_current_user)):
    doc = await documents_col.find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

# Admin-only: delete document (metadata + vectors)
@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required to delete documents.")
    # remove metadata from Mongo
    delete_result = await documents_col.delete_one({"_id": doc_id})
    # remove all chunks (embeddings) for this document from vector store
    from vectorstore_mongo import chunks_col as _chunks_col
    _chunks_col.delete_many({"doc_id": doc_id})
    return {"status": "deleted", "deleted_count": delete_result.deleted_count}

# Chat endpoint (RAG)
# Replace the chat_endpoint function with this version that has better error handling:

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest, user=Depends(get_current_user)):
    try:
        print(f"DEBUG: Starting chat for user {user['_id']}")
        
        # create or reuse chat
        # Get client timezone from request
        client_timezone = getattr(req, 'timezone', 'UTC')
        current_time = get_client_time(client_timezone)
        
        # Use current_time instead of datetime.utcnow()
        chat_id = req.chat_id or str(uuid.uuid4())
        print(f"DEBUG: Chat ID: {chat_id}")
        
        if not req.chat_id:
            await chats_col.insert_one({
                "_id": chat_id,
                "user_id": user["_id"],
                "created_at": current_time,
                "updated_at": current_time
            })
            print("DEBUG: Created new chat")

        # store user message
        user_msg = {
            "chat_id": chat_id,
            "user_id": user["_id"],
            "role": "user",
            "text": req.message,
            "timestamp": current_time
        }
        await messages_col.insert_one(user_msg)
        print("DEBUG: Stored user message")

        # retrieval from vectorstore
        topk = req.top_k or TOP_K
        print(f"DEBUG: Getting embedding for: {req.message[:50]}...")
        
        try:
            query_embedding = await get_embedding(req.message)
            print(f"DEBUG: Got embedding, length: {len(query_embedding)}")
        except Exception as e:
            print(f"DEBUG: Embedding failed: {e}")
            # fallback: zero vector (matches embedding dimension)
            query_embedding = [0.0] * 3072
        
        try:
            hits = search_similar_local(query_embedding, top_k=topk)
            print(f"DEBUG: Found {len(hits)} similar chunks")
        except Exception as e:
            print(f"DEBUG: Search failed: {e}")
            hits = []

        context_snippets = []
        for h in hits:
            txt = (h.get("text") or "")[:1200]
            context_snippets.append({"doc_id": h.get("doc_id"), "text": txt, "score": h.get("score")})

        # system prompt
        system_prompt = build_system_prompt()

        # gather recent messages (memory)
        try:
            recent_cursor = messages_col.find({"chat_id": chat_id}).sort("timestamp", -1).limit(12)
            recent = [m async for m in recent_cursor]
            recent.reverse()
            conversation_context = "\n".join([f"{m['role'].capitalize()}: {m['text']}" for m in recent if m.get("text")])
            print("DEBUG: Got conversation history")
        except Exception as e:
            print(f"DEBUG: History failed: {e}")
            conversation_context = ""

        # Prepare the final prompt
        retrieved_text = "\n\n".join([f"[doc:{s['doc_id']}] {s['text']}" for s in context_snippets]) if context_snippets else "No retrieved external content."
        final_prompt = f"""{system_prompt}

Retrieved content (use only if relevant):
{retrieved_text}

Conversation history:
{conversation_context}

User question:
{req.message}

Answer concisely, cite sources like [doc:ID] if you used retrieved content, and include a short recommendation about next steps (e.g., see a retina specialist). Include a brief disclaimer that this is informational only.
"""
        
        print("DEBUG: About to call Gemini...")

        # call Gemini
        try:
            from main import genai_client, GOOGLE_GENAI_MODEL
            print("DEBUG: Got genai_client")
            resp = genai_client.models.generate_content(model=GOOGLE_GENAI_MODEL, contents=final_prompt)
            print("DEBUG: Got response from Gemini")
            answer_text = resp.text
            print(f"DEBUG: Response text length: {len(answer_text)}")
        except Exception as e:
            print(f"DEBUG: Gemini call failed: {e}")
            answer_text = "I apologize, but I'm having technical difficulties right now. Please try again in a moment."

        # persist assistant reply
        assistant_msg = {
            "chat_id": chat_id,
            "user_id": user["_id"],
            "role": "assistant",
            "text": answer_text,
            "timestamp": current_time,
            "meta": {"sources": context_snippets}
        }
        await messages_col.insert_one(assistant_msg)
        await chats_col.update_one({"_id": chat_id}, {"$set": {"updated_at": datetime.utcnow()}})
        print("DEBUG: Stored assistant message")

        return {
            "chat_id": chat_id,
            "answer": answer_text,
            "sources": context_snippets,
            "timestamp": datetime.utcnow()
        }
        
    except Exception as e:
        print(f"ERROR in chat_endpoint: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")

def fix_mongo_ids(doc):
    """Convert ObjectId fields to strings for JSON response"""
    if not doc:
        return doc
    doc["_id"] = str(doc["_id"])
    if "user_id" in doc:
        doc["user_id"] = str(doc["user_id"])
    if "chat_id" in doc:
        doc["chat_id"] = str(doc["chat_id"])
    return doc

# Chat list & messages (authenticated)
@router.get("/chats")
async def list_chats(user=Depends(get_current_user)):
    cursor = chats_col.find({"user_id": user["_id"]}).sort("updated_at", -1)
    chats = [fix_mongo_ids(c) async for c in cursor]
    return {"chats": chats}

@router.get("/chats/{chat_id}/messages")
async def get_chat_messages(chat_id: str, user=Depends(get_current_user)):
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if chat.get("user_id") != user["_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied to this chat")

    cursor = messages_col.find({"chat_id": chat_id}).sort("timestamp", 1)
    messages = [fix_mongo_ids(m) async for m in cursor]
    return {"messages": messages}

@router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, user=Depends(get_current_user)):
    deleted = await delete_chat_and_messages(
        chat_id=chat_id,
        user_id=user["_id"],
        is_admin=(user.get("role") == "admin")
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Chat not found or access denied")
    return {"success": True, "chat_id": chat_id}

@router.patch("/chats/{chat_id}")
async def update_chat(chat_id: str, request: dict, user=Depends(get_current_user)):
    """Update chat properties like title or archived status"""
    
    # Find the chat
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    
    # Authorization: only owner or admin can update
    if chat.get("user_id") != user["_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied to this chat")
    
    # Prepare update data
    update_data = {"updated_at": datetime.utcnow()}
    
    # Handle title update (with word limit)
    if "title" in request:
        title = request["title"].strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        
        # Apply 10-word limit
        words = title.split()
        if len(words) > 10:
            raise HTTPException(status_code=400, detail="Title cannot exceed 10 words")
        
        update_data["title"] = title
    
    # Handle archive status
    if "archived" in request:
        update_data["archived"] = bool(request["archived"])
    
    # Update the chat
    result = await chats_col.update_one(
        {"_id": chat_id}, 
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    
    return {"success": True, "chat_id": chat_id, "updated": update_data}

@router.post("/chats/{chat_id}/share")
async def share_chat(chat_id: str, request: Request, user=Depends(get_current_user)):
    """Generate a short shareable link for a chat (owner or admin only)."""
    # Find the chat
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # Authorization: only owner or admin can create a share
    if chat.get("user_id") != user["_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied to share this chat")

    # Use the same DB as chats_col to create a shared_chats collection
    shares_col = chats_col.database.get_collection("shared_chats")

    # generate token (short, URL-safe)
    token = secrets.token_urlsafe(8)  # short human-usable token

    now = datetime.utcnow()
    expire_days = getattr(config, "SHARE_EXPIRE_DAYS", 7)
    expires_at = now + timedelta(days=expire_days)

    share_doc = {
        "token": token,
        "chat_id": chat_id,
        "owner_id": user["_id"],
        "created_at": now,
        "expires_at": expires_at,
        "title": chat.get("title"),
        "chat_updated_at": chat.get("updated_at", now),
    }

    # write share doc
    await shares_col.insert_one(share_doc)

    # Build URL using url_for so router prefixes are included correctly.
    try:
        share_url = str(request.url_for("get_shared_chat", token=token))
    except Exception:
        # fallback: prefer config.BASE_URL if set, else derive from request.base_url
        base_url = getattr(config, "BASE_URL", None)
        if not base_url:
            base_url = str(request.base_url).rstrip("/")
        share_url = f"{base_url}/s/{token}"

    return {
        "success": True,
        "chat_id": chat_id,
        "shareUrl": share_url,
        "token": token,
        "expires_at": expires_at,
        "message": "Share link generated successfully"
    }


@router.get("/s/{token}")
async def get_shared_chat(token: str, request: Request, format: str = None):
    """
    Public read-only route for shared chat previews.

    - Returns HTML (with Open Graph meta tags) for browsers and link preview crawlers.
    - Returns JSON if the client asks for JSON (Accept: application/json) or ?format=json.
    """
    shares_col = chats_col.database.get_collection("shared_chats")
    share = await shares_col.find_one({"token": token})
    if not share:
        raise HTTPException(status_code=404, detail="Shared item not found")

    # check expiry
    expires_at = share.get("expires_at")
    if expires_at:
        try:
            from datetime import datetime
            if isinstance(expires_at, str):
                exp_dt = datetime.fromisoformat(expires_at)
            else:
                exp_dt = expires_at
            if datetime.utcnow() > exp_dt:
                raise HTTPException(status_code=410, detail="Shared link expired")
        except Exception:
            # if parsing fails, continue (safe fallback)
            pass

    chat_id = share.get("chat_id")
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Original chat not found")

    # Fetch messages (limit to reasonable number)
    cursor = messages_col.find({"chat_id": chat_id}).sort("timestamp", 1)
    messages = [fix_mongo_ids(m) async for m in cursor]

    simplified = [
        {"role": m.get("role"), "text": m.get("text"), "timestamp": m.get("timestamp")}
        for m in messages
    ]

    # If client explicitly wants JSON (or Accept header prefers JSON), return JSON
    accept = request.headers.get("accept", "")
    if format == "json" or "application/json" in accept:
        return JSONResponse({
            "success": True,
            "token": token,
            "chat": {
                "_id": chat_id,
                "title": chat.get("title"),
                "created_at": chat.get("created_at"),
                "updated_at": chat.get("updated_at"),
            },
            "messages": simplified,
            "shared_meta": {
                "created_at": share.get("created_at"),
                "expires_at": share.get("expires_at"),
                "owner_id": str(share.get("owner_id")),
            },
        })

    # Convert Markdown-like bold/italic to safe HTML for preview
    def markdown_like_to_html(s: str) -> str:
        if not s:
            return ""
        # Escape first to avoid XSS, we'll insert safe tags afterwards
        s_esc = html_escape.escape(s)

        # 1) Handle special block: ***  *inner*  ***  (with optional whitespace/newlines)
        #    Turn into <strong><em>inner</em></strong>
        s_esc = re.sub(
            r'\*\*\*\s*\*(.+?)\*\s*\*\*\*',
            lambda m: f"<strong><em>{m.group(1)}</em></strong>",
            s_esc,
            flags=re.DOTALL,
        )

        # 2) Handle general triple-star: ***content*** => <strong>content</strong>
        s_esc = re.sub(
            r'\*\*\*(.+?)\*\*\*',
            lambda m: f"<strong>{m.group(1)}</strong>",
            s_esc,
            flags=re.DOTALL,
        )

        # 3) Handle double-star: **content** => <strong>content</strong>
        s_esc = re.sub(
            r'\*\*(.+?)\*\*',
            lambda m: f"<strong>{m.group(1)}</strong>",
            s_esc,
            flags=re.DOTALL,
        )

        # 4) Handle single-star: *content* => <em>content</em>
        s_esc = re.sub(
            r'\*(.+?)\*',
            lambda m: f"<em>{m.group(1)}</em>",
            s_esc,
            flags=re.DOTALL,
        )

        # 5) Convert newlines to <br> for HTML display
        s_esc = s_esc.replace("\r\n", "\n").replace("\n", "<br>")

        return s_esc

    # Build messages HTML with converted markup
    messages_html = ""
    for m in simplified:
        role = html_escape.escape(m.get("role", ""))
        text_raw = m.get("text", "") or ""
        text_html = markdown_like_to_html(text_raw)
        ts = html_escape.escape(str(m.get("timestamp", "")))
        # small styling—keeps it compact for previews
        messages_html += (
            f"<div style='margin-bottom:14px;'>"
            f"<div style='font-weight:700;margin-bottom:6px;'>{role.capitalize()}</div>"
            f"<div style='white-space:pre-wrap;margin-left:6px;'>{text_html}</div>"
            f"<div style='font-size:12px;color:#666;margin-top:6px;'>{ts}</div>"
            f"</div>"
        )

    # Build HTML page with Open Graph meta for previews
    site_title = getattr(config, "SITE_TITLE", "MeddyCare")
    share_url = str(request.url)
    first_text = ""
    if len(simplified) > 0:
        first_text = simplified[0].get("text", "")[:300]
    escaped_title = html_escape.escape(chat.get("title") or f"{site_title} chat")
    escaped_desc = html_escape.escape(first_text or "Shared MeddyCare conversation")
    escaped_site = html_escape.escape(site_title)

    html_content = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>{escaped_title}</title>

  <!-- Open Graph / Link preview -->
  <meta property="og:title" content="{escaped_title}" />
  <meta property="og:description" content="{escaped_desc}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="{html_escape.escape(share_url)}" />
  <meta property="og:site_name" content="{escaped_site}" />

  <!-- Twitter card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="{escaped_title}" />
  <meta name="twitter:description" content="{escaped_desc}" />

  <style>
    body{{font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; background:#f7fafc; color:#111; padding:32px;}}
    .card{{max-width:820px;margin:28px auto;background:white;padding:20px;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);}}
    .meta{{color:#666;font-size:13px;margin-bottom:12px;}}
    .title{{font-size:20px;font-weight:600;margin-bottom:8px;}}
    .messages{{margin-top:12px;}}
    .footer{{margin-top:18px;color:#888;font-size:13px;}}
    em{{font-style:italic;color:#111;}}
    strong{{font-weight:700;color:#111;}}
  </style>
</head>
<body>
  <div class="card">
    <div class="title">{escaped_title}</div>
    <div class="meta">Shared on {html_escape.escape(str(share.get("created_at")))} · Expires {html_escape.escape(str(share.get("expires_at")))}</div>

    <div class="messages">
      {messages_html or "<em>No messages available.</em>"}
    </div>

    <div class="footer">This is a read-only shared conversation from {escaped_site}. For more, visit the app.</div>
  </div>
</body>
</html>
"""
    return HTMLResponse(content=html_content, status_code=200)