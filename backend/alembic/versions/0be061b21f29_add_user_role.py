"""add user.role (idempotent)

Revision ID: 0be061b21f29
Revises: be01ef48d298
Create Date: 2025-12-12

NOTE:
This migration is idempotent because some environments may already have the
'user.role' column from earlier deploys or manual schema changes.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "0be061b21f29"
down_revision = "be01ef48d298"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table_name)]
    return column_name in cols


def upgrade():
    # Add user.role if missing
    if not _column_exists("user", "role"):
        op.add_column("user", sa.Column("role", sa.String(length=32), nullable=True))

    # Backfill to 'member' where null (safe if already backfilled)
    op.execute(sa.text('UPDATE "user" SET role = :r WHERE role IS NULL').bindparams(r="member"))

    # Make it NOT NULL if possible (skip if already non-null / or if constraint exists)
    # We do this in a guarded way to avoid blowing up on weird intermediate states.
    try:
        op.alter_column("user", "role", existing_type=sa.String(length=32), nullable=False)
    except Exception:
        # If it’s already NOT NULL or the DB rejects due to other constraints/state, do not block deploy.
        pass


def downgrade():
    # Downgrade is best-effort: drop only if present
    if _column_exists("user", "role"):
        op.drop_column("user", "role")
