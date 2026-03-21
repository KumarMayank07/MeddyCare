# rag_service/main.py
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from chat_routes import router as chat_router
from clients import get_genai_client, get_groq_client
from config import ALLOWED_ORIGIN_REGEX, ALLOWED_ORIGINS, PORT
from db import create_indexes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Replaces deprecated @app.on_event('startup'/'shutdown')."""
    await create_indexes()
    get_genai_client()   # warm up singletons before first request
    get_groq_client()
    logger.info("RAG service ready on port %d", PORT)
    yield
    # shutdown: motor/qdrant clients are cleaned up by the OS — nothing explicit needed


app = FastAPI(title="MeddyCare RAG Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router, prefix="/api/rag", tags=["rag"])


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "MeddyCare RAG service", "ok": True}


if __name__ == "__main__":
    is_dev = os.getenv("NODE_ENV") != "production"
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=is_dev)
