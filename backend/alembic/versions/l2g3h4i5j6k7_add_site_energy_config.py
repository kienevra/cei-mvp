"""add site-level energy and emissions config columns

Revision ID: l2g3h4i5j6k7
Revises: k1f2g3h4i5j6
Create Date: 2026-05-20
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "l2g3h4i5j6k7"
down_revision = "k1f2g3h4i5j6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Site-level energy & emissions config ──────────────────────────────────
    # These columns allow per-site overrides of the org-level defaults.
    # If null, the emissions calculator falls back to org_emissions_config.
    with op.batch_alter_table("site") as batch_op:
        # Energy tariffs (financial)
        batch_op.add_column(sa.Column(
            "electricity_price_per_kwh",
            sa.Numeric(10, 4),
            nullable=True,
            comment="€/kWh electricity tariff for this site"
        ))
        batch_op.add_column(sa.Column(
            "gas_price_per_kwh",
            sa.Numeric(10, 4),
            nullable=True,
            comment="€/kWh gas tariff for this site"
        ))
        batch_op.add_column(sa.Column(
            "currency_code",
            sa.String(3),
            nullable=True,
            comment="ISO 4217 currency code e.g. EUR, USD, KES"
        ))

        # Emissions config (regulatory)
        batch_op.add_column(sa.Column(
            "country_code",
            sa.String(3),
            nullable=True,
            comment="ISO 3166-1 alpha-3 country code for emission factor lookup"
        ))
        batch_op.add_column(sa.Column(
            "framework",
            sa.String(32),
            nullable=True,
            comment="Regulatory framework: EU_ETS, CBAM, VCS, GOLD_STANDARD, ISO14064"
        ))
        batch_op.add_column(sa.Column(
            "sector_code",
            sa.String(32),
            nullable=True,
            comment="Industrial sector: ceramics, cement, steel, food, chemicals, etc."
        ))
        batch_op.add_column(sa.Column(
            "primary_energy_source",
            sa.String(32),
            nullable=True,
            comment="Primary energy source: electricity, natural_gas, lpg, diesel, biomass"
        ))
        batch_op.add_column(sa.Column(
            "secondary_energy_source",
            sa.String(32),
            nullable=True,
            comment="Optional secondary energy source"
        ))

        # Production data (for EnPI calculation)
        batch_op.add_column(sa.Column(
            "annual_production_volume",
            sa.Numeric(18, 3),
            nullable=True,
            comment="Annual production volume in production_unit (for EnPI tCO2/unit)"
        ))
        batch_op.add_column(sa.Column(
            "production_unit",
            sa.String(32),
            nullable=True,
            comment="Unit of production: tonne, m2, units, MWh, etc."
        ))

        # ETS specific
        batch_op.add_column(sa.Column(
            "free_allocation_tonnes",
            sa.Numeric(12, 3),
            nullable=True,
            comment="ETS free allocation quota for this site (tCO2/year)"
        ))
        batch_op.add_column(sa.Column(
            "reporting_year",
            sa.Integer,
            nullable=True,
            comment="Reporting year for emissions calculations"
        ))

        # Metadata
        batch_op.add_column(sa.Column(
            "config_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Last time site config was updated"
        ))


def downgrade() -> None:
    with op.batch_alter_table("site") as batch_op:
        for col in [
            "electricity_price_per_kwh",
            "gas_price_per_kwh",
            "currency_code",
            "country_code",
            "framework",
            "sector_code",
            "primary_energy_source",
            "secondary_energy_source",
            "annual_production_volume",
            "production_unit",
            "free_allocation_tonnes",
            "reporting_year",
            "config_updated_at",
        ]:
            batch_op.drop_column(col)