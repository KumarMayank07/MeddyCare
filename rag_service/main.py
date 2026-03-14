# rag_service/main.py
import uvicorn
from fastapi import FastAPI
from chat_routes import router as chat_router
from config import PORT, GOOGLE_GENAI_API_KEY, GOOGLE_GENAI_MODEL, ALLOWED_ORIGINS
from google import genai
import logging
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="iCare - RAG Chat Service")

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create genai client (new SDK: google-genai)
genai_client = genai.Client(api_key=GOOGLE_GENAI_API_KEY)

# Attach router
app.include_router(chat_router, prefix="/api/rag", tags=["rag"])

# simple root
@app.get("/")
def root():
    return {"status": "iCare RAG service", "ok": True}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
