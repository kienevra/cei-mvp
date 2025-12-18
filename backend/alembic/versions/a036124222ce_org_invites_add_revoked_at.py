"""org_invites add revoked_at

Revision ID: a036124222ce
Revises: cff1f49a9d1c
Create Date: 2025-12-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "a036124222ce"
down_revision = "cff1f49a9d1c"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = insp.get_columns(table_name)
    return any(c["name"] == column_name for c in cols)


def upgrade():
    # Add org_invites.revoked_at (nullable). Must be idempotent because Render DB may already be partially migrated.
    if not _column_exists("org_invites", "revoked_at"):
        # batch_alter_table keeps SQLite happy even if you run this locally with SQLite.
        with op.batch_alter_table("org_invites") as batch_op:
            batch_op.add_column(sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    # Safe rollback: only drop if present
    if _column_exists("org_invites", "revoked_at"):
        with op.batch_alter_table("org_invites") as batch_op:
            batch_op.drop_column("revoked_at")
