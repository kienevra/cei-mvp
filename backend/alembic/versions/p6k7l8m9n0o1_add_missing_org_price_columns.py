"""Add missing org price/currency columns

Revision ID: p6k7l8m9n0o1
Revises: o5j6k7l8m9n0
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa

revision = "p6k7l8m9n0o1"
down_revision = "o5j6k7l8m9n0"
branch_labels = None
depends_on = None


def column_exists(table, column):
    from sqlalchemy import inspect
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade():
    if not column_exists("organization", "electricity_price_per_kwh"):
        op.add_column("organization", sa.Column(
            "electricity_price_per_kwh", sa.Numeric(10, 4), nullable=True
        ))
    if not column_exists("organization", "gas_price_per_kwh"):
        op.add_column("organization", sa.Column(
            "gas_price_per_kwh", sa.Numeric(10, 4), nullable=True
        ))
    if not column_exists("organization", "currency_code"):
        op.add_column("organization", sa.Column(
            "currency_code", sa.String(3), nullable=True
        ))


def downgrade():
    op.drop_column("organization", "currency_code")
    op.drop_column("organization", "gas_price_per_kwh")
    op.drop_column("organization", "electricity_price_per_kwh")