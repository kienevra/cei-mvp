"""Initial core schema migration (SQLite + Postgres).

This project originally used Base.metadata.create_all() for SQLite dev.
That made Alembic non-replayable from a fresh dev.db.

This migration now creates the minimum core tables that later migrations
(and demo_seed) assume exist:
- organization
- user
- site
- timeseries_record
- staging_upload

Downstream migrations then add:
- billing tables
- alert/site events
- integration_tokens
- org pricing columns
- user role column, etc.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "1234567890ab"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- organization ----
    op.create_table(
        "organization",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )

    # ---- user ----
    # NOTE: "user" is a reserved-ish identifier in some DBs, but SQLite allows it.
    # Your codebase already uses __tablename__ = "user", so we keep it consistent.
    op.create_table(
        "user",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organization.id"), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True, index=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        # Supabase historically stores this as INTEGER-ish; keep boolean semantics but default to 0.
        sa.Column("is_superuser", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )

    # ---- site ----
    op.create_table(
        "site",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organization.id"), nullable=False, index=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )

    # ---- timeseries_record ----
    op.create_table(
        "timeseries_record",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.String(length=128), nullable=False, index=True),
        sa.Column("meter_id", sa.String(length=128), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("value", sa.Numeric(), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_timeseries_site_timestamp",
        "timeseries_record",
        ["site_id", "timestamp"],
        unique=False,
    )

    # ---- staging_upload ----
    op.create_table(
        "staging_upload",
        sa.Column("job_id", sa.String(length=128), primary_key=True),
        sa.Column("org_id", sa.Integer(), nullable=True, index=True),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("staging_upload")
    op.drop_index("ix_timeseries_site_timestamp", table_name="timeseries_record")
    op.drop_table("timeseries_record")
    op.drop_table("site")
    op.drop_table("user")
    op.drop_table("organization")
