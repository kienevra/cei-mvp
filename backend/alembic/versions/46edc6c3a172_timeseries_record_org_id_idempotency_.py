"""timeseries_record: add org_id + idempotency_key + source

Revision ID: 46edc6c3a172
Revises: e64f3a31a3ec
Create Date: 2025-12-26 10:23:37

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "46edc6c3a172"
down_revision = "e64f3a31a3ec"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite-safe ALTER TABLE via batch mode
    with op.batch_alter_table("timeseries_record") as batch:
        batch.add_column(sa.Column("org_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("idempotency_key", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("source", sa.String(length=64), nullable=True))

        # Unique constraint for idempotent ingest within an org.
        # NOTE: idempotency_key is nullable; most DBs allow multiple NULLs.
        batch.create_unique_constraint("uq_ts_org_idem", ["org_id", "idempotency_key"])

        batch.create_index("ix_timeseries_record_org_id", ["org_id"], unique=False)
        batch.create_index("ix_timeseries_record_idempotency_key", ["idempotency_key"], unique=False)
        batch.create_index(
            "ix_timeseries_org_site_timestamp",
            ["org_id", "site_id", "timestamp"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("timeseries_record") as batch:
        batch.drop_index("ix_timeseries_org_site_timestamp")
        batch.drop_index("ix_timeseries_record_idempotency_key")
        batch.drop_index("ix_timeseries_record_org_id")

        batch.drop_constraint("uq_ts_org_idem", type_="unique")

        batch.drop_column("source")
        batch.drop_column("idempotency_key")
        batch.drop_column("org_id")
