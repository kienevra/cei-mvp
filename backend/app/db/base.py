"""
Central SQLAlchemy Base metadata.

This module's job is:
- Expose `Base` to the rest of the app.
- Import all model modules so their tables are registered on `Base.metadata`
  before we call Base.metadata.create_all(...) in init_sqlite_db.
"""

from app.db.base_class import Base  # <- the canonical Base used by models

# Import all model definitions so they attach themselves to Base.metadata
# NOTE: The imports are intentionally unused; the side effect of importing
# the modules is what registers the tables.
from app import models as app_models  # noqa: F401
from app.db import models as db_models  # noqa: F401
