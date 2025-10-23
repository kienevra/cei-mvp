"""create timeseries_record and staging_upload tables

Revision ID: 1234567890ab
Revises: None
Create Date: 2025-10-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "1234567890ab"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "staging_upload",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )

    op.create_table(
        "timeseries_record",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("sensor_external_id", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(), nullable=True),
        sa.Column("source_staging_id", sa.String(), sa.ForeignKey("staging_upload.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_unique_constraint("uq_sensor_timestamp", "timeseries_record", ["sensor_external_id", "timestamp"])


def downgrade():
    op.drop_table("timeseries_record")
    op.drop_table("staging_upload")
