"""
SQLAlchemy engine + session factory for CEI backend.

This module creates a SQLAlchemy engine reading DATABASE_URL from app.core.config.settings.
It supports cloud Postgres SSL by detecting "sslmode=require" in the URL or PGSSLMODE env var.

Exports:
- engine: SQLAlchemy Engine
- SessionLocal: sessionmaker bound to engine
- get_db: FastAPI dependency (generator)
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import OperationalError

from app.core.config import settings

# Determine connect_args for SSL if indicated
connect_args = {}
db_url = settings.DATABASE_URL

# If the DB URL explicitly requests sslmode=require OR the PGSSLMODE env var is set,
# set the connect_args so psycopg2 uses SSL. Some hosted Postgres instances require this.
if (os.getenv("PGSSLMODE", "").lower() == "require") or ("sslmode=require" in (db_url or "").lower()):
    # For psycopg2: pass sslmode in connect_args
    connect_args = {"sslmode": "require"}

# Create engine; pool_pre_ping avoids stale connections
engine = create_engine(db_url, connect_args=connect_args, pool_pre_ping=True)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """
    FastAPI dependency that yields a DB session and closes it when finished.
    Usage:
        from app.db.session import get_db
        def endpoint(db: Session = Depends(get_db)): ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.close()
        except OperationalError:
            # If the DB connection died, close may raise; ignore in cleanup
            pass
