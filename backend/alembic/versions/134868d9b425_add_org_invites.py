"""add org_invites

Revision ID: 134868d9b425
Revises: 2b541387ade1

Create Date: 2025-12-16 11:57:43.681559

NOTE:
This revision was auto-generated incorrectly and included unrelated schema changes
(create tables / drop columns / alter types) that would cause regressions and/or
fail on existing databases.

We intentionally make this migration a NO-OP to preserve the revision chain.
Actual invite onboarding changes are implemented in a follow-up migration.
"""

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "134868d9b425"
down_revision = "2b541387ade1"
branch_labels = None
depends_on = None


def upgrade():
    # Intentionally empty (NO-OP). See NOTE in header docstring.
    pass


def downgrade():
    # Intentionally empty (NO-OP). See NOTE in header docstring.
    pass
