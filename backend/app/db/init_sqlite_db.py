# backend/app/db/init_sqlite_db.py

import logging

from app.db.session import engine
from app.db.base import Base

# IMPORTANT: import models so all Base subclasses are registered
from app import models as app_models  # noqa: F401
from app.db import models as db_models  # noqa: F401

logger = logging.getLogger("cei")


def init_db() -> None:
    """
    Initialize the local SQLite dev database by creating any missing tables
    based on the current SQLAlchemy models (Base subclasses).
    """
    print("Creating all tables on SQLite database using Base.metadata.create_all(...)")
    Base.metadata.create_all(bind=engine)
    print("Done.")


if __name__ == "__main__":
    init_db()
