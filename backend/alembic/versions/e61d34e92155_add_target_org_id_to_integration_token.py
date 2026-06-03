"""add_target_org_id_to_integration_token

Revision ID: e61d34e92155
Revises: c23acff01002
Create Date: 2026-06-03 11:36:29.469132
"""
from alembic import op
import sqlalchemy as sa

revision = 'e61d34e92155'
down_revision = 'c23acff01002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("integration_tokens") as batch_op:
        batch_op.add_column(
            sa.Column("target_org_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_integration_token_target_org",
            "organization",
            ["target_org_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_integration_token_target_org_id",
            ["target_org_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("integration_tokens") as batch_op:
        batch_op.drop_index("ix_integration_token_target_org_id")
        batch_op.drop_constraint("fk_integration_token_target_org", type_="foreignkey")
        batch_op.drop_column("target_org_id")