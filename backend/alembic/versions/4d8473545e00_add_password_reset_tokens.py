"""add password reset tokens

Revision ID: 4d8473545e00
Revises: 46edc6c3a172
Create Date: 2026-01-05 07:24:45.806749

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "4d8473545e00"
down_revision = "46edc6c3a172"
branch_labels = None
depends_on = None


def upgrade():
    # Create table (portable: SQLite + Postgres)
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        # NEW: audit fields (these are what your prod is missing)
        sa.Column("request_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
    )

    # Indexes for lookups + cleanup jobs
    op.create_index(
        "ix_password_reset_tokens_token_hash",
        "password_reset_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_password_reset_tokens_email",
        "password_reset_tokens",
        ["email"],
        unique=False,
    )
    op.create_index(
        "ix_password_reset_tokens_user_id",
        "password_reset_tokens",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_password_reset_tokens_expires_at",
        "password_reset_tokens",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_password_reset_tokens_used_at",
        "password_reset_tokens",
        ["used_at"],
        unique=False,
    )

    # Useful composite indexes (fast "active token" searches)
    op.create_index(
        "ix_pwdreset_email_expires",
        "password_reset_tokens",
        ["email", "expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_pwdreset_user_expires",
        "password_reset_tokens",
        ["user_id", "expires_at"],
        unique=False,
    )


def downgrade():
    # Drop indexes first (portable)
    op.drop_index("ix_pwdreset_user_expires", table_name="password_reset_tokens")
    op.drop_index("ix_pwdreset_email_expires", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_used_at", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_expires_at", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_email", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_token_hash", table_name="password_reset_tokens")

    op.drop_table("password_reset_tokens")
