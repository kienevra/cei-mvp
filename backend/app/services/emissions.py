# backend/app/services/emissions.py
"""
CEI Emissions Calculator Service
=================================
Converts kWh timeseries data into verified CO₂ emissions figures using
official calculation methodologies:

  EU ETS / CBAM  : EU Directive 2003/87/EC, Regulation (EU) 2023/956
  UK ETS         : DESNZ Greenhouse Gas Reporting Methodology
  ISO 14064      : GHG quantification and reporting
  Verra VCS      : Verified Carbon Standard methodology
  Gold Standard  : Gold Standard for the Global Goals

Core formula (all frameworks):
  tCO₂ = Σ(kWh_i × EF_i) / 1000

Where:
  kWh_i = energy consumed from source i
  EF_i  = emission factor (kg CO₂/kWh) for source i, country, year
  /1000 = convert kg → tonnes

For ETS position:
  surplus_deficit_tCO2 = free_allocation - total_emissions
  If negative: client must purchase ETS credits
  If positive: client has surplus (can sell or bank)

For EnPI (ISO 50001):
  enpi = total_kwh / production_volume  (kWh per unit of product)
  emissions_intensity = total_tco2 / production_volume  (tCO₂ per unit)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from app.models import (
    EmissionFactor,
    SectorBenchmark,
    OrgEmissionsConfig,
    TimeseriesRecord,
    Organization,
)

logger = logging.getLogger("cei")


# ── Result dataclasses ─────────────────────────────────────────────────────────

@dataclass
class EmissionsResult:
    """Complete emissions calculation result for an organization."""
    organization_id: int
    organization_name: str
    country_code: str
    framework: str
    sector_code: Optional[str]
    reporting_year: int

    # Core emissions
    total_kwh: float                        # total energy consumed (kWh)
    total_tco2: float                       # total CO₂ emissions (tCO₂)
    emission_factor_kg_co2_kwh: float       # factor used
    energy_source: str                      # primary source used

    # ETS position (if applicable)
    free_allocation_tonnes: Optional[float] # ETS free quota
    ets_surplus_deficit: Optional[float]    # positive = surplus, negative = deficit
    ets_credit_cost_eur: Optional[float]    # estimated cost if deficit (@ ~65 EUR/tCO₂)

    # Benchmark comparison
    benchmark_value: Optional[float]        # tCO₂ per unit of product
    production_volume: Optional[float]      # units/year
    production_unit: Optional[str]
    actual_intensity: Optional[float]       # tCO₂ per unit (actual)
    benchmark_gap: Optional[float]          # actual - benchmark (negative = better than benchmark)
    benchmark_gap_pct: Optional[float]      # % above/below benchmark

    # EnPI (ISO 50001)
    enpi_kwh_per_unit: Optional[float]      # kWh per unit of product
    emissions_intensity: Optional[float]    # tCO₂ per unit of product

    # Annualised projections
    annualised_tco2: Optional[float]        # projected annual tCO₂
    annualised_kwh: Optional[float]         # projected annual kWh

    # Data quality
    data_window_days: int                   # days of data used
    data_points: int                        # number of timeseries records
    calculation_method: str                 # methodology description
    factor_source: Optional[str]            # official source URL
    calculated_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @property
    def is_cbam_ready(self) -> bool:
        return (
            self.data_window_days >= 30
            and self.total_kwh > 0
            and self.energy_source is not None
        )

    @property
    def ets_position_label(self) -> str:
        if self.ets_surplus_deficit is None:
            return "Not configured"
        if self.ets_surplus_deficit > 0:
            return f"Surplus: +{self.ets_surplus_deficit:.1f} tCO₂"
        return f"Deficit: {self.ets_surplus_deficit:.1f} tCO₂ (purchase required)"

    @property
    def benchmark_position_label(self) -> str:
        if self.benchmark_gap_pct is None:
            return "No benchmark"
        if self.benchmark_gap_pct <= 0:
            return f"Below benchmark ✓ ({abs(self.benchmark_gap_pct):.1f}% better)"
        return f"Above benchmark ✗ ({self.benchmark_gap_pct:.1f}% worse)"


@dataclass
class EmissionsConfigOut:
    """Serializable emissions config for API responses."""
    organization_id: int
    country_code: str
    framework: str
    sector_code: Optional[str]
    primary_energy_source: str
    secondary_energy_source: Optional[str]
    annual_production_volume: Optional[float]
    production_unit: Optional[str]
    reporting_year: Optional[int]
    free_allocation_tonnes: Optional[float]


# ── Supported frameworks ───────────────────────────────────────────────────────

FRAMEWORKS = {
    "EU_ETS":        "EU Emissions Trading System (Phase 4)",
    "CBAM":          "Carbon Border Adjustment Mechanism",
    "UK_ETS":        "UK Emissions Trading Scheme",
    "VCS":           "Verra Verified Carbon Standard",
    "GOLD_STANDARD": "Gold Standard for the Global Goals",
    "ISO14064":      "ISO 14064 GHG Quantification",
}

ENERGY_SOURCES = [
    "electricity",
    "natural_gas",
    "lpg",
    "diesel",
    "biomass",
    "solar",
    "wind",
]

SECTORS = [
    "ceramics",
    "cement",
    "steel",
    "glass",
    "chemicals",
    "food",
    "paper",
    "aluminium",
    "fertilizers",
    "hydrogen",
    "manufacturing",
]

# ETS carbon price estimate (EUR/tCO₂) — used for cost calculations
# Update periodically based on EU carbon market
ETS_CARBON_PRICE_EUR = 65.0


# ── Main calculator ────────────────────────────────────────────────────────────

class EmissionsCalculator:
    """
    Calculates CO₂ emissions from kWh timeseries using official factors.
    """

    def __init__(self, db: Session):
        self.db = db

    def get_emission_factor(
        self,
        country_code: str,
        energy_source: str,
        year: int,
        framework: str,
    ) -> Optional[EmissionFactor]:
        """
        Fetch the best-match emission factor.
        Priority: exact country match → regional average → global IPCC default.
        """
        # 1. Exact country + framework match
        ef = self.db.query(EmissionFactor).filter(
            and_(
                EmissionFactor.country_code == country_code,
                EmissionFactor.energy_source == energy_source,
                EmissionFactor.valid_year == year,
                EmissionFactor.framework == framework,
            )
        ).first()
        if ef:
            return ef

        # 2. Same country, most recent year available
        ef = self.db.query(EmissionFactor).filter(
            and_(
                EmissionFactor.country_code == country_code,
                EmissionFactor.energy_source == energy_source,
                EmissionFactor.framework == framework,
            )
        ).order_by(EmissionFactor.valid_year.desc()).first()
        if ef:
            logger.info(
                "EmissionFactor: using %s data for %s (requested %s)",
                ef.valid_year, country_code, year
            )
            return ef

        # 3. Regional average (EUR for EU countries, EAC for East Africa, etc.)
        region_map = {
            "ITA": "EU", "DEU": "EU", "FRA": "EU", "ESP": "EU", "POL": "EU",
            "KEN": "EAC", "TZA": "EAC", "UGA": "EAC", "RWA": "EAC",
            "GBR": "UK",
        }
        region = region_map.get(country_code)
        if region:
            ef = self.db.query(EmissionFactor).filter(
                and_(
                    EmissionFactor.region_code == region,
                    EmissionFactor.energy_source == energy_source,
                    EmissionFactor.framework == framework,
                )
            ).order_by(EmissionFactor.valid_year.desc()).first()
            if ef:
                logger.info(
                    "EmissionFactor: using regional %s average for %s",
                    region, country_code
                )
                return ef

        # 4. IPCC defaults (electricity: 0.233 EU avg; gas: 0.202 global)
        ipcc_defaults = {
            "electricity": 0.233,
            "natural_gas": 0.202,
            "lpg":         0.227,
            "diesel":      0.267,
            "biomass":     0.000,
        }
        if energy_source in ipcc_defaults:
            logger.warning(
                "EmissionFactor: no official factor for %s/%s/%s — using IPCC default",
                country_code, energy_source, year
            )
            # Return a synthetic factor object
            synthetic = EmissionFactor()
            synthetic.factor_kg_co2_kwh = ipcc_defaults[energy_source]
            synthetic.source_url = "https://www.ipcc.ch/report/2006-ipcc-guidelines-for-national-greenhouse-gas-inventories/"
            synthetic.notes = "IPCC Tier 1 default — no country-specific factor available"
            return synthetic

        return None

    def get_sector_benchmark(
        self,
        framework: str,
        sector_code: str,
        year: int,
    ) -> Optional[SectorBenchmark]:
        """
        Fetch the sector benchmark, applying annual reduction if applicable.
        For EU ETS Phase 4: benchmark reduces 4.4%/year from base year.
        """
        bm = self.db.query(SectorBenchmark).filter(
            and_(
                SectorBenchmark.framework == framework,
                SectorBenchmark.sector_code == sector_code,
                SectorBenchmark.valid_from_year <= year,
                (SectorBenchmark.valid_to_year >= year) |
                (SectorBenchmark.valid_to_year.is_(None)),
            )
        ).first()

        if bm and bm.reduction_rate_pct and bm.reduction_rate_pct > 0:
            # Apply annual reduction: benchmark_year_N = base × (1 - rate)^(N - base_year)
            years_elapsed = year - bm.valid_from_year
            reduction = float(bm.reduction_rate_pct) / 100.0
            adjusted_value = float(bm.benchmark_value) * ((1 - reduction) ** years_elapsed)
            # Create adjusted copy
            adjusted = SectorBenchmark()
            adjusted.benchmark_value = adjusted_value
            adjusted.product_unit = bm.product_unit
            adjusted.framework = bm.framework
            adjusted.sector_code = bm.sector_code
            adjusted.notes = (
                f"{bm.notes} — adjusted for {years_elapsed} years at "
                f"{bm.reduction_rate_pct}%/yr reduction"
            )
            return adjusted

        return bm

    def get_kwh_for_org(
        self,
        organization_id: int,
        year: int,
    ) -> tuple[float, int, int]:
        """
        Sum all kWh timeseries for an org in a given year.
        Returns (total_kwh, data_points, days_covered).
        """
        from app.models import Site

        start = datetime(year, 1, 1, tzinfo=timezone.utc)
        end   = datetime(year + 1, 1, 1, tzinfo=timezone.utc)

        # Get all site IDs for this org
        sites = self.db.query(Site).filter(Site.org_id == organization_id).all()
        if not sites:
            return 0.0, 0, 0

        site_ids = [f"site-{s.id}" for s in sites] + [str(s.id) for s in sites]

        result = self.db.query(
            func.sum(TimeseriesRecord.value).label("total_kwh"),
            func.count(TimeseriesRecord.id).label("data_points"),
        ).filter(
            and_(
                TimeseriesRecord.site_id.in_(site_ids),
                TimeseriesRecord.timestamp >= start,
                TimeseriesRecord.timestamp < end,
            )
        ).first()

        total_kwh   = float(result.total_kwh or 0)
        data_points = int(result.data_points or 0)

        # Approximate days covered from data points (assuming hourly)
        days_covered = min(data_points // (3 * 24), 365) if data_points > 0 else 0

        return total_kwh, data_points, days_covered

    def get_kwh_window(
        self,
        organization_id: int,
        window_hours: int = 168,
    ) -> tuple[float, int]:
        """
        Sum kWh for the last N hours across all org sites.
        Returns (total_kwh, data_points).
        """
        from app.models import Site
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)

        sites = self.db.query(Site).filter(Site.org_id == organization_id).all()
        if not sites:
            return 0.0, 0

        site_ids = [f"site-{s.id}" for s in sites] + [str(s.id) for s in sites]

        result = self.db.query(
            func.sum(TimeseriesRecord.value).label("total_kwh"),
            func.count(TimeseriesRecord.id).label("data_points"),
        ).filter(
            and_(
                TimeseriesRecord.site_id.in_(site_ids),
                TimeseriesRecord.timestamp >= cutoff,
            )
        ).first()

        return float(result.total_kwh or 0), int(result.data_points or 0)

    def calculate(
        self,
        organization_id: int,
        window_hours: Optional[int] = None,   # if None, uses reporting_year
    ) -> Optional[EmissionsResult]:
        """
        Main calculation entry point.
        Returns EmissionsResult or None if no config or no data.
        """
        # Load config
        config = self.db.query(OrgEmissionsConfig).filter(
            OrgEmissionsConfig.organization_id == organization_id
        ).first()

        org = self.db.query(Organization).filter(
            Organization.id == organization_id
        ).first()

        if not org:
            return None

        # Use defaults if no config set
        country_code   = config.country_code if config else "ITA"
        framework      = config.framework    if config else "EU_ETS"
        energy_source  = config.primary_energy_source if config else "electricity"
        sector_code    = config.sector_code  if config else None
        reporting_year = (
            config.reporting_year if (config and config.reporting_year)
            else datetime.now(timezone.utc).year
        )
        production_volume = float(config.annual_production_volume) if (
            config and config.annual_production_volume
        ) else None
        production_unit = config.production_unit if config else None
        free_alloc = float(config.free_allocation_tonnes) if (
            config and config.free_allocation_tonnes
        ) else None

        # Get kWh data
        if window_hours:
            total_kwh, data_points = self.get_kwh_window(organization_id, window_hours)
            data_window_days = window_hours // 24
        else:
            total_kwh, data_points, data_window_days = self.get_kwh_for_org(
                organization_id, reporting_year
            )

        if total_kwh == 0:
            logger.warning("EmissionsCalculator: no kWh data for org %s", organization_id)

        # Get emission factor
        ef = self.get_emission_factor(country_code, energy_source, reporting_year, framework)
        if not ef:
            logger.error(
                "EmissionsCalculator: no emission factor for %s/%s/%s/%s",
                country_code, energy_source, reporting_year, framework
            )
            return None

        factor = float(ef.factor_kg_co2_kwh)

        # Core calculation: tCO₂ = kWh × EF / 1000
        total_tco2 = total_kwh * factor / 1000.0

        # Annualise if using a window
        if window_hours and data_window_days > 0:
            days_in_year = 365
            annualised_tco2 = total_tco2 * (days_in_year / data_window_days)
            annualised_kwh  = total_kwh  * (days_in_year / data_window_days)
        else:
            annualised_tco2 = total_tco2
            annualised_kwh  = total_kwh

        # ETS position
        ets_surplus_deficit = None
        ets_credit_cost_eur = None
        if free_alloc is not None:
            ets_surplus_deficit = free_alloc - total_tco2
            if ets_surplus_deficit < 0:
                ets_credit_cost_eur = abs(ets_surplus_deficit) * ETS_CARBON_PRICE_EUR

        # Benchmark comparison
        benchmark_value    = None
        actual_intensity   = None
        benchmark_gap      = None
        benchmark_gap_pct  = None
        enpi_kwh_per_unit  = None
        emissions_intensity = None

        if sector_code:
            bm = self.get_sector_benchmark(framework, sector_code, reporting_year)
            if bm:
                benchmark_value = float(bm.benchmark_value)

                if production_volume and production_volume > 0:
                    actual_intensity    = total_tco2 / production_volume
                    enpi_kwh_per_unit   = total_kwh  / production_volume
                    emissions_intensity = actual_intensity
                    benchmark_gap       = actual_intensity - benchmark_value
                    benchmark_gap_pct   = (benchmark_gap / benchmark_value * 100
                                           if benchmark_value > 0 else None)

        return EmissionsResult(
            organization_id        = organization_id,
            organization_name      = org.name,
            country_code           = country_code,
            framework              = framework,
            sector_code            = sector_code,
            reporting_year         = reporting_year,
            total_kwh              = round(total_kwh, 3),
            total_tco2             = round(total_tco2, 3),
            emission_factor_kg_co2_kwh = factor,
            energy_source          = energy_source,
            free_allocation_tonnes = free_alloc,
            ets_surplus_deficit    = round(ets_surplus_deficit, 3) if ets_surplus_deficit is not None else None,
            ets_credit_cost_eur    = round(ets_credit_cost_eur, 2) if ets_credit_cost_eur is not None else None,
            benchmark_value        = benchmark_value,
            production_volume      = production_volume,
            production_unit        = production_unit,
            actual_intensity       = round(actual_intensity, 6) if actual_intensity is not None else None,
            benchmark_gap          = round(benchmark_gap, 6) if benchmark_gap is not None else None,
            benchmark_gap_pct      = round(benchmark_gap_pct, 2) if benchmark_gap_pct is not None else None,
            enpi_kwh_per_unit      = round(enpi_kwh_per_unit, 3) if enpi_kwh_per_unit is not None else None,
            emissions_intensity    = round(emissions_intensity, 6) if emissions_intensity is not None else None,
            annualised_tco2        = round(annualised_tco2, 3),
            annualised_kwh         = round(annualised_kwh, 3),
            data_window_days       = data_window_days,
            data_points            = data_points,
            calculation_method     = FRAMEWORKS.get(framework, framework),
            factor_source          = ef.source_url,
        )


# ── Helper functions ───────────────────────────────────────────────────────────

def get_or_create_emissions_config(
    db: Session,
    organization_id: int,
) -> OrgEmissionsConfig:
    """Get existing config or create with Italian/EU defaults."""
    config = db.query(OrgEmissionsConfig).filter(
        OrgEmissionsConfig.organization_id == organization_id
    ).first()
    if not config:
        config = OrgEmissionsConfig(
            organization_id       = organization_id,
            country_code          = "ITA",
            framework             = "EU_ETS",
            primary_energy_source = "electricity",
        )
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def list_available_factors(db: Session, country_code: str = None) -> list:
    """List all available emission factors, optionally filtered by country."""
    q = db.query(EmissionFactor)
    if country_code:
        q = q.filter(EmissionFactor.country_code == country_code)
    return q.order_by(
        EmissionFactor.country_code,
        EmissionFactor.energy_source,
        EmissionFactor.valid_year.desc()
    ).all()