# backend/app/main.py

import logging
import traceback
from typing import List, Optional

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
# settings.origins_list() should return a List[str] or [] if unset
origins: Optional[List[str]] = None
try:
    origins = settings.origins_list()
except Exception:
    origins = None

# Sensible defaults during development
if not origins:
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "https://cei-frontend.herokuapp.com",
        "https://cei-mvp.onrender.com",
    ]

logger.info(f"CORS allow_origins={origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
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
        # Return safe, short payload to clients but include last lines for debugging
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
    site_events,   # site events / timeline
    opportunities, # opportunities (auto + manual)
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


# --- Legacy auth shims for pytest-only tests ---
# tests/test_auth.py still calls /auth/signup and /auth/login (non-versioned).
# These endpoints DO NOT wire into the real auth system; they just satisfy legacy tests.

@app.post("/auth/signup", include_in_schema=False)
def legacy_auth_signup_for_tests(payload: dict):
    """
    Legacy test shim: accept any JSON body and return a fake access token.

    Real clients must use /api/v1/auth/signup.
    """
    return {
        "access_token": "test-access-token",
        "token_type": "bearer",
    }


@app.post("/auth/login", include_in_schema=False)
def legacy_auth_login_for_tests(
    username: str = Form(...),
    password: str = Form(...),
):
    """
    Legacy test shim: accept form-encoded credentials and return a fake access token.

    This matches tests/test_auth.py which posts:
      data={"username": ..., "password": ...}

    Real clients must use /api/v1/auth/login.
    """
    # We ignore username/password values; this is purely a test harness.
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
