# app/core/config.py
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # DB & infra
    DATABASE_URL: Optional[str] = None
    PGSSLMODE: str = "require"
    REDIS_URL: Optional[str] = None
    VITE_API_URL: Optional[str] = None

    # Auth & security
    JWT_SECRET: str = Field(..., env="JWT_SECRET")
    SECRET_KEY: Optional[str] = None

    # Origins for CORS, comma-separated (example: "https://app.vercel.app,https://cei-mvp.onrender.com")
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    # Feature flags / runtime toggles
    ENABLE_DOCS: bool = Field(False, env="ENABLE_DOCS")  # set ENABLE_DOCS=true to expose /api/v1/docs

    # Gateway secrets (optional)
    GATEWAY_SHARED_SECRET: Optional[str] = None

    # Optional supabase
    SUPABASE_URL: Optional[str] = None
    SUPABASE_KEY: Optional[str] = None

    class Config:
        env_file = ".env"
        case_sensitive = True

    def origins_list(self) -> List[str]:
        """Return ALLOWED_ORIGINS as a list of origins (stripped)."""
        return [o.strip() for o in (self.ALLOWED_ORIGINS or "").split(",") if o.strip()]


# instantiate settings (reads from env / .env)
settings = Settings()
