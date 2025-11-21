# backend/app/api/v1/health.py

import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db

logger = logging.getLogger("cei")

router = APIRouter(tags=["health"])


@router.get("/health", include_in_schema=False)
def health(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Lightweight health endpoint used by the frontend and platform.

    - Verifies the app is up.
    - Executes a trivial `SELECT 1` against the database.
    - Returns 200 OK if both succeed, 503 if DB is not reachable.

    Final path (via main.py include) -> /api/v1/health
    """
    # Base payload
    payload: Dict[str, Any] = {
        "status": "ok",
        "environment": settings.environment,
    }

    try:
        db.execute(text("SELECT 1"))
        payload["database"] = "ok"
        return payload
    except Exception as exc:
        logger.error("Health check DB failure: %s", exc)
        # We still tell the caller what's wrong, but with a 503 so
        # load balancers / orchestrators can see this as unhealthy.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "degraded",
                "environment": settings.environment,
                "database": "unreachable",
            },
        )
