# rag_service/config.py
import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Database ──────────────────────────────────────────────────────────────────
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "meddycare")

# ── Qdrant vector DB ──────────────────────────────────────────────────────────
QDRANT_HOST = os.getenv("QDRANT_HOST", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "meddycare_chunks")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", 3072))  # gemini-embedding-001 default

# ── Retrieval ─────────────────────────────────────────────────────────────────
RERANK_CANDIDATES = int(os.getenv("RERANK_CANDIDATES", 20))  # fetch this many before re-ranking

# ── Google GenAI ──────────────────────────────────────────────────────────────
GOOGLE_GENAI_API_KEY = os.getenv("GOOGLE_GENAI_API_KEY", "")
# GOOGLE_GENAI_MODEL is no longer used for generation — Groq handles that now.
# Gemini free-tier exhausts its daily generate_content quota (limit: 0 error)
# very quickly, making the chat unusable. Embeddings still use Gemini fine.
# GOOGLE_GENAI_MODEL = os.getenv("GOOGLE_GENAI_MODEL", "gemini-2.0-flash")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "gemini-embedding-001")

# ── Groq (answer generation + reranking) ──────────────────────────────────────
# Switched from Gemini to Groq for generation: free tier, no card, 14400 RPD.
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# Separate smaller model for reranking — llama-3.1-8b-instant has its own
# TPM budget (20,000 TPM) independent of the 70b generation model (6,000 TPM).
# Using 8b for reranking keeps the task cheap: scoring relevance is simple,
# doesn't need the large model. Generation still uses the 70b.
GROQ_RERANK_MODEL = os.getenv("GROQ_RERANK_MODEL", "llama-3.1-8b-instant")

# ── Auth ──────────────────────────────────────────────────────────────────────
_DEFAULT_JWT_SECRET = "clarity_retina_care_jwt_secret_key_2024_secure_32_chars"
JWT_SECRET = os.getenv("JWT_SECRET_KEY", _DEFAULT_JWT_SECRET)
if JWT_SECRET == _DEFAULT_JWT_SECRET:
    logger.warning(
        "JWT_SECRET_KEY is using the insecure default. "
        "Set a strong, unique secret in your environment before deploying."
    )

# ── Startup validation — fail fast for required credentials ───────────────────
import sys as _sys

_MISSING_VARS: list[str] = []
if not GOOGLE_GENAI_API_KEY:
    _MISSING_VARS.append("GOOGLE_GENAI_API_KEY")
if not GROQ_API_KEY:
    _MISSING_VARS.append("GROQ_API_KEY")
if not os.getenv("MONGODB_URI"):
    _MISSING_VARS.append("MONGODB_URI")

if _MISSING_VARS:
    logger.error(
        "Missing required environment variables: %s. "
        "Set them in your .env file and restart.",
        ", ".join(_MISSING_VARS),
    )
    _sys.exit(1)

del _sys, _MISSING_VARS

# ── Server ────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", 8600))
BASE_URL = os.getenv("BASE_URL", "")

# ── RAG / Chunking ────────────────────────────────────────────────────────────
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", 800))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", 100))
TOP_K = int(os.getenv("TOP_K", 5))
MAX_PDF_MB = int(os.getenv("MAX_PDF_MB", 20))

# ── Rate limiting ─────────────────────────────────────────────────────────────
RATE_LIMIT_PER_HOUR = int(os.getenv("RATE_LIMIT_PER_HOUR", 20))

# ── Sharing ───────────────────────────────────────────────────────────────────
SHARE_EXPIRE_DAYS = int(os.getenv("SHARE_EXPIRE_DAYS", 7))
SITE_TITLE = os.getenv("SITE_TITLE", "MeddyCare")

# ── CORS ──────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174"
    ).split(",")
    if o.strip()
]
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", "")
