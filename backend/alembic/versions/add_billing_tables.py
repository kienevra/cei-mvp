"""add billing tables (idempotent)

Revision ID: add_billing_tables_001
Revises: 1234567890ab
Create Date: 2025-XX-XX

NOTE:
This migration is intentionally idempotent to handle environments where some
tables were created manually or by earlier deployments before Alembic was fully
wired. On Postgres (Render), we skip CREATE TABLE if the table already exists.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# ---- Alembic identifiers ----
revision = "add_billing_tables_001"
down_revision = "1234567890ab"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    return table_name in insp.get_table_names()


def upgrade():
    # billing_plan
    if not _table_exists("billing_plan"):
        op.create_table(
            "billing_plan",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("stripe_price_id", sa.String(), nullable=False),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("amount_cents", sa.Integer(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.UniqueConstraint("stripe_price_id"),
        )

    # subscription (if you have it in your schema)
    if not _table_exists("subscription"):
        op.create_table(
            "subscription",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("organization_id", sa.Integer(), nullable=False),
            sa.Column("billing_plan_id", sa.Integer(), nullable=True),
            sa.Column("stripe_customer_id", sa.String(), nullable=True),
            sa.Column("stripe_subscription_id", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"]),
            sa.ForeignKeyConstraint(["billing_plan_id"], ["billing_plan.id"]),
        )


def downgrade():
    # Use IF EXISTS so downgrades don't brick when tables were pre-existing or already removed.
    op.execute("DROP TABLE IF EXISTS subscription CASCADE;")
    op.execute("DROP TABLE IF EXISTS billing_plan CASCADE;")
