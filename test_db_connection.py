import os, sys, traceback
from sqlalchemy import create_engine, text

url = os.environ.get("DATABASE_URL")
if not url:
    print("ERROR: DATABASE_URL environment variable is not set.")
    sys.exit(2)

# Print masked URL for safety
mask = url
try:
    # Mask password between : and @ if present
    import re
    mask = re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", url, count=1)
except Exception:
    pass
print("Using DB URL (masked):", mask)

# Ensure connect_args uses sslmode when required
connect_args = {}
if "sslmode=require" in url or os.environ.get("PGSSLMODE","").lower() == "require":
    connect_args = {"sslmode":"require"}

try:
    engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
    with engine.connect() as conn:
        ver = conn.execute(text("select version()")).scalar()
        one = conn.execute(text("select 1")).scalar()
        print("Connected. PG version:", ver)
        print("select 1 ->", one)
except Exception:
    traceback.print_exc()
    sys.exit(1)
