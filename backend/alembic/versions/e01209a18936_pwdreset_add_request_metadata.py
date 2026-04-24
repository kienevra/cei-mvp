"""pwdreset add request metadata

Revision ID: e01209a18936
Revises: 4d8473545e00
Create Date: 2026-01-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "e01209a18936"
down_revision = "4d8473545e00"
branch_labels = None
depends_on = None


def column_exists(conn, table_name: str, column_name: str) -> bool:
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade():
    conn = op.get_bind()

    # --- Columns (idempotent safe) ---
    with op.batch_alter_table("password_reset_tokens") as batch_op:
        if not column_exists(conn, "password_reset_tokens", "request_ip"):
            batch_op.add_column(
                sa.Column("request_ip", sa.String(length=64), nullable=True)
            )

        if not column_exists(conn, "password_reset_tokens", "user_agent"):
            batch_op.add_column(
                sa.Column("user_agent", sa.String(length=512), nullable=True)
            )

    # --- Indexes (Postgres-safe idempotency guards) ---
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pwdreset_request_ip
        ON password_reset_tokens (request_ip);
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pwdreset_user_agent
        ON password_reset_tokens (user_agent);
    """)


def downgrade():
    # Drop indexes safely
    op.execute("DROP INDEX IF EXISTS ix_pwdreset_request_ip;")
    op.execute("DROP INDEX IF EXISTS ix_pwdreset_user_agent;")

    conn = op.get_bind()

    # Drop columns safely
    with op.batch_alter_table("password_reset_tokens") as batch_op:
        if column_exists(conn, "password_reset_tokens", "user_agent"):
            batch_op.drop_column("user_agent")

        if column_exists(conn, "password_reset_tokens", "request_ip"):
            batch_op.drop_column("request_ip")