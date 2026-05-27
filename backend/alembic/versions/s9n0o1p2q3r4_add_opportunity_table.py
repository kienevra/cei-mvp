"""Add missing opportunity table

Revision ID: s9n0o1p2q3r4
Revises: r8m9n0o1p2q3
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa

revision = "s9n0o1p2q3r4"
down_revision = "r8m9n0o1p2q3"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    bind = op.get_bind()
    if "opportunity" not in inspect(bind).get_table_names():
        op.create_table(
            "opportunity",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("site_id", sa.Integer(), sa.ForeignKey("site.id"), nullable=False, index=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade():
    op.drop_table("opportunity")