"""org_invites: add revoked_at (safe/idempotent)

Revision ID: <REPLACE_WITH_YOUR_NEW_REVISION_ID>
Revises: cff1f49a9d1c
Create Date: 2025-12-18

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "<REPLACE_WITH_YOUR_NEW_REVISION_ID>"
down_revision = "cff1f49a9d1c"
branch_labels = None
depends_on = None


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    insp = sa.inspect(conn)
    cols = insp.get_columns(table_name)
    return any(c["name"] == column_name for c in cols)


def upgrade():
    conn = op.get_bind()

    # Add missing column only if it doesn't already exist (handles drifted DBs)
    if not _column_exists(conn, "org_invites", "revoked_at"):
        op.add_column(
            "org_invites",
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    conn = op.get_bind()

    # Drop only if it exists (safe)
    if _column_exists(conn, "org_invites", "revoked_at"):
        op.drop_column("org_invites", "revoked_at")
