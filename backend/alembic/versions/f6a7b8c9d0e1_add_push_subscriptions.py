"""add push_subscriptions table

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa

revision      = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id",              sa.Integer(),     nullable=False),
        sa.Column("organization_id", sa.Integer(),     nullable=False),
        sa.Column("user_id",         sa.Integer(),     nullable=True),
        sa.Column("endpoint",        sa.String(2048),  nullable=False),
        sa.Column("p256dh",          sa.String(512),   nullable=False),
        sa.Column("auth",            sa.String(128),   nullable=False),
        sa.Column("device_label",    sa.String(128),   nullable=True),
        sa.Column("is_active",       sa.Boolean(),     nullable=False, server_default=sa.true()),
        sa.Column("created_at",      sa.DateTime(timezone=True),
                  server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("last_used_at",    sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"],         ["user.id"],         ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscription_endpoint"),
    )
    op.create_index("ix_push_subscriptions_org_active",
                    "push_subscriptions", ["organization_id", "is_active"])
    op.create_index("ix_push_subscriptions_id",
                    "push_subscriptions", ["id"])


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_org_active", table_name="push_subscriptions")
    op.drop_index("ix_push_subscriptions_id",         table_name="push_subscriptions")
    op.drop_table("push_subscriptions")