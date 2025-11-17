# backend/app/db/init_sqlite_db.py

from app.db.session import engine
from app.db.base import Base  # This is the Base your models inherit from

# Import models to ensure they are registered with Base.metadata
from app import models  # noqa: F401


def init_db() -> None:
    """
    Initialize the SQLite database by creating all tables
    defined on the SQLAlchemy Base metadata.
    Safe to run multiple times; only creates missing tables.
    """
    print("Creating all tables on SQLite database using Base.metadata.create_all(...)")
    Base.metadata.create_all(bind=engine)
    print("Done.")


if __name__ == "__main__":
    init_db()
