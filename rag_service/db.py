# rag_service/db.py
import logging

import certifi
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING

from config import MONGODB_DB, MONGODB_URI

logger = logging.getLogger(__name__)

client = AsyncIOMotorClient(
    MONGODB_URI,
    tlsCAFile=certifi.where(),
    serverSelectionTimeoutMS=5_000,
    connectTimeoutMS=5_000,
    socketTimeoutMS=30_000,
    maxPoolSize=20,
)
db = client[MONGODB_DB]

# Collections
users_col = db["users"]
reports_col = db["reports"]
chats_col = db["chats"]
messages_col = db["rag_messages"]
documents_col = db["rag_documents"]
uploads_col = db["uploads"]


async def create_indexes() -> None:
    """Create all required indexes. Called once at app startup."""
    try:
        await users_col.create_index(
            [("email", ASCENDING)], unique=True, name="users_email_uidx"
        )
        await chats_col.create_index(
            [("user_id", ASCENDING), ("updated_at", ASCENDING)],
            name="chats_user_updated_idx",
        )
        await messages_col.create_index(
            [("chat_id", ASCENDING), ("timestamp", ASCENDING)],
            name="messages_chat_ts_idx",
        )
        await messages_col.create_index(
            [("user_id", ASCENDING)], name="messages_user_idx"
        )
        await documents_col.create_index(
            [("added_at", ASCENDING)], name="docs_added_idx"
        )
        await documents_col.create_index(
            [("content_hash", ASCENDING)], unique=True, sparse=True,
            name="docs_content_hash_uidx",
        )
        # TTL index: MongoDB auto-deletes expired share documents
        await db["shared_chats"].create_index(
            "expires_at",
            expireAfterSeconds=0,
            name="shared_chats_ttl_idx",
        )
    except Exception as exc:
        logger.warning("Index creation warning (non-fatal): %s", exc)


async def delete_chat_and_messages(
    chat_id: str, user_id: str, is_admin: bool = False
) -> bool:
    """
    Delete a chat and all its messages.
    Returns True if a chat was deleted, False if not found or access denied.
    """
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        return False
    if chat.get("user_id") != user_id and not is_admin:
        return False
    await messages_col.delete_many({"chat_id": chat_id})
    result = await chats_col.delete_one({"_id": chat_id})
    return result.deleted_count > 0
