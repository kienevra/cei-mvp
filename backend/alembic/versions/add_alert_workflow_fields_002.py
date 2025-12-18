"""add alert workflow fields (idempotent)

Revision ID: add_alert_workflow_fields_002
Revises: add_alert_and_site_events_001
Create Date: 2025-11-28 00:00:00.000000

NOTE:
This migration is intentionally idempotent because some environments (e.g. Render DB)
may already contain some/all of these columns from prior partial runs or manual changes.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "add_alert_workflow_fields_002"
down_revision = "add_alert_and_site_events_001"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table_name)]
    return column_name in cols


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_if_exists(table_name: str, column_name: str) -> None:
    # Alembic doesn't provide drop_column(if exists), so we inspect first.
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def upgrade():
    # alert_events.status: open/acknowledged/resolved/etc. (default "open")
    _add_column_if_missing(
        "alert_events",
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'open'"),  # works on Postgres + SQLite
        ),
    )

    # If you later add more columns here, follow the same pattern:
    # _add_column_if_missing("alert_events", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    # _add_column_if_missing("alert_events", sa.Column("resolved_by_user_id", sa.Integer(), nullable=True))


def downgrade():
    # Reverse in a safe way (only drop if present).
    _drop_column_if_exists("alert_events", "status")
