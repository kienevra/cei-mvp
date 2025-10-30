# app/db/base.py
from sqlalchemy.orm import declarative_base

# Single declarative Base shared by the application and Alembic
Base = declarative_base()
