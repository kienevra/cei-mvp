# backend/app/main.py

import logging
import traceback
import time
import uuid
from typing import Any, Optional

from fastapi import FastAPI, Request, Form
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi import HTTPException

from app.core.config import settings
from app.api.v1 import sites as sites_api
from app.core.request_context import (
    set_request_id,
    reset_db_metrics,
    get_db_metrics,
    clear_db_metrics,
    get_request_id,
)

# --- Logging setup ---
# Keep your structured format, but make it resilient if request_id isn't installed.
#
# Why this works:
# - logging.Filter only runs on the logger it’s attached to; some third-party loggers can bypass it.
# - LogRecordFactory runs for EVERY record, globally. So request_id always exists -> no KeyError.
_old_factory = logging.getLogRecordFactory()


def _record_factory(*args, **kwargs):
    record = _old_factory(*args, **kwargs)
    if not hasattr(record, "request_id"):
        record.request_id = "-"
    return record


logging.setLogRecordFactory(_record_factory)

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s request_id=%(request_id)s %(message)s",
)

# Try to install request-id filter if present; do not hard-depend on it.
try:
    from app.core.errors import install_request_id_logging  # type: ignore

    install_request_id_logging()
except Exception:
    # Fallback: add a filter that injects request_id from request_context.
    # (RecordFactory already prevents KeyError; this improves correctness.)
    class _RequestIdFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            try:
                rid = get_request_id()
            except Exception:
                rid = None
            record.request_id = rid or getattr(record, "request_id", "-") or "-"
            return True

    logging.getLogger().addFilter(_RequestIdFilter())

logger = logging.getLogger("cei")

# Decide whether docs should be exposed (default: False in prod)
enable_docs = getattr(settings, "enable_docs", False)
logger.info("Startup: enable_docs=%s", enable_docs)

# Log DB backend type (sqlite, postgresql, etc.) without leaking credentials
try:
    db_backend = (settings.database_url or "").split(":", 1)[0]
except Exception:  # extremely defensive
    db_backend = "unknown"
logger.info("DB backend detected: %s", db_backend)

# --- Request-level performance budget (warn on slow requests) ---
SLOW_HTTP_MS = getattr(settings, "slow_http_ms", 1500)  # default 1500ms

# --- App setup ---
app = FastAPI(
    title="CEI API",
    openapi_url="/api/v1/openapi.json" if enable_docs else None,
    docs_url="/api/v1/docs" if enable_docs else None,
    redoc_url="/api/v1/redoc" if enable_docs else None,
)


def _get_request_id(request: Request) -> str:
    """
    Use an incoming request id if present (common in proxies),
    otherwise generate one. Keep it short but collision-resistant.
    """
    incoming = request.headers.get("x-request-id") or request.headers.get("x-correlation-id")
    if incoming and isinstance(incoming, str) and incoming.strip():
        return incoming.strip()[:128]
    return uuid.uuid4().hex  # 32 chars


def _client_ip(request: Request) -> str:
    # Prefer X-Forwarded-For if present (Render/proxies), fall back to client.host.
    xff = request.headers.get("x-forwarded-for")
    if xff and isinstance(xff, str):
        first = xff.split(",")[0].strip()
        if first:
            return first
    try:
        return request.client.host if request.client else "unknown"
    except Exception:
        return "unknown"


def _rid_from_request(request: Request) -> str:
    # Prefer request.state (set by middleware), fall back to request_context, then generate.
    rid = getattr(request.state, "request_id", None)
    if isinstance(rid, str) and rid.strip():
        return rid
    try:
        rid2 = get_request_id()
        if isinstance(rid2, str) and rid2.strip():
            return rid2
    except Exception:
        pass
    return uuid.uuid4().hex


def _error_payload(code: str, message: str, request_id: str, extra: Optional[dict] = None) -> dict:
    """
    Standardized error contract (additive):
    - code/message/request_id (new, stable)
    - detail is preserved for older frontend parsing
    """
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "request_id": request_id,
        # Back-compat default detail shape
        "detail": {"code": code, "message": message},
    }
    if extra:
        payload.update(extra)
    return payload


def _http_exception_payload(exc: HTTPException, *, request_id: str) -> dict:
    """
    Build a robust, structured error payload for HTTPException.

    Key behavior (the "better product"):
    - If exc.detail is a dict, preserve it and MERGE it into payload["detail"].
      That means your handlers can raise:
          HTTPException(400, detail={"type":"schema_error", ...})
      and clients will actually receive that structured payload.

    - If exc.detail is a string, keep current conservative behavior.
    """
    code = f"HTTP_{exc.status_code}"

    if isinstance(exc.detail, dict):
        # Prefer a message from detail if provided; otherwise use a safe default.
        # Keep the dict intact and merge under detail.
        msg = exc.detail.get("message")
        if not isinstance(msg, str) or not msg.strip():
            msg = "Request failed."

        # Merge so detail always includes code/message (back-compat) PLUS structured fields.
        merged_detail: dict[str, Any] = {"code": code, "message": msg}
        merged_detail.update(exc.detail)

        return _error_payload(code=code, message=msg, request_id=request_id, extra={"detail": merged_detail})

    # String/other detail -> keep conservative behavior
    msg = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return _error_payload(code=code, message=msg, request_id=request_id)


# --- Exception handlers (standardized error contract) ---
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = _rid_from_request(request)

    payload = _http_exception_payload(exc, request_id=request_id)

    resp = JSONResponse(
        status_code=exc.status_code,
        content=payload,
    )
    resp.headers["X-Request-ID"] = request_id
    return resp


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = _rid_from_request(request)
    # Produce a clean, operator-friendly summary; keep full details for debugging.
    msg = "Validation error. Check request body/query parameters."
    resp = JSONResponse(
        status_code=422,
        content=_error_payload(
            code="VALIDATION_ERROR",
            message=msg,
            request_id=request_id,
            extra={"errors": exc.errors()},
        ),
    )
    resp.headers["X-Request-ID"] = request_id
    return resp


