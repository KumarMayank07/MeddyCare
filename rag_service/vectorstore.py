# rag_service/vectorstore.py
"""
Hybrid vector store: Qdrant (semantic) + BM25 (keyword) + RRF fusion.

Architecture
────────────
  Ingestion:
    chunks + embeddings ──► Qdrant collection  (dense vectors, O(1) ANN search)
    chunk texts         ──► MongoDB rds_chunks  (for BM25 index rebuild)

  Retrieval (per query):
    1. Qdrant ANN search    → top-N semantic hits   (meaning-based)
    2. BM25 keyword search  → top-N keyword hits    (exact-word-based)
    3. RRF fusion           → merged ranked list    (best of both worlds)

All public functions are async — blocking pymongo / qdrant calls run in
a thread-pool via asyncio.to_thread so the event loop stays responsive.
"""
import asyncio
import logging
import uuid
from typing import Any, Dict, List, Optional

import certifi
import numpy as np
import threading
from pymongo import MongoClient
from qdrant_client import QdrantClient
from qdrant_client.http import models as qm
from rank_bm25 import BM25Okapi

from config import (
    EMBEDDING_DIM,
    MONGODB_DB,
    MONGODB_URI,
    QDRANT_API_KEY,
    QDRANT_COLLECTION,
    QDRANT_HOST,
)

logger = logging.getLogger(__name__)

# ── Qdrant client ──────────────────────────────────────────────────────────────
_qdrant = QdrantClient(
    url=QDRANT_HOST,
    api_key=QDRANT_API_KEY or None,
    timeout=30,
)

# ── MongoDB (stores chunk texts for BM25 index) ───────────────────────────────
_mongo = MongoClient(
    MONGODB_URI,
    tlsCAFile=certifi.where(),
    serverSelectionTimeoutMS=5000,
    socketTimeoutMS=10000,
    maxPoolSize=10,
)
_mongo_db = _mongo[MONGODB_DB]
chunks_col = _mongo_db["rds_chunks"]


# ── BM25 in-memory index ──────────────────────────────────────────────────────
# Built from all stored chunk texts; rebuilt whenever chunks are added/deleted.

