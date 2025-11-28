"""add status/owner/note and created_by_user_id to alert/site events

Revision ID: add_alert_workflow_fields_002
Revises: add_alert_and_site_events_001
Create Date: 2025-11-28 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "add_alert_workflow_fields_002"
down_revision = "add_alert_and_site_events_001"
branch_labels = None
depends_on = None


def upgrade():
    # SQLite-safe alterations
    with op.batch_alter_table("alert_events") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default="open",
            )
        )
        batch_op.add_column(
            sa.Column("owner_user_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("note", sa.Text(), nullable=True)
        )

    with op.batch_alter_table("site_events") as batch_op:
        batch_op.add_column(
            sa.Column("created_by_user_id", sa.Integer(), nullable=True)
        )


def downgrade():
    with op.batch_alter_table("site_events") as batch_op:
        batch_op.drop_column("created_by_user_id")

    with op.batch_alter_table("alert_events") as batch_op:
        batch_op.drop_column("note")
        batch_op.drop_column("owner_user_id")
        batch_op.drop_column("status")
