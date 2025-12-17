"""merge heads: integration tokens + alerts workflow

Revision ID: be01ef48d298
Revises: 0d504a6c33ac, add_alert_workflow_fields_002
Create Date: 2025-XX-XX

This is a merge revision to unify multiple heads.
No schema changes happen here.
"""

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "be01ef48d298"
down_revision = ("0d504a6c33ac", "add_alert_workflow_fields_002")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
