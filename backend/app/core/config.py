# old
# from pydantic import BaseSettings

# new
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    # add any other environment variables you use

    class Config:
        env_file = ".env"

settings = Settings()
