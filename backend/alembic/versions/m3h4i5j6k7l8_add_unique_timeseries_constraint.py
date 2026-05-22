"""add unique constraint on timeseries_record (site_id, meter_id, timestamp)

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-05-22
"""
from alembic import op
import sqlalchemy as sa

revision = "m3h4i5j6k7l8"
down_revision = "l2g3h4i5j6k7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: Remove duplicates keeping the highest id (most recent insert)
    op.execute("""
        DELETE FROM timeseries_record
        WHERE id NOT IN (
            SELECT MAX(id)
            FROM timeseries_record
            GROUP BY site_id, meter_id, timestamp
        )
    """)

    # Step 2: Add unique constraint
    op.create_unique_constraint(
        "uq_timeseries_site_meter_timestamp",
        "timeseries_record",
        ["site_id", "meter_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_timeseries_site_meter_timestamp",
        "timeseries_record",
        type_="unique",
    )
