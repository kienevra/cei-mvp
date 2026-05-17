"""add notifications table

Revision ID: j0e1f2g3h4i5
Revises: h8c9d0e1f2g3
Create Date: 2026-05-16
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "j0e1f2g3h4i5"
down_revision = "h8c9d0e1f2g3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id",         sa.Integer(),                   nullable=False),
        sa.Column("org_id",     sa.Integer(),                   nullable=False),
        sa.Column("user_id",    sa.Integer(),                   nullable=True),
        sa.Column("type",       sa.String(length=64),           nullable=False),
        sa.Column("title",      sa.String(length=255),          nullable=False),
        sa.Column("body",       sa.Text(),                      nullable=True),
        sa.Column("is_read",    sa.Boolean(),                   nullable=False, server_default=sa.false()),
        sa.Column("extra",      sa.JSON(),                      nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),     nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"],  ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"],          ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_org_id",     "notifications", ["org_id"])
    op.create_index("ix_notifications_user_id",    "notifications", ["user_id"])
    op.create_index("ix_notifications_type",       "notifications", ["type"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_type",       table_name="notifications")
    op.drop_index("ix_notifications_user_id",    table_name="notifications")
    op.drop_index("ix_notifications_org_id",     table_name="notifications")
    op.drop_table("notifications")