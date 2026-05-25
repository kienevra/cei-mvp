"""Add missing organization columns (subscription_status, enable_alerts, etc.)

Revision ID: o5j6k7l8m9n0
Revises: n4i5j6k7l8m9
Create Date: 2026-05-25

These columns exist in models.py and in Neon but were never added via Alembic.
This migration adds them to Supabase (and any fresh DB) idempotently.
"""

from alembic import op
import sqlalchemy as sa

revision = "o5j6k7l8m9n0"
down_revision = "n4i5j6k7l8m9"
branch_labels = None
depends_on = None


def column_exists(table, column):
    from sqlalchemy import inspect, text
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade():
    if not column_exists("organization", "subscription_status"):
        op.add_column("organization", sa.Column(
            "subscription_status", sa.String(32), nullable=True
        ))

    if not column_exists("organization", "enable_alerts"):
        op.add_column("organization", sa.Column(
            "enable_alerts", sa.Boolean(), nullable=False,
            server_default=sa.true()
        ))

    if not column_exists("organization", "enable_reports"):
        op.add_column("organization", sa.Column(
            "enable_reports", sa.Boolean(), nullable=False,
            server_default=sa.true()
        ))

    if not column_exists("organization", "stripe_customer_id"):
        op.add_column("organization", sa.Column(
            "stripe_customer_id", sa.String(255), nullable=True
        ))

    if not column_exists("organization", "stripe_subscription_id"):
        op.add_column("organization", sa.Column(
            "stripe_subscription_id", sa.String(255), nullable=True
        ))

    if not column_exists("organization", "stripe_status"):
        op.add_column("organization", sa.Column(
            "stripe_status", sa.String(64), nullable=True
        ))

    if not column_exists("organization", "billing_email"):
        op.add_column("organization", sa.Column(
            "billing_email", sa.String(255), nullable=True
        ))

    if not column_exists("organization", "primary_energy_sources"):
        op.add_column("organization", sa.Column(
            "primary_energy_sources", sa.String(255), nullable=True
        ))


def downgrade():
    op.drop_column("organization", "primary_energy_sources")
    op.drop_column("organization", "billing_email")
    op.drop_column("organization", "stripe_status")
    op.drop_column("organization", "stripe_subscription_id")
    op.drop_column("organization", "stripe_customer_id")
    op.drop_column("organization", "enable_reports")
    op.drop_column("organization", "enable_alerts")
    op.drop_column("organization", "subscription_status")