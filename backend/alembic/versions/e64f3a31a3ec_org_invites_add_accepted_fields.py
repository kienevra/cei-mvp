from alembic import op
import sqlalchemy as sa

def _has_col(bind, table, col):
    insp = sa.inspect(bind)
    return col in [c["name"] for c in insp.get_columns(table)]

def upgrade():
    bind = op.get_bind()

    # accepted_at
    if not _has_col(bind, "org_invites", "accepted_at"):
        op.add_column("org_invites", sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True))

    # accepted_user_id
    if not _has_col(bind, "org_invites", "accepted_user_id"):
        op.add_column("org_invites", sa.Column("accepted_user_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_org_invites_accepted_user_id_user",
            "org_invites", "user",
            ["accepted_user_id"], ["id"],
        )

    # Backfill accepted_* from existing used_* if present
    # (safe even if no rows match)
    if _has_col(bind, "org_invites", "used_at"):
        op.execute("""
            UPDATE org_invites
            SET accepted_at = COALESCE(accepted_at, used_at)
            WHERE used_at IS NOT NULL
        """)
    if _has_col(bind, "org_invites", "used_by_user_id"):
        op.execute("""
            UPDATE org_invites
            SET accepted_user_id = COALESCE(accepted_user_id, used_by_user_id)
            WHERE used_by_user_id IS NOT NULL
        """)

def downgrade():
    bind = op.get_bind()
    if _has_col(bind, "org_invites", "accepted_user_id"):
        op.drop_constraint("fk_org_invites_accepted_user_id_user", "org_invites", type_="foreignkey")
        op.drop_column("org_invites", "accepted_user_id")
    if _has_col(bind, "org_invites", "accepted_at"):
        op.drop_column("org_invites", "accepted_at")
