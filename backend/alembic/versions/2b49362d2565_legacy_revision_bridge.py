"""legacy revision bridge (Render DB)

Revision ID: 2b49362d2565
Revises: 1234567890ab
Create Date: 2025-12-18

This is a NO-OP migration whose sole purpose is to preserve the Alembic
revision graph for databases that already have alembic_version=2b49362d2565.
"""

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "2b49362d2565"
down_revision = "1234567890ab"
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
