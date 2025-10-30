# backend/app/core/config.py

import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Global application settings loaded from environment variables (.env or Render/Vercel).
    """

    # --- Core app configuration ---
    database_url: str
    pgsslmode: str = "require"
    jwt_secret: str
    secret_key: str
    allowed_origins: str = "*"

    # --- Stripe configuration ---
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None

    # --- Supabase configuration ---
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None

    # --- Misc environment info ---
    env: str = "production"
    port: int = 8000

    # --- Optional frontend key (for client-side Stripe) ---
    vite_stripe_public_key: str | None = None

    # --- Utility methods ---
    def origins_list(self) -> list[str]:
        """
        Converts comma-separated origins string into a list for CORS.
        """
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"  # allows Render/Vercel to define extra env vars safely


@lru_cache()
def get_settings() -> Settings:
    """
    Cached settings instance (used throughout the app).
    """
    return Settings()


# Global settings instance
settings = get_settings()
