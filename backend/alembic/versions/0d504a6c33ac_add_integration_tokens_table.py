"""add integration_tokens table (idempotent)

Revision ID: 0d504a6c33ac
Revises: add_billing_tables_001
Create Date: 2025-12-04

NOTE:
This migration is intentionally idempotent because some environments (e.g. Render DB)
may already have the integration_tokens table from earlier partial deploys or manual runs.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "0d504a6c33ac"
down_revision = "add_billing_tables_001"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    return table_name in insp.get_table_names()


def upgrade():
    if _table_exists("integration_tokens"):
        return

    op.create_table(
        "integration_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),  # Postgres + SQLite
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Optional but useful indexes (safe to create only when table is created)
    op.create_index("ix_integration_tokens_org_id", "integration_tokens", ["org_id"])
    op.create_index(
        "ix_integration_tokens_token_hash",
        "integration_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade():
    # Drop indexes/table only if present
    if not _table_exists("integration_tokens"):
        return

    op.drop_index("ix_integration_tokens_token_hash", table_name="integration_tokens")
    op.drop_index("ix_integration_tokens_org_id", table_name="integration_tokens")
    op.drop_table("integration_tokens")
