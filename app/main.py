from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.health import router as health_router
from app.api.v1.auth import router as auth_router
from app.api.v1.opportunities import router as opportunities_router
from app.api.v1.reports import router as reports_router

app = FastAPI()
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://cei-mvp.vercel.app",
    "https://cei-ddmiued24-leons-projects-d3d4c274.vercel.app",
    "https://cei-mvp-git-main-leons-projects-d3d4c274.vercel.app",
    "https://cei-mvp.onrender.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # Use the full list defined above
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(opportunities_router, prefix="/api/v1")
app.include_router(reports_router, prefix="/api/v1")
