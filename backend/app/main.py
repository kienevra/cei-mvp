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


# --- CORS setup ---
def build_origins() -> List[str]:
    """
    Build a safe list of allowed origins:
      1. prefer settings.origins_list() if provided (should return a list)
      2. otherwise fall back to a sensible default (local dev)
      3. also include common env var values if present (VERCEL_URL, FRONTEND_URL, VITE_* vars)
    This lets you set frontend host(s) from environment without code changes.
    """
    origins: List[str] = []

    # 1) Try the settings helper if it exists and returns a sequence
    try:
        cfg_origins = settings.origins_list() if callable(getattr(settings, "origins_list", None)) else None
    except Exception:
        cfg_origins = None

    if cfg_origins:
        # Ensure it's a list of strings
        origins = [str(o).rstrip("/") for o in cfg_origins if o]
    else:
        # fallback defaults (dev)
        origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]

    # 2) Add environment-provided frontend hosts if present
    env_candidates = [
        os.environ.get("FRONTEND_URL"),
        os.environ.get("FRONTEND_ORIGIN"),
        os.environ.get("VITE_APP_URL"),
        os.environ.get("VITE_URL"),
        os.environ.get("VERCEL_URL"),
        os.environ.get("DEPLOYMENT_URL"),
    ]
    for v in env_candidates:
        if not v:
            continue
        v_str = str(v).strip()
        if v_str and not v_str.startswith("http"):
            v_str = "https://" + v_str
        v_str = v_str.rstrip("/")
        if v_str and v_str not in origins:
            origins.append(v_str)

    # 3) Add some commonly-used hosts if not present
    common_hosts = [
        "https://cei-mvp.vercel.app",
        "https://cei.vercel.app",
        "https://cei-mvp.onrender.com",
    ]
    for h in common_hosts:
        if h not in origins:
            origins.append(h)

    return [o for o in origins if o]


origins = build_origins()
logger.info(f"CORS allowed origins: {origins}")

# If you keep allow_credentials=True, you must provide explicit origins (not "*")
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
from app.api.v1 import data_timeseries, upload_csv, auth, billing  # noqa: E402

app.include_router(data_timeseries.router, prefix="/api/v1")
app.include_router(upload_csv.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")      # exposes /api/v1/auth/*
app.include_router(billing.router, prefix="/api/v1")   # exposes /api/v1/billing/*


# --- Root and utilities ---
@app.get("/", include_in_schema=False)
def root():
    if enable_docs:
        return RedirectResponse(url="/api/v1/docs")
    return {"status": "CEI API is running. See /health."}


@app.get("/debug/docs-enabled", include_in_schema=False)
def debug_docs_enabled():
    return {"enable_docs": enable_docs}


@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}
