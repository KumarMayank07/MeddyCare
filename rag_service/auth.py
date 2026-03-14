# rag_service/auth.py
import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "clarity_retina_care_jwt_secret_key_2024_secure_32_chars")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

auth_scheme = HTTPBearer(auto_error=False)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing credentials")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        logger.info(f"Token payload: {payload}")
        
        # Get user ID from different possible fields
        user_id = payload.get("sub") or payload.get("userId")
        if not user_id:
            logger.error("No user ID found in token payload")
            raise HTTPException(status_code=401, detail="Invalid token payload")

        # Get user role with fallback to 'user'
        role = payload.get("role", "user")
        email = payload.get("email", "unknown@example.com")
        
        logger.info(f"User authenticated: {user_id}, role: {role}, email: {email}")

        # Ensure consistent shape
        return {
            "_id": str(user_id),
            "email": email,
            "role": role,
            "firstName": payload.get("firstName", ""),
            "lastName": payload.get("lastName", "")
        }
    except JWTError as e:
        logger.error(f"JWT Error: {str(e)}")
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}")
        raise HTTPException(status_code=401, detail="Authentication failed")

async def get_admin_user(current_user: dict = Depends(get_current_user)):
    """Dependency to ensure the current user is an admin"""
    if current_user.get("role") != "admin":
        logger.warning(f"Non-admin user {current_user.get('email')} attempted admin action")
        raise HTTPException(
            status_code=403, 
            detail="Admin privileges required to ingest documents."
        )
    return current_user

async def get_doctor_user(current_user: dict = Depends(get_current_user)):
    """Dependency to ensure the current user is a doctor or admin"""
    user_role = current_user.get("role")
    if user_role not in ["doctor", "admin"]:
        logger.warning(f"Non-doctor user {current_user.get('email')} attempted doctor action")
        raise HTTPException(
            status_code=403, 
            detail="Doctor privileges required."
        )
    return current_user