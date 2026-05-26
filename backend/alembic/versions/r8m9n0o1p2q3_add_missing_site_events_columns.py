"""Add missing site_events.created_by_user_id column

Revision ID: r8m9n0o1p2q3
Revises: q7l8m9n0o1p2
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa

revision = "r8m9n0o1p2q3"
down_revision = "q7l8m9n0o1p2"
branch_labels = None
depends_on = None


def column_exists(table, column):
    from sqlalchemy import inspect
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade():
    if not column_exists("site_events", "created_by_user_id"):
        op.add_column("site_events", sa.Column("created_by_user_id", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("site_events", "created_by_user_id")