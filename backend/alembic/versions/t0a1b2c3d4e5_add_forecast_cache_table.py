"""Add forecast_cache table for Prophet background cache

Revision ID: t0a1b2c3d4e5
Revises: s9n0o1p2q3r4
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "t0a1b2c3d4e5"
down_revision = "s9n0o1p2q3r4"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    bind = op.get_bind()
    if "forecast_cache" not in inspect(bind).get_table_names():
        op.create_table(
            "forecast_cache",
            sa.Column("id",              sa.Integer(),                          primary_key=True),
            sa.Column("site_id",         sa.String(128),  nullable=False,       index=True),
            sa.Column("organization_id", sa.Integer(),    nullable=False,       index=True),
            sa.Column("horizon_hours",   sa.Integer(),    nullable=False,       server_default="48"),
            sa.Column("lookback_days",   sa.Integer(),    nullable=False,       server_default="30"),
            sa.Column("method",          sa.String(64),   nullable=False,       server_default="prophet_v1"),
            sa.Column("payload",         postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("generated_at",    sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("expires_at",      sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("site_id", "organization_id", "horizon_hours", "lookback_days",
                                name="uq_forecast_cache_site"),
        )
        op.create_index("ix_forecast_cache_expires", "forecast_cache", ["expires_at"])


def downgrade():
    op.drop_table("forecast_cache")