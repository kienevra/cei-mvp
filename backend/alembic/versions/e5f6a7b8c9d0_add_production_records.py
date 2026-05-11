"""add production_record table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa

# -----------------------------------------------------------------------
# Revision identifiers
# -----------------------------------------------------------------------
revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_record",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("units_produced", sa.Float(), nullable=False),
        sa.Column(
            "unit_label",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'units'"),
        ),
        sa.Column("notes", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organization.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["site_id"], ["site.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "date", name="uq_production_site_date"),
    )

    # Primary key index (auto-created by most DBs, explicit here for SQLite safety)
    op.create_index(
        "ix_production_record_id",
        "production_record",
        ["id"],
    )

    # Fast org-scoped date range selects — primary correlation query pattern
    op.create_index(
        "ix_production_record_org_date",
        "production_record",
        ["organization_id", "date"],
    )

    # Site-scoped lookups (used when drilling into a single site's history)
    op.create_index(
        "ix_production_record_site_id",
        "production_record",
        ["site_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_production_record_site_id", table_name="production_record")
    op.drop_index("ix_production_record_org_date", table_name="production_record")
    op.drop_index("ix_production_record_id", table_name="production_record")
    op.drop_table("production_record")