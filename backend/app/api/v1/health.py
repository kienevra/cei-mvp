# backend/app/api/v1/health.py

"""
Health endpoints for CEI backend.

- /api/v1/health       -> lightweight liveness (no DB)
- /api/v1/health/db    -> DB readiness probe (small SELECT 1)
"""

import logging
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings

logger = logging.getLogger("cei.health")

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", summary="Liveness probe")
def health():
    """
    Lightweight liveness check used by Render/infra.

    - Does NOT touch the database.
    - Returns 200 as long as the app process is up and routing works.
    """
    return {
        "status": "ok",
        "service": "cei-backend",
        "version": getattr(settings, "version", "dev"),
        "timestamp_utc": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/db", summary="Database readiness probe")
def health_db(db: Session = Depends(get_db)):
    """
    Readiness / dependency check.

    - Performs a tiny `SELECT 1` against the configured database.
    - Returns 200 when DB is reachable, 503 when not.
    - Never hangs indefinitely; surfaces failure in JSON.
    """
    start = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return {
            "status": "ok",
            "db": "up",
            "latency_ms": elapsed_ms,
        }
    except Exception as exc:
        logger.exception("DB health check failed")
        raise HTTPException(
            status_code=503,
            detail={
                "status": "error",
                "db": "down",
                "error": str(exc),
            },
        )