class _BM25Index:
    """Thread-safe in-memory BM25 index backed by MongoDB chunk texts."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._index: Optional[BM25Okapi] = None
        self._chunk_ids: List[str] = []
        self._chunk_data: List[Dict[str, Any]] = []  # {chunk_id, doc_id, text}

    def rebuild(self) -> None:
        docs = list(chunks_col.find({}, {"chunk_id": 1, "doc_id": 1, "text": 1, "_id": 0}))
        with self._lock:
            if not docs:
                self._index = None
                self._chunk_ids = []
                self._chunk_data = []
                return
            self._chunk_data = docs
            self._chunk_ids = [d["chunk_id"] for d in docs]
            tokenized = [d["text"].lower().split() for d in docs]
            self._index = BM25Okapi(tokenized)
        logger.info("BM25 index rebuilt with %d chunks", len(docs))

    def search(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        with self._lock:
            if self._index is None or not self._chunk_ids:
                return []
            scores = self._index.get_scores(query.lower().split())
            chunk_data_snapshot = self._chunk_data[:]
        top_idx = np.argsort(scores)[::-1][:top_k]
        results = []
        for idx in top_idx:
            if scores[idx] > 0:
                d = chunk_data_snapshot[idx]
                results.append(
                    {
                        "chunk_id": d["chunk_id"],
                        "doc_id": d.get("doc_id", ""),
                        "text": d["text"],
                        "score": float(scores[idx]),
                        "meta": d.get("meta", {}),
                    }
                )
        return results


_bm25 = _BM25Index()


# ── Reciprocal Rank Fusion ────────────────────────────────────────────────────

def _rrf_fuse(
    semantic: List[Dict[str, Any]],
    keyword: List[Dict[str, Any]],
    k: int = 60,
) -> List[Dict[str, Any]]:
    """
    Combine two ranked lists into one using Reciprocal Rank Fusion.

    RRF score = Σ  1 / (k + rank)   across both lists.
    A chunk that ranks high in BOTH lists gets the highest final score.
    """
    rrf_scores: Dict[str, float] = {}
    chunk_map: Dict[str, Dict[str, Any]] = {}

    for rank, item in enumerate(semantic):
        cid = item["chunk_id"]
        rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        chunk_map[cid] = item

    for rank, item in enumerate(keyword):
        cid = item["chunk_id"]
        rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        if cid not in chunk_map:
            chunk_map[cid] = item

    fused = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return [
        {**chunk_map[cid], "rrf_score": round(score, 6)}
        for cid, score in fused
        if cid in chunk_map
    ]


# ── Qdrant helpers ────────────────────────────────────────────────────────────

def _ensure_collection() -> None:
    existing = {c.name for c in _qdrant.get_collections().collections}
    if QDRANT_COLLECTION not in existing:
        _qdrant.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=qm.VectorParams(
                size=EMBEDDING_DIM,
                distance=qm.Distance.COSINE,
            ),
        )
        logger.info("Created Qdrant collection '%s' (dim=%d)", QDRANT_COLLECTION, EMBEDDING_DIM)

    # Qdrant requires a payload index on any field used in filters/deletes.
    # Without this index, delete-by-doc_id raises a 400 Bad Request error.
    try:
        _qdrant.create_payload_index(
            collection_name=QDRANT_COLLECTION,
            field_name="doc_id",
            field_schema=qm.PayloadSchemaType.KEYWORD,
        )
        logger.info("Payload index created on 'doc_id'")
    except Exception:
        # Index already exists — safe to ignore
        pass


def _sync_upsert_chunks(
    doc_id: str,
    chunk_texts: List[str],
    chunk_embeddings: List[List[float]],
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    # ── 1. Remove old vectors from Qdrant ────────────────────────────────────
    _qdrant.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=qm.FilterSelector(
            filter=qm.Filter(
                must=[qm.FieldCondition(key="doc_id", match=qm.MatchValue(value=doc_id))]
            )
        ),
    )

    # ── 2. Remove old chunks from MongoDB ────────────────────────────────────
    chunks_col.delete_many({"doc_id": doc_id})

    # ── 3. Build new Qdrant points + MongoDB docs ─────────────────────────────
    qdrant_points: List[qm.PointStruct] = []
    mongo_docs: List[Dict[str, Any]] = []

    for i, (text, emb) in enumerate(zip(chunk_texts, chunk_embeddings)):
        chunk_id = f"{doc_id}__{i}"
        point_id = str(uuid.uuid4())  # Qdrant requires UUID or uint64
        qdrant_points.append(
            qm.PointStruct(
                id=point_id,
                vector=emb,
                payload={
                    "doc_id": doc_id,
                    "chunk_id": chunk_id,
                    "text": text,
                    "meta": meta or {},
                },
            )
        )
        mongo_docs.append(
            {
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "text": text,
                "qdrant_id": point_id,
                "meta": meta or {},
            }
        )

    if qdrant_points:
        _qdrant.upsert(collection_name=QDRANT_COLLECTION, points=qdrant_points)
    if mongo_docs:
        chunks_col.insert_many(mongo_docs)

    # ── 4. Rebuild BM25 index ─────────────────────────────────────────────────
    _bm25.rebuild()


def _sync_search(
    query_embedding: List[float],
    query_text: str,
    top_k: int,
    candidates: int,
) -> List[Dict[str, Any]]:
    """
    Hybrid search:
      • Qdrant ANN  → top `candidates` semantic results
      • BM25        → top `candidates` keyword results
      • RRF fusion  → merged list, return top `top_k`
    """
    # ── Semantic search (Qdrant ANN) ─────────────────────────────────────────
    # client.search() was removed in qdrant-client ≥ 1.7.0; use query_points() instead.
    # query_points() returns a QueryResponse whose .points attribute holds the hits.
    qdrant_response = _qdrant.query_points(
        collection_name=QDRANT_COLLECTION,
        query=query_embedding,
        limit=candidates,
        with_payload=True,
    )
    semantic = [
        {
            "doc_id": h.payload.get("doc_id", ""),
            "chunk_id": h.payload.get("chunk_id", ""),
            "text": h.payload.get("text", ""),
            "score": h.score,
            "meta": h.payload.get("meta", {}),
        }
        for h in qdrant_response.points
        if h.payload.get("doc_id") and h.payload.get("chunk_id")
    ]

    # ── Keyword search (BM25) ─────────────────────────────────────────────────
    keyword = _bm25.search(query_text, top_k=candidates)

    # ── Fuse & return ─────────────────────────────────────────────────────────
    fused = _rrf_fuse(semantic, keyword)
    return fused[:top_k]


def _sync_delete_chunks(doc_id: str) -> None:
    _qdrant.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=qm.FilterSelector(
            filter=qm.Filter(
                must=[qm.FieldCondition(key="doc_id", match=qm.MatchValue(value=doc_id))]
            )
        ),
    )
    chunks_col.delete_many({"doc_id": doc_id})
    _bm25.rebuild()


# ── Public async API ──────────────────────────────────────────────────────────

async def upsert_chunks(
    doc_id: str,
    chunk_texts: List[str],
    chunk_embeddings: List[List[float]],
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    await asyncio.to_thread(_sync_upsert_chunks, doc_id, chunk_texts, chunk_embeddings, meta)


async def search_similar(
    query_embedding: List[float],
    query_text: str,
    top_k: int = 5,
    candidates: int = 20,
) -> List[Dict[str, Any]]:
    return await asyncio.to_thread(_sync_search, query_embedding, query_text, top_k, candidates)


async def delete_chunks(doc_id: str) -> None:
    await asyncio.to_thread(_sync_delete_chunks, doc_id)


# ── Initialise on import ──────────────────────────────────────────────────────
# Wrapped in try/except so a transient network failure at startup doesn't crash
# the whole service — retrieval will degrade gracefully until Qdrant is reachable.
try:
    _ensure_collection()
except Exception as _init_exc:
    logger.warning(
        "Qdrant not reachable at startup (%s). "
        "Semantic search will be unavailable until the connection is restored.",
        _init_exc,
    )

try:
    _bm25.rebuild()
except Exception as _bm25_exc:
    logger.warning("BM25 index could not be built at startup: %s", _bm25_exc)
