"""add org saas/billing fields

Revision ID: cf8d8f3ebb7c
Revises: 0be061b21f29
Create Date: 2025-12-12

This migration is written to be safe/idempotent when applied to databases that
may already have some or all of these columns (e.g., a Render Postgres DB that
was partially migrated / manually patched).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "cf8d8f3ebb7c"
down_revision = "0be061b21f29"
branch_labels = None
depends_on = None


def _col_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table_name)]
    return column_name in cols


def upgrade():
    # organization.plan_key
    if not _col_exists("organization", "plan_key"):
        op.add_column(
            "organization",
            sa.Column("plan_key", sa.String(64), nullable=True),
        )

    # organization.subscription_plan_key
    if not _col_exists("organization", "subscription_plan_key"):
        op.add_column(
            "organization",
            sa.Column("subscription_plan_key", sa.String(64), nullable=True),
        )

    # If you later added additional org SaaS fields in this migration, wrap each
    # op.add_column(...) the same way to avoid DuplicateColumn on existing DBs.


def downgrade():
    # Drop in reverse order, but only if they exist (also idempotent)
    if _col_exists("organization", "subscription_plan_key"):
        op.drop_column("organization", "subscription_plan_key")

    if _col_exists("organization", "plan_key"):
        op.drop_column("organization", "plan_key")
