# backend/app/db/session.py
import time
import logging

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.request_context import get_request_id

logger = logging.getLogger("cei")

# If DATABASE_URL is None, engine creation will fail later; callers should handle.
DATABASE_URL = settings.database_url or "sqlite:///./dev.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    future=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

# ---- DB observability (SQLAlchemy event hooks) ----

# Align with config.py knobs (but stay backward-compatible if an older name exists)
SLOW_QUERY_MS = float(
    getattr(settings, "slow_db_query_ms", getattr(settings, "slow_query_ms", 250))
)
LOG_DB_SQL = bool(getattr(settings, "log_db_sql", False))


def _sql_head(statement: str) -> str:
    if not statement:
        return ""
    # Collapse whitespace + trim. No params logged.
    head = " ".join(statement.split())
    return head[:240]


# record_db_query is optional (keeps this file safe even if you haven’t added it yet)
try:
    from app.core.request_context import record_db_query  # type: ignore
except Exception:  # pragma: no cover
    def record_db_query(duration_ms: float, sql_head: str) -> None:
        return


@event.listens_for(engine, "before_cursor_execute")
def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    context._cei_query_start = time.perf_counter()


@event.listens_for(engine, "after_cursor_execute")
def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    start = getattr(context, "_cei_query_start", None)
    if start is None:
        return

    duration_ms = (time.perf_counter() - start) * 1000.0
    head = _sql_head(statement)

    # Record into request-scoped metrics (no-op if not implemented yet)
    record_db_query(duration_ms, head)

    # Slow query warning (single query)
    if duration_ms >= SLOW_QUERY_MS:
        rid = get_request_id()
        if LOG_DB_SQL:
            logger.warning(
                "slow_db_query request_id=%s duration_ms=%.2f sql=%s",
                rid,
                duration_ms,
                head,
            )
        else:
            logger.warning(
                "slow_db_query request_id=%s duration_ms=%.2f",
                rid,
                duration_ms,
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
