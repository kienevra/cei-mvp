"""add user role

Revision ID: 0be061b21f29
Revises: be01ef48d298
Create Date: 2025-12-12 01:43:03.772314
"""
from alembic import op
import sqlalchemy as sa

revision = "0be061b21f29"
down_revision = "be01ef48d298"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column("role", sa.String(length=32), nullable=True),
    )


def downgrade():
    op.drop_column("user", "role")
