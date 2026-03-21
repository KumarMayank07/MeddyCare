# rag_service/models.py
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, HttpUrl


class IngestURLRequest(BaseModel):
    url: HttpUrl
    title: Optional[str] = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    chat_id: Optional[str] = None
    top_k: Optional[int] = Field(None, ge=1, le=20)


class ChatResponse(BaseModel):
    chat_id: str
    message_id: Optional[str] = None   # stable MongoDB _id for frontend dedup
    answer: str
    sources: List[Any] = []
    suggestions: List[str] = []        # follow-up question suggestions
    timestamp: datetime


class UpdateChatRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    archived: Optional[bool] = None
