# rag_service/models.py
from pydantic import BaseModel, Field, HttpUrl
from typing import List, Optional, Any
from datetime import datetime

class IngestURLRequest(BaseModel):
    url: HttpUrl
    title: Optional[str] = None

class IngestPdfResponse(BaseModel):
    doc_id: str
    chunks_added: int

class ChatRequest(BaseModel):
    message: str
    chat_id: Optional[str] = None
    top_k: Optional[int] = None
    timezone: Optional[str] = 'UTC' 

class ChatResponse(BaseModel):
    chat_id: str
    answer: str
    sources: List[Any] = []
    timestamp: datetime

class MessageModel(BaseModel):
    chat_id: str
    user_id: str
    role: str  # 'user' | 'assistant' | 'system'
    text: str
    timestamp: Optional[datetime] = None
    meta: Optional[dict] = None
