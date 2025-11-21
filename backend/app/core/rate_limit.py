# backend/app/core/rate_limit.py
import os
import time
from typing import Dict, Tuple, List

from fastapi import Request, HTTPException, status


class SimpleRateLimiter:
    """
    Very simple in-memory rate limiter keyed by (name, client_ip).

    This is good enough for:
      - local development
      - low-volume single-instance deployments

    For multi-instance / real production you’d move this to Redis or similar.
    """

    def __init__(self, key: str, limit: int, window_seconds: int):
        self.key = key
        self.limit = limit
        self.window_seconds = window_seconds
        # (key, ip) -> list[timestamps]
        self._store: Dict[Tuple[str, str], List[float]] = {}

    async def __call__(self, request: Request):
        # Basic client IP detection; behind a proxy you’d trust X-Forwarded-For instead
        client_ip = (
            request.client.host
            if request.client
            else request.headers.get("x-forwarded-for", "unknown")
        )

        now = time.time()
        bucket_key = (self.key, client_ip)

        timestamps = self._store.get(bucket_key, [])
        cutoff = now - self.window_seconds
        # Drop old entries outside the window
        timestamps = [ts for ts in timestamps if ts >= cutoff]

        if len(timestamps) >= self.limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests, please slow down.",
            )

        # Record this hit
        timestamps.append(now)
        self._store[bucket_key] = timestamps


# === Per-endpoint limiters ===
# Override via env if needed in future.

LOGIN_RATE_LIMIT = int(os.getenv("LOGIN_RATE_LIMIT", "5"))
LOGIN_RATE_WINDOW = int(os.getenv("LOGIN_RATE_WINDOW", "60"))  # 5 per 60s

REFRESH_RATE_LIMIT = int(os.getenv("REFRESH_RATE_LIMIT", "60"))
REFRESH_RATE_WINDOW = int(os.getenv("REFRESH_RATE_WINDOW", "60"))  # 60 per 60s

CSV_UPLOAD_LIMIT = int(os.getenv("CSV_UPLOAD_LIMIT", "20"))
CSV_UPLOAD_WINDOW = int(os.getenv("CSV_UPLOAD_WINDOW", str(60 * 60)))  # 20 per hour


# These are used as FastAPI dependencies (Depends(login_rate_limit), etc.)
login_rate_limit = SimpleRateLimiter("login", LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW)
refresh_rate_limit = SimpleRateLimiter(
    "refresh", REFRESH_RATE_LIMIT, REFRESH_RATE_WINDOW
)
csv_upload_rate_limit = SimpleRateLimiter(
    "csv_upload", CSV_UPLOAD_LIMIT, CSV_UPLOAD_WINDOW
)
