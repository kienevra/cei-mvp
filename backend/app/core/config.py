from functools import lru_cache
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Central configuration for CEI backend.

    All values come from environment variables or backend/.env.
    This is the single source of truth for:
    - environment (dev/staging/prod)
    - database URL
    - CORS / allowed origins
    - docs toggle
    - auth / token settings
    - Stripe / billing settings
    """

    # Pydantic Settings config
    # - env_file: backend/.env
    # - extra="ignore": tolerate legacy env vars like BACKEND_CORS_ORIGINS
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # High-level environment flags
    environment: str = Field(
        default="dev",
        description="Deployment environment identifier (dev|staging|prod)",
        env="ENVIRONMENT",
    )
    debug: bool = Field(default=True, env="DEBUG")

    # Database
    database_url: str = Field(
        default="sqlite:///../dev.db",
        env="DATABASE_URL",
        description="SQLAlchemy-style DB URL (SQLite for dev, Postgres in prod).",
    )

    # Auth / tokens
    jwt_secret: str = Field(
        default="supersecret",
        env="JWT_SECRET",
        description="JWT signing secret; override in all non-dev environments.",
    )
    jwt_algorithm: str = Field(
        default="HS256",
        env="JWT_ALGORITHM",
        description="JWT signing algorithm. HS256 by default.",
    )
    access_token_expire_minutes: int = Field(
        default=60,
        env="ACCESS_TOKEN_EXPIRE_MINUTES",
        description="Access token lifetime in minutes.",
    )
    refresh_token_expire_days: int = Field(
        default=7,
        env="REFRESH_TOKEN_EXPIRE_DAYS",
        description="Refresh token lifetime in days.",
    )

    # CORS / frontends
    allowed_origins: str = Field(
        default=(
            "http://localhost:5173,"
            "http://127.0.0.1:5173,"
            "https://cei-frontend.herokuapp.com,"
            "https://cei-mvp.onrender.com"
        ),
        env="ALLOWED_ORIGINS",
        description="Comma-separated list of allowed frontend origins.",
    )

    # API docs toggle
    enable_docs: bool = Field(
        default=False,
        env="ENABLE_DOCS",
        description="If true, exposes /api/v1/docs and /api/v1/redoc.",
    )

    # Stripe / billing
    stripe_api_key: Optional[str] = Field(
        default=None,
        env="STRIPE_API_KEY",
        description="Secret key for Stripe API; leave empty in dev if billing disabled.",
    )
    stripe_webhook_secret: Optional[str] = Field(
        default=None,
        env="STRIPE_WEBHOOK_SECRET",
        description="Stripe webhook signing secret; required to validate Stripe webhooks.",
    )

    def origins_list(self) -> List[str]:
        """
        Split ALLOWED_ORIGINS into a list for CORSMiddleware.
        """
        if not self.allowed_origins:
            return []
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def stripe_enabled(self) -> bool:
        """
        Convenience flag: Stripe is 'enabled' only if both API key and webhook secret are present.
        """
        return bool(self.stripe_api_key and self.stripe_webhook_secret)

    @property
    def is_prod(self) -> bool:
        """
        Convenience flag: true if running in a production-like environment.
        """
        return self.environment.lower() in {"prod", "production"}


@lru_cache()
def get_settings() -> Settings:
    """
    Cached settings instance so the app only parses env once.
    """
    return Settings()


settings = get_settings()
