# backend/app/core/request_context.py
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Dict, Optional

# --- Request id (already used by main.py) ---
request_id_var: ContextVar[Optional[str]] = ContextVar("cei_request_id", default=None)


def set_request_id(rid: str | None) -> None:
    request_id_var.set(rid)


def get_request_id() -> str:
    return request_id_var.get() or "-"


# --- DB timing (request-scoped) ---

@dataclass
class DbMetrics:
    query_count: int = 0
    total_ms: float = 0.0
    slowest_ms: float = 0.0
    slowest_sql_head: str = ""


db_metrics_var: ContextVar[Optional[DbMetrics]] = ContextVar("cei_db_metrics", default=None)


def reset_db_metrics() -> None:
    """Call once per request (typically in middleware) to start clean metrics."""
    db_metrics_var.set(DbMetrics())


def get_db_metrics() -> DbMetrics:
    m = db_metrics_var.get()
    if m is None:
        m = DbMetrics()
        db_metrics_var.set(m)
    return m


def clear_db_metrics() -> None:
    db_metrics_var.set(None)


def record_db_query(duration_ms: float, sql_head: str = "") -> None:
    """Record one DB query timing into the current request's metrics."""
    m = get_db_metrics()
    m.query_count += 1
    m.total_ms += float(duration_ms)

    if float(duration_ms) > m.slowest_ms:
        m.slowest_ms = float(duration_ms)
        m.slowest_sql_head = (sql_head or "")[:240]


def get_db_metrics_snapshot() -> Dict[str, Any]:
    """
    Safe, log-friendly snapshot of the current request's DB metrics.
    Returns stable keys so main.py can log them without touching internals.
    """
    m = db_metrics_var.get()
    if m is None:
        return {
            "db_query_count": 0,
            "db_total_ms": 0.0,
            "db_slowest_ms": 0.0,
            "db_slowest_sql": "",
        }

    return {
        "db_query_count": int(m.query_count),
        "db_total_ms": float(m.total_ms),
        "db_slowest_ms": float(m.slowest_ms),
        "db_slowest_sql": (m.slowest_sql_head or ""),
    }
