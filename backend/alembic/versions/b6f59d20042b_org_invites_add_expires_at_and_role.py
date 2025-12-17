"""
org_invites: ensure role + expires_at exist (safe/idempotent)

Revision ID: b6f59d20042b
Revises: 134868d9b425
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "b6f59d20042b"
down_revision = "134868d9b425"
branch_labels = None
depends_on = None


def _has_table(bind, table_name: str) -> bool:
    insp = inspect(bind)
    try:
        return insp.has_table(table_name)
    except Exception:
        # super-defensive fallback
        return table_name in insp.get_table_names()


def _get_cols(bind, table_name: str) -> set[str]:
    insp = inspect(bind)
    try:
        return {c["name"] for c in insp.get_columns(table_name)}
    except Exception:
        return set()


def upgrade():
    bind = op.get_bind()

    # If table doesn't exist (e.g., old Render DB), create it with the current expected shape.
    if not _has_table(bind, "org_invites"):
        op.create_table(
            "org_invites",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("org_id", sa.Integer(), nullable=False, index=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("token_hash", sa.String(length=255), nullable=False, unique=True, index=True),
            sa.Column("role", sa.String(length=32), nullable=False, server_default=sa.text("'member'")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("accepted_user_id", sa.Integer(), nullable=True),
        )
        op.create_index("ix_org_invites_org_id", "org_invites", ["org_id"])
        op.create_index("ix_org_invites_email", "org_invites", ["email"])
        op.create_index("ix_org_invites_token_hash", "org_invites", ["token_hash"], unique=True)
        return

    cols = _get_cols(bind, "org_invites")

    # Add missing columns safely (Postgres-safe / SQLite-safe)
    if "role" not in cols:
        op.add_column(
            "org_invites",
            sa.Column("role", sa.String(length=32), nullable=False, server_default=sa.text("'member'")),
        )

    if "expires_at" not in cols:
        op.add_column("org_invites", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    # Do not drop columns/tables in downgrade to avoid accidental data loss.
    pass
