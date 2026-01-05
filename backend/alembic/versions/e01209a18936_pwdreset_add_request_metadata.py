"""pwdreset add request metadata

Revision ID: PUT_NEW_REVISION_ID_HERE
Revises: 4d8473545e00
Create Date: 2026-01-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e01209a18936"
down_revision = "4d8473545e00"
branch_labels = None
depends_on = None


def upgrade():
    # SQLite needs batch_alter_table for ALTER TABLE operations to be safe/portable.
    with op.batch_alter_table("password_reset_tokens") as batch_op:
        batch_op.add_column(sa.Column("request_ip", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("user_agent", sa.String(length=512), nullable=True))

    # Indexes (optional but useful for ops / abuse monitoring)
    op.create_index(
        "ix_pwdreset_request_ip",
        "password_reset_tokens",
        ["request_ip"],
        unique=False,
    )
    op.create_index(
        "ix_pwdreset_user_agent",
        "password_reset_tokens",
        ["user_agent"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_pwdreset_user_agent", table_name="password_reset_tokens")
    op.drop_index("ix_pwdreset_request_ip", table_name="password_reset_tokens")

    with op.batch_alter_table("password_reset_tokens") as batch_op:
        batch_op.drop_column("user_agent")
        batch_op.drop_column("request_ip")
