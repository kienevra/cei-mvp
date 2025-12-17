"""org_invites add expires_at and role

Revision ID: b6f59d20042b
Revises: 134868d9b425

SQLite notes:
- SQLite cannot DROP DEFAULT via ALTER COLUMN.
- SQLite DDL is non-transactional, so a failed migration may still leave tables/columns behind.
  This migration is written to be idempotent so re-runs are safe.
"""

from alembic import op
import sqlalchemy as sa

revision = "b6f59d20042b"
down_revision = "134868d9b425"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    dialect = bind.dialect.name

    # ---- 1) Ensure table exists ----
    if not inspector.has_table("org_invites"):
        op.create_table(
            "org_invites",
            sa.Column("id", sa.Integer(), primary_key=True),

            sa.Column("org_id", sa.Integer(), sa.ForeignKey("organization.id"), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),

            sa.Column("token_hash", sa.String(length=64), nullable=False),

            sa.Column("role", sa.String(length=32), nullable=False, server_default="member"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),

            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),

            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),

            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
            sa.Column("accepted_user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),

            sa.UniqueConstraint("org_id", "email", name="uq_org_invites_org_email"),
            sa.UniqueConstraint("token_hash", name="uq_org_invites_token_hash"),
        )

    # Refresh inspector view after potential create
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("org_invites")}

    # ---- 2) Add missing columns safely ----
    if "role" not in cols:
        op.add_column(
            "org_invites",
            sa.Column("role", sa.String(length=32), nullable=False, server_default="member"),
        )

    if "expires_at" not in cols:
        op.add_column(
            "org_invites",
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        )

        # Backfill existing rows
        if dialect == "sqlite":
            op.execute(
                """
                UPDATE org_invites
                SET expires_at = datetime('now', '+7 days')
                WHERE expires_at IS NULL
                """
            )
        else:
            op.execute(
                """
                UPDATE org_invites
                SET expires_at = (NOW() + INTERVAL '7 days')
                WHERE expires_at IS NULL
                """
            )

        op.alter_column("org_invites", "expires_at", nullable=False)

    # ---- 3) Ensure indexes exist (only create if missing) ----
    existing_indexes = {ix["name"] for ix in inspector.get_indexes("org_invites")}

    if "ix_org_invites_org_active" not in existing_indexes:
        op.create_index("ix_org_invites_org_active", "org_invites", ["org_id", "is_active"], unique=False)

    if "ix_org_invites_expires_at" not in existing_indexes:
        op.create_index("ix_org_invites_expires_at", "org_invites", ["expires_at"], unique=False)

    # Useful indexes for lookups (safe to add if missing)
    if "ix_org_invites_email" not in existing_indexes:
        op.create_index("ix_org_invites_email", "org_invites", ["email"], unique=False)

    if "ix_org_invites_org_id" not in existing_indexes:
        op.create_index("ix_org_invites_org_id", "org_invites", ["org_id"], unique=False)

    if "ix_org_invites_created_by_user_id" not in existing_indexes:
        op.create_index("ix_org_invites_created_by_user_id", "org_invites", ["created_by_user_id"], unique=False)

    if "ix_org_invites_accepted_user_id" not in existing_indexes:
        op.create_index("ix_org_invites_accepted_user_id", "org_invites", ["accepted_user_id"], unique=False)

    # NOTE: We intentionally do NOT try to drop role defaults on SQLite.


def downgrade():
    # Conservative downgrade: do nothing destructive.
    # If you want full drop/revert behavior, say so and we’ll implement batch_alter_table for SQLite.
    pass
