# backend/app/main.py
import logging
import traceback
import os
from typing import List
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from app.core.config import settings

# --- Logging setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cei")

# Decide whether docs should be exposed (default: False in prod)
enable_docs = getattr(settings, "enable_docs", False)
logger.info(
    f"Startup: settings.ENABLE_DOCS={getattr(settings, 'ENABLE_DOCS', None)} enable_docs={enable_docs}"
)

# --- App setup ---
app = FastAPI(
    title="CEI API",
    openapi_url="/api/v1/openapi.json" if enable_docs else None,
    docs_url="/api/v1/docs" if enable_docs else None,
    redoc_url="/api/v1/redoc" if enable_docs else None,
)


def _build_origins_list() -> List[str]:
    """
    Build a list of allowed origins for CORS in this order of preference:
     - If the Settings object exposes an 'origins_list()' helper, use it
     - Else, read settings.allowed_origins (comma-separated) if present
     - Always include common localhost dev hosts
     - Add common deployment hosts from env vars (VERCEL_URL, RENDER_EXTERNAL_URL, FRONTEND_URL)
     - Ensure list is unique and non-empty fallback to localhost dev origin.
    """
    origins: List[str] = []

    # 1) settings.origins_list() if present
    try:
        ol = getattr(settings, "origins_list", None)
        if callable(ol):
            origins = ol() or []
    except Exception:
        origins = []

    # 2) fallback to settings.allowed_origins (comma-separated)
    if not origins:
        ao = getattr(settings, "allowed_origins", None)
        if ao:
            if isinstance(ao, (list, tuple)):
                origins = list(ao)
            else:
                origins = [o.strip() for o in str(ao).split(",") if o.strip()]

    # 3) ensure common local dev origins are present
    dev_defaults = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"]
    for d in dev_defaults:
        if d not in origins:
            origins.append(d)

    # 4) add Vercel / Render / explicit frontend env hosts if present
    vercel_url = os.environ.get("VERCEL_URL")  # e.g. my-app.vercel.app (without scheme)
    if vercel_url:
        candidate = vercel_url if vercel_url.startswith("http") else f"https://{vercel_url}"
        if candidate not in origins:
            origins.append(candidate)

    render_url = os.environ.get("RENDER_EXTERNAL_URL") or os.environ.get("RENDER_URL")
    if render_url and render_url not in origins:
        origins.append(render_url if render_url.startswith("http") else f"https://{render_url}")

    # optional explicit frontend URL environment variables you might set
    for key in ("FRONTEND_URL", "VITE_APP_URL", "VITE_FRONTEND_URL"):
        v = os.environ.get(key)
        if v and v not in origins:
            origins.append(v if v.startswith("http") else f"https://{v}")

    # Always add our known deploy subdomains from your project if not present
    known = ["https://cei-mvp.vercel.app", "https://cei-mvp.onrender.com"]
    for k in known:
        if k not in origins:
            origins.append(k)

    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for o in origins:
        if o not in seen:
            seen.add(o)
            deduped.append(o)

    # if nothing at all, ensure a sane default
    return deduped or ["http://localhost:5173"]


# --- CORS setup ---
origins = _build_origins_list()
logger.info(f"Configured CORS origins: {origins}")

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
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal Server Error",
                "error": str(e),
                "traceback": traceback.format_exc().splitlines()[-10:],  # last 10 lines
            },
        )


# --- Include routers (after app creation) ---
# import routers here so they pick up the app and middleware already configured
from app.api.v1 import data_timeseries, upload_csv, auth, billing  # noqa: E402

app.include_router(data_timeseries.router, prefix="/api/v1")
app.include_router(upload_csv.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")  # exposes /api/v1/auth/*
app.include_router(billing.router, prefix="/api/v1")  # exposes /api/v1/billing/*


# --- Root and utilities ---
@app.get("/", include_in_schema=False)
def root():
    if enable_docs:
        return RedirectResponse(url="/api/v1/docs")
    return {"status": "CEI API is running. See /health or /api/v1/health."}


@app.get("/debug/docs-enabled", include_in_schema=False)
def debug_docs_enabled():
    return {"enable_docs": enable_docs}


# Keep /health for simple checks
@app.get("/health", include_in_schema=False)
def health_root():
    return {"status": "ok"}


# Also expose the API-prefixed health endpoint so frontends hitting /api/v1/health succeed
@app.get("/api/v1/health", include_in_schema=False)
def health_api():
    return {"status": "ok"}
