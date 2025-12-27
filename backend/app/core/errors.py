# backend/app/core/errors.py

from __future__ import annotations

from enum import Enum
import logging
from typing import Any, Optional

from app.core.request_context import get_request_id

logger = logging.getLogger("cei")


class TimeseriesIngestErrorCode(str, Enum):
    UNKNOWN_SITE = "UNKNOWN_SITE"
    UNKNOWN_METER = "UNKNOWN_METER"
    ORG_MISMATCH = "ORG_MISMATCH"
    INVALID_TIMESTAMP = "INVALID_TIMESTAMP"
    INVALID_VALUE = "INVALID_VALUE"
    INVALID_UNIT = "INVALID_UNIT"
    DUPLICATE_IDEMPOTENCY_KEY = "DUPLICATE_IDEMPOTENCY_KEY"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class RequestIdFilter(logging.Filter):
    """
    Injects request_id into every LogRecord as `record.request_id`.
    Safe in non-request contexts (falls back to "-").
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.request_id = get_request_id()
        except Exception:
            record.request_id = "-"
        return True


def install_request_id_logging(
    logger_name: str = "cei",
    *,
    include_root: bool = True,
) -> None:
    """
    Attach RequestIdFilter so logs can include %(request_id)s in the formatter.
    Call once during startup (e.g., in main.py right after logging.basicConfig()).
    """
    filt = RequestIdFilter()

    if include_root:
        root = logging.getLogger()
        root.addFilter(filt)

    logging.getLogger(logger_name).addFilter(filt)


def log_exception_with_context(
    message: str,
    *,
    request_id: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    """
    Log an exception with stack trace and CEI request context.

    Use this inside exception handlers (global or local) to ensure the true root
    cause is visible in Render logs. This is the missing observability piece
    causing generic HTTP_400 "Request failed." responses to be non-actionable.

    Example:
        try:
            ...
        except Exception:
            log_exception_with_context(
                "Upload CSV failed",
                extra={"path": "/api/v1/upload-csv/", "method": "POST"}
            )
            raise
    """
    rid = request_id or _safe_request_id()
    payload: dict[str, Any] = {"request_id": rid}
    if extra:
        payload.update(extra)

    # logger.exception includes the stack trace of the currently-handled exception
    logger.exception(message, extra=payload)


def _safe_request_id() -> str:
    try:
        return get_request_id() or "-"
    except Exception:
        return "-"
