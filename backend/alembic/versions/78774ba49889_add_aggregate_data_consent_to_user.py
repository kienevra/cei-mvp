
"""add aggregate_data_consent to user

Revision ID: 78774ba49889
Revises: e61d34e92155

Create Date: 2026-06-07 13:02:28.997847

"""
revision = '78774ba49889'
down_revision = 'e61d34e92155'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    with op.batch_alter_table("user") as batch_op:
        batch_op.add_column(sa.Column(
            "aggregate_data_consent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ))
        batch_op.add_column(sa.Column(
            "aggregate_data_consent_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ))


def downgrade():
    with op.batch_alter_table("user") as batch_op:
        batch_op.drop_column("aggregate_data_consent_at")
        batch_op.drop_column("aggregate_data_consent")
