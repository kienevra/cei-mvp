"""
Revision ID: <revision_id>
Revises: 
Create Date: <date>

Migration: Create timeseries_records and staging_uploads tables
"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_table(
        "timeseries_records",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.String, nullable=False),
        sa.Column("meter_id", sa.String, nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Numeric, nullable=False),
        sa.Column("unit", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "staging_uploads",
        sa.Column("job_id", sa.String, primary_key=True),
        sa.Column("payload_path", sa.String, nullable=False),
        sa.Column("status", sa.String, nullable=False, default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

def downgrade():
    op.drop_table("staging_uploads")
    op.drop_table("timeseries_records")
