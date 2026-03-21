# rag_service/clients.py
"""
Singleton Google GenAI + Groq clients with retry and circuit-breaker protection.

`get_genai_client()` — returns the process-wide Google GenAI client.
`get_groq_client()`  — returns the process-wide Groq client.
`get_embedding(text)`        — single text → list[float]  (with retry + circuit breaker)
`get_batch_embeddings(texts)` — batch     → list[list[float]]
"""
import asyncio
import logging
from functools import lru_cache

from google import genai
from groq import Groq

from config import EMBEDDING_MODEL, GOOGLE_GENAI_API_KEY, GROQ_API_KEY
from resilience import (
    CircuitOpenError,
    embeddings_breaker,
    groq_breaker,
    with_retry,
)

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_genai_client() -> genai.Client:
    """Return the process-wide Google GenAI client (used for embeddings only)."""
    return genai.Client(api_key=GOOGLE_GENAI_API_KEY)


@lru_cache(maxsize=1)
def get_groq_client() -> Groq:
    """Return the process-wide Groq client (used for answer generation)."""
    return Groq(api_key=GROQ_API_KEY)


# ── Embedding calls (with retry + circuit breaker) ───────────────────────────

@with_retry(max_attempts=3)
async def get_embedding(text: str) -> list[float]:
    """Generate embedding for a single text. Retries on transient failure."""
    if not embeddings_breaker.allow_request():
        raise CircuitOpenError(embeddings_breaker.name)
    try:
        client = get_genai_client()
        result = await asyncio.to_thread(
            client.models.embed_content, model=EMBEDDING_MODEL, contents=text
        )
        embeddings_breaker.record_success()
        return result.embeddings[0].values
    except CircuitOpenError:
        raise
    except Exception as exc:
        embeddings_breaker.record_failure()
        raise exc


@with_retry(max_attempts=3)
async def get_batch_embeddings(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    """
    Generate embeddings for multiple texts, batching to stay within API limits.

    Gemini's embed_content API accepts up to ~2048 texts per call, but we cap
    at 100 per batch to keep latency predictable and avoid rate-limit errors
    on large document ingestions.

    Returns embeddings in the same order as the input list.
    """
    if not texts:
        return []
    if not embeddings_breaker.allow_request():
        raise CircuitOpenError(embeddings_breaker.name)
    try:
        client = get_genai_client()
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            result = await asyncio.to_thread(
                client.models.embed_content, model=EMBEDDING_MODEL, contents=batch
            )
            all_embeddings.extend(e.values for e in result.embeddings)
        embeddings_breaker.record_success()
        return all_embeddings
    except CircuitOpenError:
        raise
    except Exception as exc:
        embeddings_breaker.record_failure()
        raise exc


# ── Groq generation helpers (with retry + circuit breaker) ───────────────────

@with_retry(max_attempts=3)
async def groq_chat_completion(*, model: str, messages: list, **kwargs):
    """
    Groq chat completion with retry + circuit breaker.
    Returns the full completion response object.
    """
    if not groq_breaker.allow_request():
        raise CircuitOpenError(groq_breaker.name)
    try:
        client = get_groq_client()
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=model,
            messages=messages,
            **kwargs,
        )
        groq_breaker.record_success()
        return response
    except CircuitOpenError:
        raise
    except Exception as exc:
        groq_breaker.record_failure()
        raise exc
