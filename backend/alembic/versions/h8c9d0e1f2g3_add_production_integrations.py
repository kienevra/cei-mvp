"""add production_integrations table

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa

revision      = "h8c9d0e1f2g3"
down_revision = "g7b8c9d0e1f2"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "production_integrations",
        sa.Column("id",               sa.Integer(),     nullable=False),
        sa.Column("organization_id",  sa.Integer(),     nullable=False),
        sa.Column("site_id",          sa.Integer(),     nullable=False),
        sa.Column("integration_type", sa.String(32),    nullable=False),
        sa.Column("label",            sa.String(128),   nullable=True),
        sa.Column("webhook_token",    sa.String(128),   nullable=True),
        sa.Column("config_encrypted", sa.Text(),        nullable=True),
        sa.Column("is_active",        sa.Boolean(),     nullable=False,
                  server_default=sa.true()),
        sa.Column("last_sync_at",     sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.String(32),    nullable=True),
        sa.Column("last_sync_message",sa.String(512),   nullable=True),
        sa.Column("created_at",       sa.DateTime(timezone=True),
                  server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"],
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["site.id"],
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("webhook_token",
                            name="uq_production_integration_token"),
        sa.UniqueConstraint("site_id", "integration_type",
                            name="uq_prod_integration_site_type"),
    )
    op.create_index("ix_production_integrations_id",
                    "production_integrations", ["id"])
    op.create_index("ix_production_integrations_site",
                    "production_integrations", ["site_id"])
    op.create_index("ix_production_integrations_token",
                    "production_integrations", ["webhook_token"])


def downgrade() -> None:
    op.drop_index("ix_production_integrations_token",
                  table_name="production_integrations")
    op.drop_index("ix_production_integrations_site",
                  table_name="production_integrations")
    op.drop_index("ix_production_integrations_id",
                  table_name="production_integrations")
    op.drop_table("production_integrations")