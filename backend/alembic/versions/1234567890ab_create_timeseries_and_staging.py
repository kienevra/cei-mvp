"""Initial timeseries/staging migration (no-op for SQLite dev).

In this SQLite dev setup, the timeseries-related tables are created via
SQLAlchemy's Base.metadata.create_all() in app.db.init_sqlite_db, not via Alembic.
"""

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

# revision identifiers, used by Alembic.
revision = "1234567890ab"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    No-op for SQLite dev.

    We intentionally do NOT create staging_upload or timeseries_record here.
    Those tables are created by Base.metadata.create_all() in app.db.init_sqlite_db
    so that the DB schema always matches the SQLAlchemy models.
    """
    pass


def downgrade() -> None:
    """
    No-op for SQLite dev.

    If you ever need to drop timeseries-related tables, do it manually in SQLite.
    """
    pass
