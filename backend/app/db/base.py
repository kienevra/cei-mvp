# backend/app/db/base.py

"""
Single source of truth for the SQLAlchemy Declarative Base.

IMPORTANT:
- This file must NOT import app.models or app.db.models.
  Doing so creates circular import issues when FastAPI/Uvicorn
  imports app.main -> app.models -> app.db.base -> app.db.models -> app.models.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass
