"""add enable_notification_emails to organization

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa

revision      = "g7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column(
        "organization",
        sa.Column(
            "enable_notification_emails",
            sa.Boolean(),
            nullable=False,
            default=True,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("organization", "enable_notification_emails")