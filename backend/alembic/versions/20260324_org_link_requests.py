# backend/alembic/versions/20260324_org_link_requests.py
"""add org_link_requests table

Revision ID: d4e5f6a7b8c9
Revises: c1d2e3f4a5b6
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c9"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None

DB_NOW = sa.text("(datetime('now'))")  # SQLite; Postgres uses now()


def upgrade() -> None:
    op.create_table(
        "org_link_requests",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("managing_org_id", sa.Integer, sa.ForeignKey("organization.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_org_id", sa.Integer, sa.ForeignKey("organization.id", ondelete="CASCADE"), nullable=False),
        # initiated_by: "consultant" = managing org sent it, "org_owner" = client org sent it
        sa.Column("initiated_by", sa.String(16), nullable=False),
        # status: "pending", "accepted", "rejected", "cancelled"
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("token", sa.String(64), nullable=True, unique=True),
        sa.Column("message", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=DB_NOW),
        sa.Column("updated_at", sa.DateTime, nullable=True),
        sa.UniqueConstraint("managing_org_id", "client_org_id", name="uq_link_request_pair"),
    )
    op.create_index("ix_org_link_requests_managing_org_id", "org_link_requests", ["managing_org_id"])
    op.create_index("ix_org_link_requests_client_org_id", "org_link_requests", ["client_org_id"])
    op.create_index("ix_org_link_requests_token", "org_link_requests", ["token"])


def downgrade() -> None:
    op.drop_table("org_link_requests")