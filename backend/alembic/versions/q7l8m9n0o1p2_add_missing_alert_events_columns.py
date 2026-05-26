"""Add missing alert_events columns: owner_user_id, note

Revision ID: q7l8m9n0o1p2
Revises: p6k7l8m9n0o1
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa

revision = "q7l8m9n0o1p2"
down_revision = "p6k7l8m9n0o1"
branch_labels = None
depends_on = None


def column_exists(table, column):
    from sqlalchemy import inspect
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade():
    if not column_exists("alert_events", "owner_user_id"):
        op.add_column("alert_events", sa.Column("owner_user_id", sa.Integer(), nullable=True))
    if not column_exists("alert_events", "note"):
        op.add_column("alert_events", sa.Column("note", sa.Text(), nullable=True))
    if not column_exists("user", "full_name"):
        op.add_column("user", sa.Column("full_name", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("alert_events", "note")
    op.drop_column("alert_events", "owner_user_id")
    op.drop_column("user", "full_name")