from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from app.core.config import settings

# Routers
from app.api.v1.auth import router as auth_router
from app.api.v1.health import router as health_router
from app.api.v1.data_timeseries import router as data_timeseries_router
from app.api.v1.upload_csv import router as upload_csv_router
from app.api.v1.webhook import router as webhook_router
from app.api.v1.opportunities import router as opportunities_router
from app.api.v1.reports import router as reports_router

logger = logging.getLogger("uvicorn")

origins = settings.origins_list if settings.ALLOWED_ORIGINS else ["http://localhost:5173"]

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(health_router)
app.include_router(data_timeseries_router)
app.include_router(upload_csv_router)
app.include_router(webhook_router)
app.include_router(opportunities_router)
app.include_router(reports_router)

@app.on_event("startup")
async def startup_event():
    logger.info("Starting CEI backend...")
    if settings.DATABASE_URL:
        try:
            import subprocess
            logger.info("Running Alembic migrations...")
            subprocess.run(["alembic", "upgrade", "head"], check=True)
        except Exception as e:
            logger.error(f"Alembic migration failed: {e}")
    else:
        logger.warning("DATABASE_URL not set. Skipping migrations.")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down CEI backend...")

@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok"}