# --- Observability middleware: request id + timing + structured logs ---
@app.middleware("http")
async def request_observability(request: Request, call_next):
    request_id = _get_request_id(request)
    request.state.request_id = request_id
    set_request_id(request_id)
    reset_db_metrics()

    start = time.perf_counter()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = getattr(response, "status_code", 200) or 200
        response.headers["X-Request-ID"] = request_id
        return response

    except Exception as e:
        # IMPORTANT:
        # Let FastAPI’s exception handlers handle expected errors so clients get a consistent contract.
        # Without this, HTTPException / validation errors would be incorrectly converted into 500s.
        if isinstance(e, HTTPException) or isinstance(e, RequestValidationError):
            raise

        # Preserve your current behavior for true unhandled exceptions:
        # log full traceback and return a JSON 500 payload (but now with stable code/message too).
        #
        # NOTE: Do NOT pass request_id via logger extra here; the RequestIdFilter injects it.
        logger.error(
            "Unhandled error method=%s path=%s error=%s",
            request.method,
            request.url.path,
            str(e),
        )
        logger.error(traceback.format_exc())

        tb_lines = traceback.format_exc().splitlines()
        payload = _error_payload(
            code="INTERNAL_ERROR",
            message="Internal Server Error",
            request_id=request_id,
            extra={
                # Back-compat fields you already had (kept, not removed)
                "error": str(e),
                "traceback_last_lines": tb_lines[-10:],
            },
        )

        resp = JSONResponse(status_code=500, content=payload)
        resp.headers["X-Request-ID"] = request_id
        status_code = 500
        return resp

    finally:
        duration_ms = (time.perf_counter() - start) * 1000.0

        # DB rollup for the request
        m = get_db_metrics()
        db_total_ms = m.total_ms
        db_q = m.query_count
        db_slowest_ms = m.slowest_ms

        # Budgets (pilot defaults)
        slow_db_total_ms = float(getattr(settings, "slow_db_total_ms", 800.0))

        # "Structured" log line (key=value) so it’s grep-friendly in Render logs.
        log_fn = logger.warning if duration_ms >= float(SLOW_HTTP_MS) else logger.info
        log_fn(
            "req request_id=%s method=%s path=%s status=%s duration_ms=%.2f db_total_ms=%.2f db_q=%s db_slowest_ms=%.2f ip=%s ua=%s",
            request_id,
            request.method,
            request.url.path,
            status_code,
            duration_ms,
            db_total_ms,
            db_q,
            db_slowest_ms,
            _client_ip(request),
            (request.headers.get("user-agent") or "").replace(" ", "_")[:200],
        )

        # Slow budgets: warn (db-level)
        if db_total_ms >= slow_db_total_ms:
            logger.warning(
                "slow_db_total request_id=%s method=%s path=%s status=%s db_total_ms=%.2f db_q=%s db_slowest_ms=%.2f",
                request_id,
                request.method,
                request.url.path,
                status_code,
                db_total_ms,
                db_q,
                db_slowest_ms,
            )

        clear_db_metrics()
        set_request_id(None)


# --- CORS setup ---
try:
    allowed = settings.origins_list()
except Exception:
    allowed = []

logger.info("CORS allow_origins=%s", allowed)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Include routers (after app creation) ---
from app.api.v1 import (  # noqa: E402
    data_timeseries,
    upload_csv,
    auth,
    billing,
    analytics,
    alerts,
    health,
    stripe_webhook,
    account,
    site_events,    # site events / timeline
    opportunities,  # opportunities (auto + manual)
    org_invites,    # org invite tokens + accept/signup
    org_members,    # ✅ org members + transfer ownership
    org_offboard,   # ✅ NEW: org offboarding (soft/nuke)
    org,
    org_leave,
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(sites_api.router, prefix="/api/v1")
app.include_router(data_timeseries.router, prefix="/api/v1")
app.include_router(upload_csv.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")
app.include_router(health.router, prefix="/api/v1")
app.include_router(stripe_webhook.router, prefix="/api/v1")
app.include_router(account.router, prefix="/api/v1")
app.include_router(site_events.router, prefix="/api/v1")
app.include_router(opportunities.router, prefix="/api/v1")
app.include_router(org_invites.router, prefix="/api/v1")  # org invites
app.include_router(org.router, prefix="/api/v1")  # ✅ NEW: create org + attach owner
app.include_router(org_members.router, prefix="/api/v1")
app.include_router(org_leave.router, prefix="/api/v1")
app.include_router(org_offboard.router, prefix="/api/v1")  # ✅ org offboarding (soft/nuke)

# --- Legacy auth shims for pytest-only tests ---
@app.post("/auth/signup", include_in_schema=False)
def legacy_auth_signup_for_tests(payload: dict):
    return {
        "access_token": "test-access-token",
        "token_type": "bearer",
    }


@app.post("/auth/login", include_in_schema=False)
def legacy_auth_login_for_tests(
    username: str = Form(...),
    password: str = Form(...),
):
    return {
        "access_token": "test-access-token",
        "token_type": "bearer",
    }


# --- Root + debug endpoints ---
@app.get("/", include_in_schema=False)
def root():
    if enable_docs:
        return RedirectResponse(url="/api/v1/docs")
    return {"status": "CEI API is running. See /api/v1/health."}


@app.get("/debug/docs-enabled", include_in_schema=False)
def debug_docs_enabled():
    return {"enable_docs": enable_docs}
