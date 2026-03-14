# rag_service/vectorstore_mongo.py
import os
import certifi
import numpy as np
from pymongo import MongoClient, ASCENDING
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
load_dotenv()

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGODB_DB", "icare")
COL_DOCS = "rds_documents"       # document metadata
COL_CHUNKS = "rds_chunks"        # text chunks + embeddings

# Use pymongo (sync) for this helper. tlsCAFile fixes macOS SSL cert verification.
client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
db = client[DB_NAME]
chunks_col = db[COL_CHUNKS]
docs_col = db[COL_DOCS]

# create indexes for faster retrieval (run once)
def ensure_indexes():
    # chunk doc_id index
    chunks_col.create_index([("doc_id", ASCENDING)])
    docs_col.create_index([("added_at", ASCENDING)])

def upsert_document(doc_id: str, title: str, metadata: Dict[str, Any]):
    docs_col.update_one({"_id": doc_id}, {"$set": {"title": title, "meta": metadata, "added_at": __now()}}, upsert=True)

def upsert_chunks(doc_id: str, chunk_texts: List[str], chunk_embeddings: List[List[float]], meta: Optional[Dict[str, Any]] = None):
    # delete existing chunks for doc and insert new ones (simple)
    chunks_col.delete_many({"doc_id": doc_id})
    to_insert = []
    for i, (txt, emb) in enumerate(zip(chunk_texts, chunk_embeddings)):
        to_insert.append({
            "doc_id": doc_id,
            "chunk_id": f"{doc_id}__{i}",
            "text": txt,
            "embedding": emb,
            "meta": meta or {},
        })
    if to_insert:
        chunks_col.insert_many(to_insert)

def _cosine_sim(a: np.ndarray, b: np.ndarray):
    # numerical stability
    a_norm = np.linalg.norm(a)
    b_norm = np.linalg.norm(b)
    if a_norm == 0 or b_norm == 0:
        return 0.0
    return float(np.dot(a, b) / (a_norm * b_norm))

def search_similar_local(query_embedding: List[float], top_k: int = 5, filter_doc_ids: Optional[List[str]] = None):
    """
    Simple local search: load candidates from Mongo into memory and compute cosine similarity.
    Not suitable for large datasets, but fine for dev/test.
    """
    q_emb = np.asarray(query_embedding, dtype=np.float32)
    q = {}
    if filter_doc_ids:
        q["doc_id"] = {"$in": filter_doc_ids}
    # limit to N candidates for speed — tune as needed
    cursor = chunks_col.find(q)
    results = []
    for doc in cursor:
        emb = np.asarray(doc.get("embedding", []), dtype=np.float32)
        if emb.size == 0:
            continue
        score = _cosine_sim(q_emb, emb)
        results.append({
            "doc_id": doc["doc_id"],
            "chunk_id": doc["chunk_id"],
            "text": doc["text"],
            "score": score,
            "meta": doc.get("meta", {})
        })
    # sort by score desc
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]

def __now():
    from datetime import datetime
    return datetime.utcnow()
