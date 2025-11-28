"""add alert_events and site_events tables

Revision ID: add_alert_and_site_events_001
Revises: add_billing_tables_001
Create Date: 2025-11-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "add_alert_and_site_events_001"
down_revision = "add_billing_tables_001"
branch_labels = None
depends_on = None


def upgrade():
    # --- alert_events: persistent alert log / ack state ---
    op.create_table(
        "alert_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("site_id", sa.String(length=128), nullable=True),
        sa.Column("rule_key", sa.String(length=128), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("metric", sa.String(length=128), nullable=True),
        sa.Column("window_hours", sa.Integer(), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "acknowledged",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),  # works on Postgres + SQLite
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    # Helpful indexes for typical queries
    op.create_index(
        "ix_alert_events_org_id",
        "alert_events",
        ["org_id"],
    )
    op.create_index(
        "ix_alert_events_site_id",
        "alert_events",
        ["site_id"],
    )
    op.create_index(
        "ix_alert_events_rule_key",
        "alert_events",
        ["rule_key"],
    )
    op.create_index(
        "ix_alert_events_triggered_at",
        "alert_events",
        ["triggered_at"],
    )

    # --- site_events: generic site timeline (including alert-related events) ---
    op.create_table(
        "site_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("site_id", sa.String(length=128), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("related_alert_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_index(
        "ix_site_events_org_id",
        "site_events",
        ["org_id"],
    )
    op.create_index(
        "ix_site_events_site_id",
        "site_events",
        ["site_id"],
    )
    op.create_index(
        "ix_site_events_kind",
        "site_events",
        ["kind"],
    )


def downgrade():
    op.drop_index("ix_site_events_kind", table_name="site_events")
    op.drop_index("ix_site_events_site_id", table_name="site_events")
    op.drop_index("ix_site_events_org_id", table_name="site_events")
    op.drop_table("site_events")

    op.drop_index("ix_alert_events_triggered_at", table_name="alert_events")
    op.drop_index("ix_alert_events_rule_key", table_name="alert_events")
    op.drop_index("ix_alert_events_site_id", table_name="alert_events")
    op.drop_index("ix_alert_events_org_id", table_name="alert_events")
    op.drop_table("alert_events")
