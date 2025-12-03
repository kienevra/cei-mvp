"""add integration_tokens table

Revision ID: 0d504a6c33ac
Revises: add_billing_tables_001
Create Date: 2025-12-03 03:50:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0d504a6c33ac"
down_revision = "add_billing_tables_001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "integration_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), nullable=False, index=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "token_hash",
            sa.String(length=255),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_table("integration_tokens")
