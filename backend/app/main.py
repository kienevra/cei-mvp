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

# --- request context / db metrics (tolerant to module drift) ---
from app.core.request_context import (
    set_request_id,
    reset_db_metrics,
    get_db_metrics,
    clear_db_metrics,
    get_request_id,
)

# Optional auth-context helpers (may not exist in some snapshots)
try:
    from app.core.request_context import get_auth_context_snapshot  # type: ignore
except Exception:
    def get_auth_context_snapshot() -> dict:  # type: ignore
        return {}

try:
    from app.core.request_context import clear_auth_context  # type: ignore
except Exception:
    def clear_auth_context() -> None:  # type: ignore
        return


# --- Logging setup ---
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

try:
    from app.core.errors import install_request_id_logging  # type: ignore

    install_request_id_logging()
except Exception:
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

enable_docs = getattr(settings, "enable_docs", False)
logger.info("Startup: enable_docs=%s", enable_docs)

try:
    db_backend = (settings.database_url or "").split(":", 1)[0]
except Exception:
    db_backend = "unknown"
logger.info("DB backend detected: %s", db_backend)

SLOW_HTTP_MS = getattr(settings, "slow_http_ms", 1500)

app = FastAPI(
    title="CEI API",
    openapi_url="/api/v1/openapi.json" if enable_docs else None,
    docs_url="/api/v1/docs" if enable_docs else None,
    redoc_url="/api/v1/redoc" if enable_docs else None,
)


def _get_request_id(request: Request) -> str:
    incoming = request.headers.get("x-request-id") or request.headers.get("x-correlation-id")
    if incoming and isinstance(incoming, str) and incoming.strip():
        return incoming.strip()[:128]
    return uuid.uuid4().hex


def _client_ip(request: Request) -> str:
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
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "request_id": request_id,
        "detail": {"code": code, "message": message},
    }
    if extra:
        payload.update(extra)
    return payload


def _http_exception_payload(exc: HTTPException, *, request_id: str) -> dict:
    code = f"HTTP_{exc.status_code}"

    if isinstance(exc.detail, dict):
        msg = exc.detail.get("message")
        if not isinstance(msg, str) or not msg.strip():
            msg = "Request failed."

        merged_detail: dict[str, Any] = {"code": code, "message": msg}
        merged_detail.update(exc.detail)

        return _error_payload(code=code, message=msg, request_id=request_id, extra={"detail": merged_detail})

    msg = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return _error_payload(code=code, message=msg, request_id=request_id)


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
        if isinstance(e, HTTPException) or isinstance(e, RequestValidationError):
            raise

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

        m = get_db_metrics()
        db_total_ms = m.total_ms
        db_q = m.query_count
        db_slowest_ms = m.slowest_ms

        slow_db_total_ms = float(getattr(settings, "slow_db_total_ms", 800.0))

        # Pull auth context late (dependencies run during request handling)
        auth_snap = {}
        try:
            auth_snap = get_auth_context_snapshot() or {}
        except Exception:
            auth_snap = {}

        auth_type = auth_snap.get("auth_type", "unknown")
        org_id = auth_snap.get("org_id", None)
        itok_id = auth_snap.get("integration_token_id", None)
        user_id = auth_snap.get("user_id", None)

        log_fn = logger.warning if duration_ms >= float(SLOW_HTTP_MS) else logger.info
        log_fn(
            "req request_id=%s method=%s path=%s status=%s duration_ms=%.2f db_total_ms=%.2f db_q=%s db_slowest_ms=%.2f auth_type=%s org_id=%s user_id=%s integration_token_id=%s ip=%s ua=%s",
            request_id,
            request.method,
            request.url.path,
            status_code,
            duration_ms,
            db_total_ms,
            db_q,
            db_slowest_ms,
            auth_type,
            org_id,
            user_id,
            itok_id,
            _client_ip(request),
            (request.headers.get("user-agent") or "").replace(" ", "_")[:200],
        )

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
        try:
            clear_auth_context()
        except Exception:
            pass
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
    site_events,
    opportunities,
    org_invites,
    org_members,
    org_offboard,
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
app.include_router(org_invites.router, prefix="/api/v1")
app.include_router(org.router, prefix="/api/v1")
app.include_router(org_members.router, prefix="/api/v1")
app.include_router(org_leave.router, prefix="/api/v1")
app.include_router(org_offboard.router, prefix="/api/v1")


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


@app.get("/", include_in_schema=False)
def root():
    if enable_docs:
        return RedirectResponse(url="/api/v1/docs")
    return {"status": "CEI API is running. See /api/v1/health."}


@app.get("/debug/docs-enabled", include_in_schema=False)
def debug_docs_enabled():
    return {"enable_docs": enable_docs}
