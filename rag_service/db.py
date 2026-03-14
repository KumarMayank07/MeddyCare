# rag_service/db.py
import os
import certifi
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import IndexModel, ASCENDING

# Load .env so environment variables are available when module is imported
load_dotenv()

# Config
MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGODB_DB", "icare")  # default DB name

# Create client with certifi CA bundle to fix macOS SSL certificate verification
client = AsyncIOMotorClient(MONGO_URI, tlsCAFile=certifi.where())
db = client[MONGO_DB]

# Collections used by the app
users_col = db["users"]
reports_col = db["reports"]
chats_col = db["chats"]            # conversation threads metadata (one per chat)
messages_col = db["messages"]      # individual chat messages (user/bot)
documents_col = db["rag_documents"]  # uploaded docs/papers for RAG index
uploads_col = db["uploads"]        # uploaded retina images metadata, etc.


default_indexes = [
    IndexModel([("email", ASCENDING)], name="users_email_idx", unique=True),
    IndexModel([("user_id", ASCENDING)], name="messages_user_idx"),
    IndexModel([("chat_id", ASCENDING)], name="messages_chat_idx"),
    IndexModel([("created_at", ASCENDING)], name="created_at_idx")
]

async def create_indexes():
    """Create configured indexes (call this from startup event if you want)."""
    try:
        # Create each index on its collection if appropriate
        await users_col.create_indexes([default_indexes[0]])
        # messages, chats, documents - create useful indexes
        await messages_col.create_indexes([default_indexes[1], default_indexes[2]])
        await chats_col.create_indexes([default_indexes[3]])
        # documents basic index (e.g. filename)
        await documents_col.create_index([("filename", ASCENDING)], name="doc_filename_idx")
    except Exception as e:
        # do not crash on index errors; log externally if desired
        print("create_indexes() error:", str(e))


async def delete_chat_and_messages(chat_id: str, user_id: str, is_admin: bool = False) -> bool:
    """
    Delete a chat (from chats_col) and all its messages (from messages_col).
    Returns True if a chat was deleted, False otherwise.
    """
    # Find the chat
    chat = await chats_col.find_one({"_id": chat_id})
    if not chat:
        return False

    # Authorization: only owner or admin can delete
    if chat.get("user_id") != user_id and not is_admin:
        return False

    # Delete messages
    await messages_col.delete_many({"chat_id": chat_id})

    # Delete chat metadata
    result = await chats_col.delete_one({"_id": chat_id})

    return result.deleted_count > 0

