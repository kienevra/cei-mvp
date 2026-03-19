# backend/alembic/versions/20260310_org_alert_thresholds.py
"""add org_alert_thresholds table

Revision ID: c1d2e3f4a5b6
Revises: b7c8d9e0f1a2
Create Date: 2026-03-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "c1d2e3f4a5b6"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "org_alert_thresholds",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("site_id", sa.String(128), nullable=True, index=True),

        # Threshold ratios — all nullable (NULL = use system default)
        sa.Column("night_warning_ratio", sa.Float(), nullable=True),
        sa.Column("night_critical_ratio", sa.Float(), nullable=True),
        sa.Column("spike_warning_ratio", sa.Float(), nullable=True),
        sa.Column("portfolio_share_info_ratio", sa.Float(), nullable=True),
        sa.Column("weekend_warning_ratio", sa.Float(), nullable=True),
        sa.Column("weekend_critical_ratio", sa.Float(), nullable=True),
        sa.Column("min_points", sa.Integer(), nullable=True),
        sa.Column("min_total_kwh", sa.Float(), nullable=True),

        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),

        # One row per (org, site) pair; site_id NULL = org-wide default
        sa.UniqueConstraint(
            "organization_id",
            "site_id",
            name="uq_org_alert_thresholds_org_site",
        ),
    )


def downgrade() -> None:
    op.drop_table("org_alert_thresholds")