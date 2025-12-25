"""
org_invites add accepted fields (idempotent)

Revision ID: e64f3a31a3ec
Revises: a036124222ce
Create Date: 2025-12-19
"""

from alembic import op
import sqlalchemy as sa

# Alembic identifiers (REQUIRED)
revision = "e64f3a31a3ec"
down_revision = "a036124222ce"
branch_labels = None
depends_on = None


def _has_col(bind, table, col):
    insp = sa.inspect(bind)
    return col in [c["name"] for c in insp.get_columns(table)]


def _has_fk(bind, table, fk_name):
    insp = sa.inspect(bind)
    fks = insp.get_foreign_keys(table) or []
    return any((fk.get("name") == fk_name) for fk in fks)


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    # accepted_at
    if not _has_col(bind, "org_invites", "accepted_at"):
        op.add_column(
            "org_invites",
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        )

    # accepted_user_id
    if not _has_col(bind, "org_invites", "accepted_user_id"):
        op.add_column(
            "org_invites",
            sa.Column("accepted_user_id", sa.Integer(), nullable=True),
        )

    # FK for accepted_user_id -> user.id
    # SQLite can't ALTER TABLE to add constraints; keep dev unblocked.
    # Postgres (Render/Supabase) will get the FK.
    fk_name = "fk_org_invites_accepted_user_id_user"
    if (
        (not is_sqlite)
        and _has_col(bind, "org_invites", "accepted_user_id")
        and not _has_fk(bind, "org_invites", fk_name)
    ):
        op.create_foreign_key(
            fk_name,
            "org_invites",
            "user",
            ["accepted_user_id"],
            ["id"],
        )

    # Backfill accepted_* from existing used_* if present
    # (safe even if no rows match)
    if _has_col(bind, "org_invites", "used_at"):
        op.execute(
            sa.text(
                """
                UPDATE org_invites
                SET accepted_at = COALESCE(accepted_at, used_at)
                WHERE used_at IS NOT NULL
                """
            )
        )

    if _has_col(bind, "org_invites", "used_by_user_id"):
        op.execute(
            sa.text(
                """
                UPDATE org_invites
                SET accepted_user_id = COALESCE(accepted_user_id, used_by_user_id)
                WHERE used_by_user_id IS NOT NULL
                """
            )
        )


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    fk_name = "fk_org_invites_accepted_user_id_user"

    # Drop FK if it exists (non-sqlite), then the columns
    if (not is_sqlite) and _has_fk(bind, "org_invites", fk_name):
        op.drop_constraint(fk_name, "org_invites", type_="foreignkey")

    if _has_col(bind, "org_invites", "accepted_user_id"):
        op.drop_column("org_invites", "accepted_user_id")

    if _has_col(bind, "org_invites", "accepted_at"):
        op.drop_column("org_invites", "accepted_at")
