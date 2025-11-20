# backend/app/core/rate_limit.py
import time
from typing import Dict, Tuple, List

from fastapi import HTTPException, Request, status

# Very simple in-memory store: {(key_prefix, client_ip): [timestamps]}
_RATE_LIMIT_BUCKETS: Dict[Tuple[str, str], List[float]] = {}


def rate_limit(key_prefix: str, limit: int, window_seconds: int):
    """
    Dependency factory for naive in-memory rate limiting.

    Example:
        @router.post("/login", dependencies=[Depends(rate_limit("login", 5, 60))])
    """

    async def _limiter(request: Request):
        now = time.time()
        client_ip = request.client.host if request.client else "unknown"
        key = (key_prefix, client_ip)
        window_start = now - window_seconds

        timestamps = _RATE_LIMIT_BUCKETS.get(key, [])
        # Drop old entries
        timestamps = [ts for ts in timestamps if ts >= window_start]

        if len(timestamps) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please slow down and try again shortly.",
            )

        timestamps.append(now)
        _RATE_LIMIT_BUCKETS[key] = timestamps

    return _limiter
