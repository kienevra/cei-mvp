"""add trial_ends_at to organization

Revision ID: c23acff01002
Revises: 54f9eb92c039
Create Date: 2026-05-30 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'c23acff01002'
down_revision = '54f9eb92c039'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'organization',
        sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade():
    op.drop_column('organization', 'trial_ends_at')