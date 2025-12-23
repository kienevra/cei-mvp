# backend/app/db/init_sqlite_db.py

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from sqlalchemy.engine import Engine

from app.db.session import engine
from app.db.base import Base

# IMPORTANT: import models so all Base subclasses are registered
import app.models  # noqa: F401


def _resolve_sqlite_path(e: Engine) -> Optional[Path]:
    """
    Best-effort: resolve the actual SQLite file path from the SQLAlchemy engine URL.

    Handles:
    - sqlite:///relative/path.db  (relative to current working directory)
    - sqlite:////absolute/path.db
    - sqlite:///C:/Windows/style/path.db
    """
    url = str(e.url)
    if not url.startswith("sqlite"):
        return None

    # SQLAlchemy URL examples:
    # - sqlite:///../dev.db
    # - sqlite:////tmp/dev.db
    # - sqlite:///C:/cei-mvp/dev.db
    # - sqlite:///:memory:
    if ":memory:" in url:
        return None

    # Remove prefix variants carefully
    # Prefer using e.url.database if available
    try:
        db = e.url.database  # type: ignore[attr-defined]
    except Exception:
        db = None

    if not db:
        # Fallback parse
        if url.startswith("sqlite:////"):
            db = url.replace("sqlite:////", "/")
        elif url.startswith("sqlite:///"):
            db = url.replace("sqlite:///", "")
        else:
            return None

    p = Path(db)

    # If it's a relative path, resolve against current working directory
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()

    return p


def init_db(*, checkfirst: bool = True, echo_path: bool = True) -> None:
    """
    Initialize the local SQLite dev database by creating any missing tables
    based on the current SQLAlchemy models (Base subclasses).

    - checkfirst=True ensures DDL is idempotent (won't recreate existing tables/indexes)
    - echo_path prints the resolved DB file path to prevent "wrong dev.db" surprises
    """
    print("Initializing database via Base.metadata.create_all(...)")
    print(f"Engine URL: {engine.url}")

    db_path = _resolve_sqlite_path(engine)
    if echo_path:
        if db_path is None:
            print("Resolved SQLite path: (not a file db; maybe :memory: or non-sqlite)")
        else:
            print(f"Resolved SQLite path: {db_path}")
            if db_path.exists():
                print(f"DB exists: True (size={db_path.stat().st_size} bytes)")
            else:
                print("DB exists: False (will be created on first write / DDL)")

    # Create missing tables/indexes. checkfirst=True is key for idempotency.
    Base.metadata.create_all(bind=engine, checkfirst=checkfirst)

    print("Done.")


def reset_db() -> None:
    """
    DANGEROUS: wipes the SQLite file, then recreates schema.
    Use only if your schema is corrupted or you accidentally pointed at the wrong dev.db.
    """
    db_path = _resolve_sqlite_path(engine)
    if db_path is None:
        raise RuntimeError("reset_db() only supports file-based SQLite databases.")

    if db_path.exists():
        backup = db_path.with_suffix(db_path.suffix + ".bad")
        print(f"Backing up existing DB: {db_path} -> {backup}")
        if backup.exists():
            backup.unlink()
        db_path.rename(backup)

    init_db(checkfirst=True, echo_path=True)


if __name__ == "__main__":
    # Default behavior: safe, idempotent init
    init_db(checkfirst=True, echo_path=True)

    # If you ever need a hard reset locally, uncomment:
    # reset_db()
