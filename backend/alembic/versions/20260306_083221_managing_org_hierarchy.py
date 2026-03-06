"""organization: add org_type + managed_by_org_id + client_limit (managing org hierarchy)

Revision ID: b7c8d9e0f1a2
Revises: e01209a18936
Create Date: 2026-03-06 08:32:21

Phase 1 - Nested Orgs Roadmap
"""
from alembic import op
import sqlalchemy as sa

revision = "b7c8d9e0f1a2"
down_revision = "e01209a18936"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("organization") as batch:
        batch.add_column(
            sa.Column(
                "org_type",
                sa.String(32),
                nullable=False,
                server_default=sa.text("'standalone'"),
            )
        )
        batch.add_column(
            sa.Column(
                "managed_by_org_id",
                sa.Integer(),
                nullable=True,
            )
        )
        batch.add_column(
            sa.Column(
                "client_limit",
                sa.Integer(),
                nullable=True,
            )
        )
        batch.create_index(
            "ix_organization_managed_by_org_id",
            ["managed_by_org_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("organization") as batch:
        batch.drop_index("ix_organization_managed_by_org_id")
        batch.drop_column("client_limit")
        batch.drop_column("managed_by_org_id")
        batch.drop_column("org_type")
