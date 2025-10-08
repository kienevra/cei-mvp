"""
Test database connection script for CEI backend.

How to run inside the container:
    docker compose up -d --build backend
    docker compose exec backend python backend/scripts/test_db_connection.py
"""

from sqlalchemy import create_engine, text
from app.core.config import settings

def test_connection():
    try:
        engine = create_engine(settings.DATABASE_URL)
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            print("Database connection successful. Result:", result.scalar())
    except Exception as e:
        print("Database connection failed!")
        print("Error details:", e)

if __name__ == "__main__":
    test_connection()
