# rag_service/auth.py
import logging

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import JWT_SECRET
from db import users_col

logger = logging.getLogger(__name__)

_ALGORITHM = "HS256"
_auth_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_auth_scheme),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing credentials.")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[_ALGORITHM])
        user_id = payload.get("sub") or payload.get("userId")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload.")

        # Check suspension status in MongoDB (matches backend behaviour)
        from bson import ObjectId
        try:
            user_doc = await users_col.find_one(
                {"_id": ObjectId(user_id)},
                {"isSuspended": 1},
            )
        except Exception:
            user_doc = None
        if user_doc and user_doc.get("isSuspended"):
            raise HTTPException(status_code=403, detail="Account suspended.")

        return {
            "_id": str(user_id),
            "email": payload.get("email", ""),
            "role": payload.get("role", "user"),
            "firstName": payload.get("firstName", ""),
            "lastName": payload.get("lastName", ""),
        }
    except JWTError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(status_code=401, detail="Could not validate credentials.")


async def get_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required.")
    return current_user


async def get_doctor_user(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Doctor privileges required.")
    return current_user
