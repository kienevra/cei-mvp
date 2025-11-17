# backend/app/main.py
import logging
import traceback
from typing import List, Optional

from fastapi import FastAPI, Request
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

# --- App setup ---
app = FastAPI(
    title="CEI API",
    openapi_url="/api/v1/openapi.json" if enable_docs else None,
    docs_url="/api/v1/docs" if enable_docs else None,
    redoc_url="/api/v1/redoc" if enable_docs else None,
)

# --- CORS setup ---
# settings.origins_list() should return a List[str] or None
origins: Optional[List[str]] = None
try:
    origins = settings.origins_list()
except Exception:
    origins = None

# sensible defaults during development
if not origins:
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
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
        # return safe, short payload to clients but include last lines for debugging
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
# keep these imports below to avoid circular import during startup
from app.api.v1 import data_timeseries, upload_csv, auth, billing  # noqa: E402

app.include_router(data_timeseries.router, prefix="/api/v1")
app.include_router(upload_csv.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(sites_api.router, prefix="/api/v1")


# --- Root + health endpoints ---
@app.get("/", include_in_schema=False)
def root():
    if enable_docs:
        return RedirectResponse(url="/api/v1/docs")
    return {"status": "CEI API is running. See /api/v1/health."}


@app.get("/debug/docs-enabled", include_in_schema=False)
def debug_docs_enabled():
    return {"enable_docs": enable_docs}


@app.get("/api/v1/health", include_in_schema=False)
def health():
    # This is the canonical api health endpoint used by the frontend
    return {"status": "ok"}
