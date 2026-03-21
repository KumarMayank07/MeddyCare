# rag_service/reranker.py
"""
Groq-based re-ranker (second-stage retrieval).

Why re-rank?
────────────
  Stage 1 (hybrid search) retrieves the top-20 CANDIDATES — fast, broad recall.
  Stage 2 (re-ranking)    scores each candidate against the query precisely —
  slower but much more accurate, especially for nuanced medical questions.

How it works:
  • Uses llama-3.1-8b-instant (Groq free tier, 20,000 TPM budget — separate from
    the 70b generation model's 6,000 TPM budget so reranking doesn't eat into it).
  • Sends ONE Groq call with the query + top-10 candidate passages (100 words each).
  • Model returns a relevance score (0-10) for each passage as a JSON array.
  • Passages are re-ordered by score → final top-K returned.

Fallback:
  If the Groq call fails or the response can't be parsed, the original
  hybrid-search order (RRF score) is returned unchanged (safe degradation).

Retry:
  The Groq call is made via `groq_chat_completion()` which includes automatic
  retry with exponential backoff (3 attempts) and circuit-breaker protection.
"""
import json
import logging
import re
from typing import Any, Dict, List

from clients import groq_chat_completion
from config import GROQ_RERANK_MODEL

logger = logging.getLogger(__name__)


def _rrf_order(candidates: List[Dict[str, Any]], top_k: int) -> List[Dict[str, Any]]:
    """Sort by rrf_score (set by hybrid search fusion), fall back to raw score."""
    return sorted(
        candidates,
        key=lambda c: c.get("rrf_score", c.get("score", 0)),
        reverse=True,
    )[:top_k]


# How many candidates to send to the reranker — capped to save tokens.
# (The caller may pass up to RERANK_CANDIDATES=20; we only score the top 10.)
_RERANK_WINDOW = 10
# Max words per passage sent to the reranker — keeps prompt small.
_PASSAGE_WORDS = 100


async def rerank(
    query: str,
    candidates: List[Dict[str, Any]],
    top_k: int,
) -> List[Dict[str, Any]]:
    """
    Re-rank candidate chunks by their relevance to the query using Groq.

    Args:
        query:      The user's original question.
        candidates: Chunks from hybrid search (up to RERANK_CANDIDATES).
        top_k:      How many to return after re-ranking.

    Returns:
        The top_k most relevant chunks in re-ranked order.
    """
    if not candidates:
        return []
    # No point re-ranking if we already have ≤ top_k results
    if len(candidates) <= top_k:
        return candidates

    # Only score the top _RERANK_WINDOW candidates to keep the prompt small.
    rerank_candidates = candidates[:_RERANK_WINDOW]

    # Truncate each passage to _PASSAGE_WORDS words — scoring relevance doesn't
    # need the full text and this keeps the reranker call cheap.
    passages = "\n".join(
        f"[{i}] {' '.join(c['text'].split()[:_PASSAGE_WORDS])}"
        for i, c in enumerate(rerank_candidates)
    )

    prompt = (
        f"You are a relevance scoring engine.\n"
        f"Query: {query}\n\n"
        f"Rate how relevant each passage is for answering the query.\n"
        f"Score from 0 (irrelevant) to 10 (perfectly answers the query).\n\n"
        f"Passages:\n{passages}\n\n"
        f"Respond with ONLY a JSON array of integer scores, one per passage, in order.\n"
        f"Example for 3 passages: [8, 2, 9]\n"
        f"Scores:"
    )

    # ── Groq LLM re-ranking (with retry + circuit breaker via groq_chat_completion) ──
    try:
        response = await groq_chat_completion(
            model=GROQ_RERANK_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=64,
        )
        raw = response.choices[0].message.content.strip()
        numeric_arrays = re.findall(
            r"\[\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*\]", raw
        )
        if not numeric_arrays:
            logger.warning("Re-ranker: no numeric array in response, using RRF order")
            return _rrf_order(candidates, top_k)
        scores: List[float] = json.loads(numeric_arrays[-1])
        if len(scores) != len(rerank_candidates):
            logger.warning(
                "Re-ranker: score count mismatch (%d scores for %d candidates)",
                len(scores), len(rerank_candidates),
            )
            return _rrf_order(candidates, top_k)
        ranked = sorted(zip(rerank_candidates, scores), key=lambda pair: pair[1], reverse=True)
        result = [c for c, _ in ranked[:top_k]]
        logger.info(
            "Re-ranked %d candidates → top %d  (top score: %.1f)",
            len(rerank_candidates), top_k, max(scores) if scores else 0,
        )
        return result
    except Exception as exc:
        logger.warning("Re-ranking failed, returning hybrid-search order: %s", exc)
        return _rrf_order(candidates, top_k)
