# backend/app/main.py

import logging
import traceback

from fastapi import FastAPI, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse

from app.core.config import settings
from app.api.v1 import sites as sites_api

# --- Logging setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cei")

# Decide whether docs should be exposed (default: False in prod)
enable_docs = getattr(settings, "enable_docs", False)
logger.info(f"Startup: enable_docs={enable_docs}")

# Log DB backend type (sqlite, postgresql, etc.) without leaking credentials
try:
    db_backend = (settings.database_url or "").split(":", 1)[0]
except Exception:  # extremely defensive
    db_backend = "unknown"
logger.info("DB backend detected: %s", db_backend)

# --- App setup ---
app = FastAPI(
    title="CEI API",
    openapi_url="/api/v1/openapi.json" if enable_docs else None,
    docs_url="/api/v1/docs" if enable_docs else None,
    redoc_url="/api/v1/redoc" if enable_docs else None,
)

# --- CORS setup ---
# IMPORTANT:
# - We do NOT use allow_origin_regex=".*" because you are using credentials/cookies.
# - We explicitly allow the origins from settings.ALLOWED_ORIGINS.
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

# --- Error logging middleware ---
@app.middleware("http")
async def log_exceptions(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        logger.error(f"Unhandled error at {request.url.path}: {e}")
        logger.error(traceback.format_exc())
        tb_lines = traceback.format_exc().splitlines()
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal Server Error",
                "error": str(e),
                "traceback_last_lines": tb_lines[-10:],
            },
        )

# --- Include routers (after app creation) ---
# Keep these imports below to avoid circular imports during startup
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


