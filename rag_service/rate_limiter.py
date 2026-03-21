# rag_service/rate_limiter.py
"""
Sliding-window in-memory rate limiter for the chat endpoint.

One store per process — no Redis needed for a single-instance deployment.
For multi-instance: swap _store for a shared Redis-backed counter.
"""
import time
from collections import defaultdict

from fastapi import Depends, HTTPException

from auth import get_current_user
from config import RATE_LIMIT_PER_HOUR

_WINDOW = 3600  # seconds in one hour
_store: dict[str, list[float]] = defaultdict(list)


async def rate_limit_chat(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency — raises 429 if the user exceeds RATE_LIMIT_PER_HOUR."""
    user_id = user["_id"]
    now = time.monotonic()
    cutoff = now - _WINDOW

    # Drop timestamps outside the current window
    timestamps = [t for t in _store[user_id] if t > cutoff]

    # Clean up stale keys so _store doesn't grow unboundedly
    if not timestamps and user_id in _store:
        del _store[user_id]

    if len(timestamps) >= RATE_LIMIT_PER_HOUR:
        _store[user_id] = timestamps  # persist pruned list
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit exceeded. You can send up to {RATE_LIMIT_PER_HOUR} "
                "messages per hour. Please wait a moment before trying again."
            ),
        )

    timestamps.append(now)
    _store[user_id] = timestamps

    return user
