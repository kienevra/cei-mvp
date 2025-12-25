# backend/app/core/errors.py

from enum import Enum
import logging

from app.core.request_context import get_request_id


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
