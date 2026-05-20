"""add emissions tables: emission_factors, sector_benchmarks, org_emissions_config

Revision ID: k1f2g3h4i5j6
Revises: j0e1f2g3h4i5
Create Date: 2026-05-19
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "k1f2g3h4i5j6"
down_revision = "j0e1f2g3h4i5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. emission_factors ───────────────────────────────────────────────────
    # Stores official CO₂ emission factors by country, energy source, and year.
    # Sources: ISPRA (Italy), IPCC, national grid operators, Verra/GS (voluntary).
    op.create_table(
        "emission_factor",
        sa.Column("id",               sa.Integer,     primary_key=True),
        sa.Column("country_code",     sa.String(3),   nullable=False),   # ISO 3166-1 alpha-3
        sa.Column("region_code",      sa.String(16),  nullable=True),    # e.g. "EU", "EAC", "VOLUNTARY"
        sa.Column("energy_source",    sa.String(32),  nullable=False),   # electricity, natural_gas, lpg, diesel, biomass
        sa.Column("factor_kg_co2_kwh",sa.Numeric(10,6),nullable=False),  # kg CO₂ per kWh
        sa.Column("valid_year",       sa.Integer,     nullable=False),   # year this factor applies
        sa.Column("framework",        sa.String(32),  nullable=False),   # EU_ETS, CBAM, UK_ETS, VCS, GOLD_STANDARD, ISO14064
        sa.Column("source_url",       sa.Text,        nullable=True),    # official publication URL
        sa.Column("notes",            sa.Text,        nullable=True),
        sa.Column("created_at",       sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("country_code", "energy_source", "valid_year", "framework",
                            name="uq_emission_factor"),
    )
    op.create_index("ix_emission_factor_country_year",
                    "emission_factor", ["country_code", "valid_year"])

    # ── 2. sector_benchmarks ─────────────────────────────────────────────────
    # ETS free-allocation benchmarks per sector.
    # For voluntary markets: baseline intensity for credit issuance.
    op.create_table(
        "sector_benchmark",
        sa.Column("id",                   sa.Integer,      primary_key=True),
        sa.Column("framework",            sa.String(32),   nullable=False),  # EU_ETS, VCS, etc.
        sa.Column("sector_code",          sa.String(32),   nullable=False),  # ceramics, cement, steel, food, chemicals
        sa.Column("benchmark_value",      sa.Numeric(12,6),nullable=False),  # tCO₂ per unit of product
        sa.Column("product_unit",         sa.String(32),   nullable=False),  # tonne, m2, MWh, etc.
        sa.Column("valid_from_year",      sa.Integer,      nullable=False),
        sa.Column("valid_to_year",        sa.Integer,      nullable=True),   # null = still valid
        sa.Column("reduction_rate_pct",   sa.Numeric(6,4), nullable=True),   # annual % reduction (ETS Phase 4 = 4.4)
        sa.Column("notes",                sa.Text,         nullable=True),
        sa.Column("created_at",           sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("framework", "sector_code", "valid_from_year",
                            name="uq_sector_benchmark"),
    )
    op.create_index("ix_sector_benchmark_framework_sector",
                    "sector_benchmark", ["framework", "sector_code"])

    # ── 3. org_emissions_config ───────────────────────────────────────────────
    # Per-organization emissions configuration set by the consultant.
    op.create_table(
        "org_emissions_config",
        sa.Column("id",                 sa.Integer,      primary_key=True),
        sa.Column("organization_id",    sa.Integer,
                  sa.ForeignKey("organization.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("country_code",       sa.String(3),    nullable=False, server_default="ITA"),
        sa.Column("framework",          sa.String(32),   nullable=False, server_default="EU_ETS"),
        sa.Column("sector_code",        sa.String(32),   nullable=True),   # ceramics, cement, etc.
        sa.Column("primary_energy_source", sa.String(32),nullable=False, server_default="electricity"),
        sa.Column("secondary_energy_source", sa.String(32), nullable=True),
        sa.Column("annual_production_volume", sa.Numeric(18,3), nullable=True),  # units/year
        sa.Column("production_unit",    sa.String(32),   nullable=True),   # tonne, m2, units
        sa.Column("reporting_year",     sa.Integer,      nullable=True),   # which year to report
        sa.Column("free_allocation_tonnes", sa.Numeric(12,3), nullable=True),  # ETS free quota
        sa.Column("created_at",         sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at",         sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now()),
    )
    op.create_index("ix_org_emissions_config_org",
                    "org_emissions_config", ["organization_id"])

    # ── 4. Seed official emission factors ────────────────────────────────────
    op.execute("""
    INSERT INTO emission_factor
        (country_code, region_code, energy_source, factor_kg_co2_kwh, valid_year, framework, source_url, notes)
    VALUES
    -- Italy (ISPRA 2024)
    ('ITA', 'EU', 'electricity',   0.280000, 2024, 'EU_ETS',       'https://www.ispra.it/ghg', 'ISPRA 2024 national grid average'),
    ('ITA', 'EU', 'electricity',   0.280000, 2024, 'CBAM',         'https://www.ispra.it/ghg', 'ISPRA 2024 national grid average'),
    ('ITA', 'EU', 'natural_gas',   0.202000, 2024, 'EU_ETS',       'https://www.ispra.it/ghg', 'IPCC Tier 1 natural gas'),
    ('ITA', 'EU', 'natural_gas',   0.202000, 2024, 'CBAM',         'https://www.ispra.it/ghg', 'IPCC Tier 1 natural gas'),
    ('ITA', 'EU', 'lpg',           0.227000, 2024, 'EU_ETS',       'https://www.ispra.it/ghg', 'IPCC Tier 1 LPG'),
    ('ITA', 'EU', 'diesel',        0.267000, 2024, 'EU_ETS',       'https://www.ispra.it/ghg', 'IPCC Tier 1 diesel'),
    ('ITA', 'EU', 'biomass',       0.000000, 2024, 'EU_ETS',       'https://www.ispra.it/ghg', 'Biomass: zero EU ETS counting'),
    -- Italy 2023 (historical)
    ('ITA', 'EU', 'electricity',   0.296000, 2023, 'EU_ETS',       'https://www.ispra.it/ghg', 'ISPRA 2023'),
    ('ITA', 'EU', 'natural_gas',   0.202000, 2023, 'EU_ETS',       'https://www.ispra.it/ghg', 'IPCC Tier 1'),
    -- EU average (for cross-country portfolios)
    ('EUR', 'EU', 'electricity',   0.233000, 2024, 'EU_ETS',       'https://www.eea.europa.eu', 'EEA 2024 EU27 average'),
    ('EUR', 'EU', 'electricity',   0.233000, 2024, 'CBAM',         'https://www.eea.europa.eu', 'EEA 2024 EU27 average'),
    -- UK
    ('GBR', 'UK', 'electricity',   0.207000, 2024, 'UK_ETS',       'https://www.gov.uk/greenhouse-gas-reporting', 'DESNZ 2024 grid factor'),
    ('GBR', 'UK', 'natural_gas',   0.203000, 2024, 'UK_ETS',       'https://www.gov.uk/greenhouse-gas-reporting', 'DESNZ 2024'),
    -- Kenya (geothermal-heavy grid)
    ('KEN', 'EAC', 'electricity',  0.180000, 2024, 'GOLD_STANDARD','https://www.kebs.org',     'Kenya grid 2024 - geothermal dominant'),
    ('KEN', 'EAC', 'electricity',  0.180000, 2024, 'VCS',          'https://www.kebs.org',     'Kenya grid 2024 - Verra VCS'),
    ('KEN', 'EAC', 'natural_gas',  0.202000, 2024, 'VCS',          'https://www.kebs.org',     'IPCC Tier 1 - no national factor published'),
    ('KEN', 'EAC', 'diesel',       0.267000, 2024, 'VCS',          'https://www.kebs.org',     'IPCC Tier 1 diesel'),
    -- South Africa
    ('ZAF', 'SSA', 'electricity',  0.928000, 2024, 'VCS',          'https://www.energy.gov.za','Eskom grid 2024 - coal dominant'),
    ('ZAF', 'SSA', 'natural_gas',  0.202000, 2024, 'VCS',          'https://www.energy.gov.za','IPCC Tier 1'),
    -- Tanzania
    ('TZA', 'EAC', 'electricity',  0.314000, 2024, 'VCS',          'https://www.tanesco.co.tz', 'Tanzania grid 2024'),
    -- Ethiopia
    ('ETH', 'EAC', 'electricity',  0.021000, 2024, 'VCS',          'https://www.eepco.gov.et', 'Ethiopia grid 2024 - hydro dominant'),
    -- USA average
    ('USA', 'NA',  'electricity',  0.386000, 2024, 'ISO14064',     'https://www.epa.gov/ghgemissions', 'EPA eGRID 2024 national average'),
    ('USA', 'NA',  'natural_gas',  0.202000, 2024, 'ISO14064',     'https://www.epa.gov/ghgemissions', 'EPA 2024');
    """)

    # ── 5. Seed sector benchmarks ─────────────────────────────────────────────
    op.execute("""
    INSERT INTO sector_benchmark
        (framework, sector_code, benchmark_value, product_unit, valid_from_year, valid_to_year, reduction_rate_pct, notes)
    VALUES
    -- EU ETS Phase 4 sector benchmarks (tCO₂ per tonne of product)
    ('EU_ETS', 'ceramics',       0.123000, 'tonne', 2021, NULL, 4.4000, 'EU ETS Phase 4 ceramics benchmark - Annex I Directive 2003/87/EC'),
    ('EU_ETS', 'cement',         0.766000, 'tonne', 2021, NULL, 4.4000, 'EU ETS Phase 4 cement clinker benchmark'),
    ('EU_ETS', 'steel',          1.328000, 'tonne', 2021, NULL, 4.4000, 'EU ETS Phase 4 hot metal benchmark'),
    ('EU_ETS', 'glass',          0.453000, 'tonne', 2021, NULL, 4.4000, 'EU ETS Phase 4 float glass benchmark'),
    ('EU_ETS', 'chemicals',      0.700000, 'tonne', 2021, NULL, 4.4000, 'EU ETS Phase 4 ammonia proxy'),
    ('EU_ETS', 'food',           0.000000, 'tonne', 2021, NULL, 4.4000, 'Food sector: no specific ETS benchmark, use energy intensity'),
    ('EU_ETS', 'paper',          0.237000, 'tonne', 2021, NULL, 4.4000, 'EU ETS Phase 4 paper benchmark'),
    -- CBAM sectors (operative Jan 2026 - same benchmarks as ETS)
    ('CBAM',   'ceramics',       0.123000, 'tonne', 2026, NULL, 4.4000, 'CBAM Regulation (EU) 2023/956 - ceramics'),
    ('CBAM',   'cement',         0.766000, 'tonne', 2026, NULL, 4.4000, 'CBAM - cement clinker'),
    ('CBAM',   'steel',          1.328000, 'tonne', 2026, NULL, 4.4000, 'CBAM - steel'),
    ('CBAM',   'aluminium',      1.514000, 'tonne', 2026, NULL, 4.4000, 'CBAM - aluminium'),
    ('CBAM',   'fertilizers',    2.300000, 'tonne', 2026, NULL, 4.4000, 'CBAM - fertilizers (urea proxy)'),
    ('CBAM',   'hydrogen',      10.800000, 'tonne', 2026, NULL, 4.4000, 'CBAM - hydrogen from fossil fuels'),
    -- Verra VCS voluntary benchmarks (Kenya/Africa focus)
    ('VCS',    'manufacturing',  0.500000, 'tonne', 2024, NULL, 0.0000, 'VCS generic manufacturing baseline - project-specific'),
    ('VCS',    'ceramics',       0.123000, 'tonne', 2024, NULL, 0.0000, 'VCS ceramics - aligned with EU benchmark for comparability'),
    -- Gold Standard
    ('GOLD_STANDARD', 'manufacturing', 0.500000, 'tonne', 2024, NULL, 0.0000, 'GS generic industrial baseline');
    """)


def downgrade() -> None:
    op.drop_table("org_emissions_config")
    op.drop_table("sector_benchmark")
    op.drop_table("emission_factor")