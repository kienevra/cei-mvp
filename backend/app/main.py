# backend/app/main.py
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cei")

# Decide whether docs should be exposed (default: False in prod)
# settings.enable_docs should come from env (e.g. ENABLE_DOCS=true in dev/staging)

enable_docs = getattr(settings, "enable_docs", False)
logger.info(f"Startup: settings.ENABLE_DOCS={getattr(settings, 'ENABLE_DOCS', None)} enable_docs={enable_docs}")

app = FastAPI(
    title="CEI API",
    openapi_url="/api/v1/openapi.json" if enable_docs else None,
    docs_url="/api/v1/docs" if enable_docs else None,
    redoc_url="/api/v1/redoc" if enable_docs else None,
)

# Use settings.origins_list()
origins = settings.origins_list() or ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# include routers
from app.api.v1 import data_timeseries, upload_csv  # noqa: E402

app.include_router(data_timeseries.router, prefix="/api/v1")
app.include_router(upload_csv.router, prefix="/api/v1")

# Minimal landing — redirect to docs if docs are enabled (convenience)
@app.get("/", include_in_schema=False)
def root():
    if enable_docs:
        return RedirectResponse(url="/api/v1/docs")
    return {"status": "CEI API is running. See /health."}


# Debug endpoint to check docs flag
@app.get("/debug/docs-enabled", include_in_schema=False)
def debug_docs_enabled():
    return {"enable_docs": enable_docs}

@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}
