"""add terms_accepted_at to user

Revision ID: 54f9eb92c039
Revises: t0a1b2c3d4e5

Create Date: 2026-05-30 08:45:30.690918

"""
from alembic import op
import sqlalchemy as sa

revision = '54f9eb92c039'
down_revision = 't0a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'user',
        sa.Column('terms_accepted_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade():
    op.drop_column('user', 'terms_accepted_at')