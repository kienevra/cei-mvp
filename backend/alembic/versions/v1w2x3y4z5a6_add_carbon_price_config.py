"""add ets_carbon_price_eur to site and org_emissions_config

Revision ID: v1w2x3y4z5a6
Revises: b2c3d4e5f6a7
Create Date: 2026-07-07
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "v1w2x3y4z5a6"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("site") as batch_op:
        batch_op.add_column(sa.Column(
            "ets_carbon_price_eur",
            sa.Numeric(10, 2),
            nullable=True,
            comment="EUR/tCO2 carbon price override for this site"
        ))
    with op.batch_alter_table("org_emissions_config") as batch_op:
        batch_op.add_column(sa.Column(
            "ets_carbon_price_eur",
            sa.Numeric(10, 2),
            nullable=True,
            comment="EUR/tCO2 carbon price override for this org"
        ))


def downgrade() -> None:
    with op.batch_alter_table("site") as batch_op:
        batch_op.drop_column("ets_carbon_price_eur")
    with op.batch_alter_table("org_emissions_config") as batch_op:
        batch_op.drop_column("ets_carbon_price_eur")