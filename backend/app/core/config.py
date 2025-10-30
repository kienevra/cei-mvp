# backend/app/core/config.py
from __future__ import annotations
from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings
from pydantic import ConfigDict
import os

class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    Add new top-level env keys here so pydantic validation doesn't fail.
    """

    # Pydantic v2 settings config
    model_config = ConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
        env_file_encoding="utf-8",
        # keep strict by default. We explicitly declare the env vars we expect.
        extra="forbid",
    )

    # General
    ENABLE_DOCS: bool = Field(False, env="ENABLE_DOCS")
    VITE_API_URL: str = Field("http://localhost:5173", env="VITE_API_URL")
    ALLOWED_ORIGINS: Optional[str] = Field(None, env="ALLOWED_ORIGINS")

    # Database
    DATABASE_URL: Optional[str] = Field(None, env="DATABASE_URL")
    PGSSLMODE: Optional[str] = Field(None, env="PGSSLMODE")

    # Auth / JWT
    JWT_SECRET: str = Field("supersecret", env="JWT_SECRET")
    SECRET_KEY: Optional[str] = Field(None, env="SECRET_KEY")

    # Stripe / Billing
    STRIPE_SECRET_KEY: Optional[str] = Field(None, env="STRIPE_SECRET_KEY")
    STRIPE_WEBHOOK_SECRET: Optional[str] = Field(None, env="STRIPE_WEBHOOK_SECRET")
    STRIPE_PRICE_ID_MONTHLY: Optional[str] = Field(None, env="STRIPE_PRICE_ID_MONTHLY")
    STRIPE_TRIAL_DAYS: int = Field(182, env="STRIPE_TRIAL_DAYS")

    # Frontend keys (exposed to frontend in build)
    VITE_STRIPE_PUBLIC_KEY: Optional[str] = Field(None, env="VITE_STRIPE_PUBLIC_KEY")

    # Other app-specific toggles
    DEBUG: bool = Field(False, env="DEBUG")

    def origins_list(self) -> List[str]:
        """
        Parse ALLOWED_ORIGINS environment variable into a list.
        Accepts comma-separated string or returns a default local origin.
        """
        if self.ALLOWED_ORIGINS:
            # strip spaces and skip empty parts
            parts = [p.strip() for p in self.ALLOWED_ORIGINS.split(",") if p.strip()]
            return parts
        # sensible defaults for local dev
        return ["http://localhost:5173", "http://127.0.0.1:5173"]

# instantiate global settings once
settings = Settings()
