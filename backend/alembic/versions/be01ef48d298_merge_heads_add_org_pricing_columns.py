"""
merge heads (alerts workflow + integration tokens)

Revision ID: be01ef48d298
Revises: 0d504a6c33ac, add_alert_workflow_fields_002
Create Date: 2025-xx-xx

This is a MERGE revision to reconcile two parallel heads:
- 0d504a6c33ac (integration tokens / related branch)
- add_alert_workflow_fields_002 (alerts workflow branch)

No schema changes here — this revision only fixes the Alembic graph.
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
