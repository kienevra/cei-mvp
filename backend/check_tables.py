from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv
from pathlib import Path

# force-load the exact .env file
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

DATABASE_URL = os.getenv("DATABASE_URL")

print("ENV PATH:", env_path)
print("DATABASE_URL:", DATABASE_URL)  # 👈 critical debug

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema='public';
    """))
    
    for row in result:
        print(row)