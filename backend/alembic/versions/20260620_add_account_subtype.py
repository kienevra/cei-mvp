"""add account_subtype to organization
Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision      = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    with op.batch_alter_table("organization", schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            "account_subtype",
            sa.String(length=32),
            nullable=True,
            comment="'esco' | 'commercialista' | None — set at signup based on user selection",
        ))


def downgrade() -> None:
    with op.batch_alter_table("organization", schema=None) as batch_op:
        batch_op.drop_column("account_subtype")
