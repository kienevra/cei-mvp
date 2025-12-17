"""add org_invites (NO-OP graph fix)

Revision ID: 134868d9b425
Revises: 7a2f3c1d9b10
Create Date: 2025-12-16 11:57:43.681559

NOTE:
This revision was intentionally converted into a NO-OP to avoid regressions.
It exists only to preserve a stable revision chain.

The REAL org_invites creation happens in 7a2f3c1d9b10_add_org_invites.py.
"""

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "134868d9b425"
down_revision = "7a2f3c1d9b10"
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
