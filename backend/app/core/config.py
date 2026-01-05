# backend/app/core/config.py
from functools import lru_cache
from typing import List, Optional

from json import loads as json_loads, JSONDecodeError

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
    - Email provider settings
    """

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
        description=(
            "Allowed frontend origins. Can be either a comma-separated string like "
            '"http://localhost:5173,http://127.0.0.1:5173" or a JSON list like '
            '["http://localhost:5173","http://127.0.0.1:5173"].'
        ),
    )

    # ✅ Deterministic frontend base URL used for invite links + password reset links
    frontend_url: str = Field(
        default="http://localhost:5173",
        env="FRONTEND_URL",
        description="Base URL for the CEI frontend (used to generate invite/reset links).",
    )

    # API docs toggle
    enable_docs: bool = Field(
        default=False,
        env="ENABLE_DOCS",
        description="If true, exposes /api/v1/docs and /api/v1/redoc.",
    )

    # ===== Observability / performance budgets (pilot hardening) =====

    slow_http_ms: int = Field(
        default=1500,
        env="SLOW_HTTP_MS",
        description="Warn when an HTTP request exceeds this duration (ms).",
    )
    slow_db_query_ms: int = Field(
        default=250,
        env="SLOW_DB_QUERY_MS",
        description="Warn when a single DB query exceeds this duration (ms).",
    )
    slow_db_total_ms: int = Field(
        default=800,
        env="SLOW_DB_TOTAL_MS",
        description="Warn when total DB time for a request exceeds this duration (ms).",
    )
    log_db_sql: bool = Field(
        default=False,
        env="LOG_DB_SQL",
        description="If true, include SQL text in slow query logs (keep false by default in pilots).",
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

    # ===== Email (password reset, support notifications later) =====
    email_provider: str = Field(
        default="log",
        env="EMAIL_PROVIDER",
        description="Email provider: log|smtp|resend. 'log' prints to console.",
    )
    resend_api_key: Optional[str] = Field(
        default=None,
        env="RESEND_API_KEY",
        description="Resend API key (required if EMAIL_PROVIDER=resend).",
    )
    email_from: str = Field(
        default="CEI <no-reply@carbonefficiencyintel.com>",
        env="EMAIL_FROM",
        description="Default From: sender for outbound emails.",
    )

    def origins_list(self) -> List[str]:
        raw = self.allowed_origins
        if not raw:
            return []

        if isinstance(raw, list):
            return [str(o).strip() for o in raw if str(o).strip()]

        raw_str = str(raw).strip()

        if raw_str.startswith("[") and raw_str.endswith("]"):
            try:
                parsed = json_loads(raw_str)
                if isinstance(parsed, list):
                    return [str(o).strip() for o in parsed if str(o).strip()]
            except JSONDecodeError:
                pass

        return [o.strip() for o in raw_str.split(",") if o.strip()]

    @property
    def ALLOWED_ORIGINS(self) -> str:
        return self.allowed_origins

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.stripe_api_key and self.stripe_webhook_secret)

    @property
    def is_prod(self) -> bool:
        return self.environment.lower() in {"prod", "production"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
