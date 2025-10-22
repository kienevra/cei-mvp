from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional, List

class Settings(BaseSettings):
    """
    Application configuration loaded from environment variables or .env file.
    Example .env:
    DATABASE_URL=postgresql://user:pass@host:5432/dbname
    PGSSLMODE=require
    JWT_SECRET=supersecret
    ALLOWED_ORIGINS=http://localhost:5173,https://cei-mvp.vercel.app
    GATEWAY_SHARED_SECRET=sharedsecret
    SUPABASE_URL=https://xyz.supabase.co
    SUPABASE_KEY=your_supabase_key
    REDIS_URL=redis://localhost:6379/0
    """
    DATABASE_URL: Optional[str] = None
    PGSSLMODE: str = "require"
    JWT_SECRET: str
    ALLOWED_ORIGINS: str
    GATEWAY_SHARED_SECRET: Optional[str] = None
    SUPABASE_URL: Optional[str] = None
    SUPABASE_KEY: Optional[str] = None
    REDIS_URL: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def origins_list(self) -> List[str]:
        """Return allowed origins as a list, stripping whitespace."""
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

settings = Settings()