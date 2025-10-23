import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cei")

app = FastAPI(title="CEI API")

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


@app.get("/health")
def health():
    return {"status": "ok"}
