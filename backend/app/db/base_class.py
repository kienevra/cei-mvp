# backend/app/db/base_class.py
from sqlalchemy.orm import declarative_base

# Canonical SQLAlchemy Base for all models
Base = declarative_base()
