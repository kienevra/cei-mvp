# backend/app/core/rate_limit.py
import os
import time
from typing import Dict, Tuple, List, Optional

from fastapi import Request, HTTPException, status


def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.getenv(name, str(default)))
        return v
    except Exception:
        return default


class SimpleRateLimiter:
    """
    Very simple in-memory rate limiter keyed by (key, client_ip).

    Good enough for:
      - local development
      - low-volume single-instance deployments

    IMPORTANT:
    - Keep call signatures clean (no *args/**kwargs), otherwise FastAPI
      will treat them as query params and you'll get missing args/kwargs errors.
    """

    def __init__(self, key: str, limit: int, window_seconds: int):
        self.key = key
        self.limit = int(limit)
        self.window_seconds = int(window_seconds)
        # (key, ip) -> list[timestamps]
        self._store: Dict[Tuple[str, str], List[float]] = {}

    def _client_ip(self, request: Request) -> str:
        # If behind proxy, X-Forwarded-For may contain multiple IPs: "client, proxy1, proxy2"
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip() or "unknown"

        if request.client and request.client.host:
            return request.client.host

        return "unknown"

    async def hit(self, request: Request) -> None:
        client_ip = self._client_ip(request)
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

        timestamps.append(now)
        self._store[bucket_key] = timestamps

    async def __call__(self, request: Request) -> None:
        # Clean signature so FastAPI doesn't invent query params
        await self.hit(request)


# === Per-endpoint limiters ===
LOGIN_RATE_LIMIT = _env_int("LOGIN_RATE_LIMIT", 5)
LOGIN_RATE_WINDOW = _env_int("LOGIN_RATE_WINDOW", 60)

REFRESH_RATE_LIMIT = _env_int("REFRESH_RATE_LIMIT", 60)
REFRESH_RATE_WINDOW = _env_int("REFRESH_RATE_WINDOW", 60)

CSV_UPLOAD_LIMIT = _env_int("CSV_UPLOAD_LIMIT", 20)
CSV_UPLOAD_WINDOW = _env_int("CSV_UPLOAD_WINDOW", 60 * 60)

TIMESERIES_BATCH_LIMIT = _env_int("TIMESERIES_BATCH_LIMIT", 120)
TIMESERIES_BATCH_WINDOW = _env_int("TIMESERIES_BATCH_WINDOW", 60)


# Instantiate limiters
_login_limiter = SimpleRateLimiter("login", LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW)
_refresh_limiter = SimpleRateLimiter("refresh", REFRESH_RATE_LIMIT, REFRESH_RATE_WINDOW)
_csv_upload_limiter = SimpleRateLimiter("csv_upload", CSV_UPLOAD_LIMIT, CSV_UPLOAD_WINDOW)
_timeseries_batch_limiter = SimpleRateLimiter("timeseries_batch", TIMESERIES_BATCH_LIMIT, TIMESERIES_BATCH_WINDOW)


# Export clean dependency functions
async def login_rate_limit(request: Request) -> None:
    await _login_limiter.hit(request)


async def refresh_rate_limit(request: Request) -> None:
    await _refresh_limiter.hit(request)


async def csv_upload_rate_limit(request: Request) -> None:
    await _csv_upload_limiter.hit(request)


async def timeseries_batch_rate_limit(request: Request) -> None:
    await _timeseries_batch_limiter.hit(request)
