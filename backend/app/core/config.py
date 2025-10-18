from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    pgsslmode: str = "disable"
    jwt_secret: str = "inevergraduated"
    allowed_origins: str = "http://127.0.0.1:3000,http://localhost:3000,https://cei-mvp.vercel.app,https://cei-mvp-git-main-leons-projects-d3d4c274.vercel.app,https://cei-28ywh4fmm-leons-projects-d3d4c274.vercel.app,https://cei-mvp.onrender.com"
    supabase_url: str = "https://obkaghiuibrsmjwazphi.supabase.co"
    supabase_service_role_key: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ia2FnaGl1aWJyc21qd2F6cGhpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTQwNDc5NiwiZXhwIjoyMDc0OTgwNzk2fQ.ShE1JOVIIA20wnyK7AKx6EzY6tTXNZBzTDle0HZ7gI4"
    env: str = "development"
    debug: bool = True
    port: int = 8000

    # Add any other fields your app requires here

    class Config:
        extra = "forbid"  # Prevents extra fields; change to "allow" if you want to permit extras

settings = Settings()