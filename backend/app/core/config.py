from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str = "change-me"
    PGSSLMODE: Optional[str] = None

    class Config:
        env_file = ".env"

settings = Settings()
