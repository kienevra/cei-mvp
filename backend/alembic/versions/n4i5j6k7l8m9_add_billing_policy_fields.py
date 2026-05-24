"""Add billing policy fields to organization

Revision ID: n4i5j6k7l8m9
Revises: m3h4i5j6k7l8
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa

revision = "n4i5j6k7l8m9"
down_revision = "m3h4i5j6k7l8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organization", sa.Column(
        "billing_cycle_anchor",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="Date the billing cycle resets each month",
    ))
    op.add_column("organization", sa.Column(
        "subscription_suspended",
        sa.Boolean(),
        nullable=False,
        server_default=sa.false(),
        comment="True when standalone org is linked to a manager and billing is suspended",
    ))
    op.add_column("organization", sa.Column(
        "suspension_effective_date",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="Date suspension takes effect (start of next billing cycle)",
    ))
    op.add_column("organization", sa.Column(
        "grace_period_until",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="Date grace period expires after missed payment",
    ))
    op.add_column("organization", sa.Column(
        "grace_period_started_at",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="When the grace period began",
    ))
    op.add_column("organization", sa.Column(
        "last_grace_notification_at",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="Last time a grace period warning notification was sent",
    ))
    op.add_column("organization", sa.Column(
        "soft_locked",
        sa.Boolean(),
        nullable=False,
        server_default=sa.false(),
        comment="Read-only mode: no ingestion, alerts, or new documents",
    ))
    op.add_column("organization", sa.Column(
        "soft_locked_at",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="When soft lock was applied",
    ))
    op.add_column("organization", sa.Column(
        "transition_period_until",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="For manager lockout cascade: deadline for client orgs to resubscribe",
    ))
    op.add_column("organization", sa.Column(
        "client_grace_until",
        sa.DateTime(timezone=True),
        nullable=True,
        comment="1-month free coverage after unlink from manager",
    ))
    op.add_column("organization", sa.Column(
        "contact_email",
        sa.String(255),
        nullable=True,
        comment="Mandatory contact email for ghost clients (no CEI account)",
    ))
    op.add_column("organization", sa.Column(
        "stripe_base_price_id",
        sa.String(255),
        nullable=True,
        comment="Stripe Price ID for the flat base fee component",
    ))
    op.add_column("organization", sa.Column(
        "stripe_site_price_id",
        sa.String(255),
        nullable=True,
        comment="Stripe Price ID for the per-site metered component",
    ))
    op.add_column("organization", sa.Column(
        "stripe_site_subscription_item_id",
        sa.String(255),
        nullable=True,
        comment="Stripe SubscriptionItem ID for the per-site component (needed for quantity updates)",
    ))
    op.add_column("organization", sa.Column(
        "billed_site_count",
        sa.Integer(),
        nullable=True,
        comment="Site count locked in for current billing cycle",
    ))
    op.add_column("organization", sa.Column(
        "next_billing_site_count",
        sa.Integer(),
        nullable=True,
        comment="Site count queued for next billing cycle",
    ))
    op.add_column("organization", sa.Column(
        "is_ghost_client",
        sa.Boolean(),
        nullable=False,
        server_default=sa.false(),
        comment="True for consultant-created orgs with no independent CEI account",
    ))


def downgrade() -> None:
    for col in [
        "billing_cycle_anchor",
        "subscription_suspended",
        "suspension_effective_date",
        "grace_period_until",
        "grace_period_started_at",
        "last_grace_notification_at",
        "soft_locked",
        "soft_locked_at",
        "transition_period_until",
        "client_grace_until",
        "contact_email",
        "stripe_base_price_id",
        "stripe_site_price_id",
        "stripe_site_subscription_item_id",
        "billed_site_count",
        "next_billing_site_count",
        "is_ghost_client",
    ]:
        op.drop_column("organization", col)
