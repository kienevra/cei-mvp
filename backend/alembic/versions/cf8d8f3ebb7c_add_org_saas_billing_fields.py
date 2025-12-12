from alembic import op
import sqlalchemy as sa

revision = "cf8d8f3ebb7c"
down_revision = "0be061b21f29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Plan / feature gating
    op.add_column("organization", sa.Column("plan_key", sa.String(64), nullable=True))
    op.add_column("organization", sa.Column("subscription_plan_key", sa.String(64), nullable=True))
    op.add_column("organization", sa.Column("subscription_status", sa.String(32), nullable=True))

    # ✅ Cross-DB boolean defaults
    op.add_column(
        "organization",
        sa.Column("enable_alerts", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "organization",
        sa.Column("enable_reports", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    # Stripe / billing metadata
    op.add_column("organization", sa.Column("stripe_customer_id", sa.String(255), nullable=True))
    op.add_column("organization", sa.Column("stripe_subscription_id", sa.String(255), nullable=True))
    op.add_column("organization", sa.Column("stripe_status", sa.String(64), nullable=True))
    op.add_column("organization", sa.Column("billing_email", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("organization", "billing_email")
    op.drop_column("organization", "stripe_status")
    op.drop_column("organization", "stripe_subscription_id")
    op.drop_column("organization", "stripe_customer_id")
    op.drop_column("organization", "enable_reports")
    op.drop_column("organization", "enable_alerts")
    op.drop_column("organization", "subscription_status")
    op.drop_column("organization", "subscription_plan_key")
    op.drop_column("organization", "plan_key")
