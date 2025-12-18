"""add alert_events and site_events tables

Revision ID: add_alert_and_site_events_001
Revises: add_billing_tables_001
Create Date: 2025-11-28 00:00:00.000000

NOTE:
This migration is intentionally written to be **idempotent** across environments.
If Render/Postgres already has these tables (e.g., created earlier outside Alembic or
via a different migration chain), we skip CREATE TABLE / CREATE INDEX to avoid
DuplicateTable/duplicate index errors during deploy.

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "add_alert_and_site_events_001"
down_revision = "add_billing_tables_001"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    return table_name in set(insp.get_table_names())


def _index_exists(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    try:
        idx = insp.get_indexes(table_name) or []
    except Exception:
        # Some dialect edge cases; if we can't introspect safely, do not attempt creation.
        return True
    return any(i.get("name") == index_name for i in idx)


def upgrade():
    # --- alert_events: persistent alert log / ack state ---
    if not _table_exists("alert_events"):
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

    # Helpful indexes for typical queries (guarded)
    if _table_exists("alert_events"):
        if not _index_exists("alert_events", "ix_alert_events_org_id"):
            op.create_index("ix_alert_events_org_id", "alert_events", ["org_id"])
        if not _index_exists("alert_events", "ix_alert_events_site_id"):
            op.create_index("ix_alert_events_site_id", "alert_events", ["site_id"])
        if not _index_exists("alert_events", "ix_alert_events_rule_key"):
            op.create_index("ix_alert_events_rule_key", "alert_events", ["rule_key"])
        if not _index_exists("alert_events", "ix_alert_events_triggered_at"):
            op.create_index("ix_alert_events_triggered_at", "alert_events", ["triggered_at"])

    # --- site_events: generic site timeline (including alert-related events) ---
    if not _table_exists("site_events"):
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

    if _table_exists("site_events"):
        if not _index_exists("site_events", "ix_site_events_org_id"):
            op.create_index("ix_site_events_org_id", "site_events", ["org_id"])
        if not _index_exists("site_events", "ix_site_events_site_id"):
            op.create_index("ix_site_events_site_id", "site_events", ["site_id"])
        if not _index_exists("site_events", "ix_site_events_kind"):
            op.create_index("ix_site_events_kind", "site_events", ["kind"])


def downgrade():
    # Keep downgrade safe/idempotent as well.
    if _table_exists("site_events"):
        # Drop indexes only if present
        if _index_exists("site_events", "ix_site_events_kind"):
            op.drop_index("ix_site_events_kind", table_name="site_events")
        if _index_exists("site_events", "ix_site_events_site_id"):
            op.drop_index("ix_site_events_site_id", table_name="site_events")
        if _index_exists("site_events", "ix_site_events_org_id"):
            op.drop_index("ix_site_events_org_id", table_name="site_events")
        op.drop_table("site_events")

    if _table_exists("alert_events"):
        if _index_exists("alert_events", "ix_alert_events_triggered_at"):
            op.drop_index("ix_alert_events_triggered_at", table_name="alert_events")
        if _index_exists("alert_events", "ix_alert_events_rule_key"):
            op.drop_index("ix_alert_events_rule_key", table_name="alert_events")
        if _index_exists("alert_events", "ix_alert_events_site_id"):
            op.drop_index("ix_alert_events_site_id", table_name="alert_events")
        if _index_exists("alert_events", "ix_alert_events_org_id"):
            op.drop_index("ix_alert_events_org_id", table_name="alert_events")
        op.drop_table("alert_events")
