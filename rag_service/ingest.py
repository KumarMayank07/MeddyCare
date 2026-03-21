# rag_service/ingest.py
import asyncio
import hashlib
import io
import logging
import re
import uuid
from datetime import datetime, timezone

import trafilatura

from pypdf import PdfReader

from clients import get_batch_embeddings
from config import CHUNK_OVERLAP, CHUNK_SIZE, MAX_PDF_MB
from db import documents_col
from vectorstore import upsert_chunks

logger = logging.getLogger(__name__)


# ── Text utilities ─────────────────────────────────────────────────────────────

def clean_text(text: str) -> str:
    """Remove surrogate and other problematic Unicode characters."""
    return text.encode("utf-8", errors="ignore").decode("utf-8", errors="ignore") if text else ""


def _merge_into_chunks(
    segments: list[str],
    chunk_size: int,
    overlap: int,
) -> list[str]:
    """
    Merge text segments into chunks of at most chunk_size words.
    Starts each new chunk with the last `overlap` words of the previous
    chunk so context is never lost at boundaries.
    """
    chunks: list[str] = []
    buffer: list[str] = []
    buffer_wc = 0

    for seg in segments:
        seg_wc = len(seg.split())
        if buffer_wc + seg_wc > chunk_size and buffer:
            chunk_text = " ".join(buffer)
            chunks.append(chunk_text.strip())
            # Carry forward the last `overlap` words as context seed
            overlap_words = chunk_text.split()[-overlap:] if overlap else []
            buffer = [" ".join(overlap_words), seg] if overlap_words else [seg]
            buffer_wc = len(overlap_words) + seg_wc
        else:
            buffer.append(seg)
            buffer_wc += seg_wc

    if buffer:
        chunks.append(" ".join(buffer).strip())

    return [c for c in chunks if c.strip()]


def recursive_chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[dict]:
    """
    Industry-grade recursive text splitter.

    Splits at semantic boundaries in priority order:
      1. Paragraph  (\n\n)  — strongest natural break
      2. Line       (\n)    — softer break
      3. Sentence   (. ! ?) — sentence boundary
      4. Word       ( )     — last resort hard split

    Each level is tried in turn; if a segment is still larger than
    chunk_size after splitting, the next finer level is applied
    recursively.  Overlap is baked in during the merge step.
    """

    def _split_text(text: str, separators: list[str]) -> list[str]:
        """Recursively split text, returning chunks of ≤ chunk_size words."""
        if len(text.split()) <= chunk_size:
            return [text.strip()] if text.strip() else []

        for i, sep in enumerate(separators):
            if sep == r"SENTENCE":
                # Sentence split using regex — keeps punctuation attached
                parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text) if p.strip()]
            elif sep == " ":
                # Hard word-level split with overlap
                words = text.split()
                step = max(chunk_size - overlap, 1)
                return [" ".join(words[j : j + chunk_size]) for j in range(0, len(words), step)]
            else:
                parts = [p.strip() for p in text.split(sep) if p.strip()]

            if len(parts) <= 1:
                continue  # separator not useful here, try next

            # Merge small parts together, recurse on oversized parts
            merged = _merge_into_chunks(parts, chunk_size, overlap)
            final: list[str] = []
            remaining_seps = separators[i + 1 :]
            for chunk in merged:
                if len(chunk.split()) > chunk_size and remaining_seps:
                    final.extend(_split_text(chunk, remaining_seps))
                else:
                    final.append(chunk)
            return final

        # Fallback: word-level split (should rarely reach here)
        words = text.split()
        step = max(chunk_size - overlap, 1)
        return [" ".join(words[j : j + chunk_size]) for j in range(0, len(words), step)]

    separators = ["\n\n", "\n", r"SENTENCE", " "]
    raw_chunks = _split_text(text, separators)
    return [{"chunk_id": i, "text": c} for i, c in enumerate(raw_chunks) if c.strip()]


# ── Shared storage helper ──────────────────────────────────────────────────────

async def _store_document(
    *,
    text: str,
    title: str,
    source: str,
    doc_type: str,
    metadata: dict | None,
) -> dict:
    chunks = recursive_chunk_text(text)
    if not chunks:
        raise ValueError("No text content could be extracted from the document.")

    # ── Duplicate detection — skip if identical content already ingested ──────
    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    existing = await documents_col.find_one(
        {"content_hash": content_hash}, {"_id": 1, "title": 1}
    )
    if existing:
        raise ValueError(
            f"Duplicate document — this content was already ingested as "
            f"\"{existing.get('title', 'unknown')}\" (ID: {existing['_id']}). "
            f"Skipping to avoid polluting the knowledge base."
        )

    doc_id = str(uuid.uuid4())

    # Batch embed ALL chunks in a single API call — much faster than one-by-one
    chunk_texts = [c["text"] for c in chunks]
    embeddings = await get_batch_embeddings(chunk_texts)

    await upsert_chunks(doc_id, chunk_texts, embeddings)

    await documents_col.insert_one(
        {
            "_id": doc_id,
            "title": title,
            "source": source,
            "type": doc_type,
            "chunks": len(chunks),
            "content_hash": content_hash,
            "added_at": datetime.now(timezone.utc),
            "meta": metadata or {},
        }
    )
    return {"doc_id": doc_id, "chunks": len(chunks), "vectors_added": len(embeddings)}


# ── Public ingestion functions ─────────────────────────────────────────────────

async def ingest_url(
    url: str, title: str | None = None, metadata: dict | None = None
) -> dict:
    url_str = str(url)

    # trafilatura handles HTTP fetch + extracts only main article content
    # (strips nav/footer/ads). Works across NIH, Mayo, MedlinePlus, WebMD etc.
    def _fetch_and_extract() -> tuple[str, str]:
        downloaded = trafilatura.fetch_url(url_str)
        if not downloaded:
            raise ValueError("Failed to fetch URL. Site may be blocking scrapers.")
        extracted = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
            favor_recall=True,   # extract more content, better for medical articles
        )
        meta = trafilatura.extract_metadata(downloaded)
        page_title = (meta.title if meta and meta.title else None) or url_str
        return extracted or "", page_title

    try:
        raw_text, page_title = await asyncio.wait_for(
            asyncio.to_thread(_fetch_and_extract),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        raise ValueError("URL fetch timed out after 30 seconds. The site may be slow or blocking scrapers.")
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Failed to fetch URL: {exc}")

    text = clean_text(raw_text)

    if len(text) < 100:
        raise ValueError(
            "Insufficient content extracted from URL. "
            "The page may be empty or require JavaScript to render."
        )

    if not title:
        title = page_title  # already extracted by _fetch_and_extract above
    title = clean_text(title)

    return await _store_document(
        text=text, title=title, source=url_str, doc_type="url", metadata=metadata
    )


async def ingest_pdf_bytes(
    file_bytes: bytes, title: str | None = None, metadata: dict | None = None
) -> dict:
    if len(file_bytes) > MAX_PDF_MB * 1024 * 1024:
        raise ValueError(f"PDF exceeds the {MAX_PDF_MB} MB size limit.")

    reader = PdfReader(io.BytesIO(file_bytes))
    pages = []
    for i, page in enumerate(reader.pages):
        try:
            pages.append(clean_text(page.extract_text() or ""))
        except Exception as exc:
            logger.warning("Could not extract page %d: %s", i, exc)

    return await _store_document(
        text="\n".join(pages),
        title=clean_text(title or "PDF Document"),
        source="uploaded_pdf",
        doc_type="pdf",
        metadata=metadata,
    )
