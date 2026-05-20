# backend/app/api/v1/emissions.py
"""
Emissions API
=============
Endpoints for emissions configuration and calculations.
Used by consultant dashboard to configure client org emissions settings
and retrieve CO₂ figures aligned with EU ETS, CBAM, ISO 14064, VCS.
"""
from __future__ import annotations

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models import (
    User, Organization, OrgEmissionsConfig,
    EmissionFactor, SectorBenchmark,
)
from app.services.emissions import (
    EmissionsCalculator,
    get_or_create_emissions_config,
    FRAMEWORKS, ENERGY_SOURCES, SECTORS,
    ETS_CARBON_PRICE_EUR,
)

logger = logging.getLogger("cei")
router = APIRouter(prefix="/emissions", tags=["emissions"])


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class EmissionsConfigIn(BaseModel):
    country_code:              Optional[str]   = None  # ISO 3166-1 alpha-3
    framework:                 Optional[str]   = None  # EU_ETS, CBAM, VCS, etc.
    sector_code:               Optional[str]   = None
    primary_energy_source:     Optional[str]   = None
    secondary_energy_source:   Optional[str]   = None
    annual_production_volume:  Optional[float] = None
    production_unit:           Optional[str]   = None
    reporting_year:            Optional[int]   = None
    free_allocation_tonnes:    Optional[float] = None


class EmissionsConfigOut(BaseModel):
    organization_id:           int
    country_code:              str
    framework:                 str
    sector_code:               Optional[str]
    primary_energy_source:     str
    secondary_energy_source:   Optional[str]
    annual_production_volume:  Optional[float]
    production_unit:           Optional[str]
    reporting_year:            Optional[int]
    free_allocation_tonnes:    Optional[float]
    framework_label:           Optional[str]   = None

    class Config:
        from_attributes = True


class EmissionsResultOut(BaseModel):
    organization_id:           int
    organization_name:         str
    country_code:              str
    framework:                 str
    framework_label:           str
    sector_code:               Optional[str]
    reporting_year:            int
    energy_source:             str

    # Core
    total_kwh:                 float
    total_tco2:                float
    emission_factor_kg_co2_kwh: float

    # Annualised
    annualised_tco2:           float
    annualised_kwh:            float

    # ETS position
    free_allocation_tonnes:    Optional[float]
    ets_surplus_deficit:       Optional[float]
    ets_credit_cost_eur:       Optional[float]
    ets_position_label:        str

    # Benchmark
    benchmark_value:           Optional[float]
    production_volume:         Optional[float]
    production_unit:           Optional[str]
    actual_intensity:          Optional[float]
    benchmark_gap:             Optional[float]
    benchmark_gap_pct:         Optional[float]
    benchmark_position_label:  str

    # EnPI
    enpi_kwh_per_unit:         Optional[float]
    emissions_intensity:       Optional[float]

    # Data quality
    data_window_days:          int
    data_points:               int
    calculation_method:        str
    factor_source:             Optional[str]
    is_cbam_ready:             bool
    calculated_at:             str


class EmissionFactorOut(BaseModel):
    id:                int
    country_code:      str
    region_code:       Optional[str]
    energy_source:     str
    factor_kg_co2_kwh: float
    valid_year:        int
    framework:         str
    notes:             Optional[str]

    class Config:
        from_attributes = True


class SectorBenchmarkOut(BaseModel):
    id:                 int
    framework:          str
    sector_code:        str
    benchmark_value:    float
    product_unit:       str
    valid_from_year:    int
    reduction_rate_pct: Optional[float]
    notes:              Optional[str]

    class Config:
        from_attributes = True


class FrameworksOut(BaseModel):
    frameworks:     dict
    energy_sources: list
    sectors:        list
    countries:      list
    ets_carbon_price_eur: float


# ── Helper: resolve org from request (supports X-CEI-ORG-ID delegation) ───────

def _resolve_org_id(
    request_org_id: Optional[int],
    current_user: User,
    db: Session,
) -> int:
    """
    If request_org_id is provided (consultant delegating to client),
    verify the current user's org manages that org.
    Otherwise use current user's org.
    """
    if request_org_id:
        managing_org_id = current_user.organization_id
        client_org = db.query(Organization).filter(
            Organization.id == request_org_id,
            Organization.managed_by_org_id == managing_org_id,
        ).first()
        if not client_org:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access this organization's emissions data.",
            )
        return request_org_id
    return current_user.organization_id


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get(
    "/frameworks",
    response_model=FrameworksOut,
    summary="List supported frameworks, energy sources, sectors and countries",
)
def list_frameworks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Returns all supported regulatory frameworks, energy sources, sectors and
    countries available in the emission factors database."""
    countries = [
        row[0] for row in
        db.query(EmissionFactor.country_code).distinct().order_by(
            EmissionFactor.country_code
        ).all()
    ]
    return FrameworksOut(
        frameworks=FRAMEWORKS,
        energy_sources=ENERGY_SOURCES,
        sectors=SECTORS,
        countries=countries,
        ets_carbon_price_eur=ETS_CARBON_PRICE_EUR,
    )


@router.get(
    "/factors",
    response_model=List[EmissionFactorOut],
    summary="List emission factors",
)
def list_emission_factors(
    country_code: Optional[str] = None,
    framework:    Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List available emission factors, optionally filtered by country and framework."""
    q = db.query(EmissionFactor)
    if country_code:
        q = q.filter(EmissionFactor.country_code == country_code.upper())
    if framework:
        q = q.filter(EmissionFactor.framework == framework.upper())
    return q.order_by(
        EmissionFactor.country_code,
        EmissionFactor.energy_source,
        EmissionFactor.valid_year.desc(),
    ).all()


@router.get(
    "/benchmarks",
    response_model=List[SectorBenchmarkOut],
    summary="List sector benchmarks",
)
def list_sector_benchmarks(
    framework:   Optional[str] = None,
    sector_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List sector benchmarks, optionally filtered by framework and sector."""
    q = db.query(SectorBenchmark)
    if framework:
        q = q.filter(SectorBenchmark.framework == framework.upper())
    if sector_code:
        q = q.filter(SectorBenchmark.sector_code == sector_code.lower())
    return q.order_by(
        SectorBenchmark.framework,
        SectorBenchmark.sector_code,
        SectorBenchmark.valid_from_year.desc(),
    ).all()


@router.get(
    "/config",
    response_model=EmissionsConfigOut,
    summary="Get emissions config for current or delegated org",
)
def get_emissions_config(
    org_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get emissions configuration. Pass org_id to access a managed client org."""
    target_org_id = _resolve_org_id(org_id, current_user, db)
    config = get_or_create_emissions_config(db, target_org_id)
    out = EmissionsConfigOut(
        organization_id          = config.organization_id,
        country_code             = config.country_code,
        framework                = config.framework,
        sector_code              = config.sector_code,
        primary_energy_source    = config.primary_energy_source,
        secondary_energy_source  = config.secondary_energy_source,
        annual_production_volume = float(config.annual_production_volume) if config.annual_production_volume else None,
        production_unit          = config.production_unit,
        reporting_year           = config.reporting_year,
        free_allocation_tonnes   = float(config.free_allocation_tonnes) if config.free_allocation_tonnes else None,
        framework_label          = FRAMEWORKS.get(config.framework),
    )
    return out


@router.put(
    "/config",
    response_model=EmissionsConfigOut,
    summary="Update emissions config for current or delegated org",
)
def update_emissions_config(
    body: EmissionsConfigIn,
    org_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update emissions configuration. Consultant can update client org by passing org_id."""
    target_org_id = _resolve_org_id(org_id, current_user, db)
    config = get_or_create_emissions_config(db, target_org_id)

    if body.country_code is not None:
        config.country_code = body.country_code.upper()
    if body.framework is not None:
        config.framework = body.framework.upper()
    if body.sector_code is not None:
        config.sector_code = body.sector_code.lower()
    if body.primary_energy_source is not None:
        config.primary_energy_source = body.primary_energy_source.lower()
    if body.secondary_energy_source is not None:
        config.secondary_energy_source = body.secondary_energy_source.lower()
    if body.annual_production_volume is not None:
        config.annual_production_volume = body.annual_production_volume
    if body.production_unit is not None:
        config.production_unit = body.production_unit
    if body.reporting_year is not None:
        config.reporting_year = body.reporting_year
    if body.free_allocation_tonnes is not None:
        config.free_allocation_tonnes = body.free_allocation_tonnes

    db.commit()
    db.refresh(config)

    return EmissionsConfigOut(
        organization_id          = config.organization_id,
        country_code             = config.country_code,
        framework                = config.framework,
        sector_code              = config.sector_code,
        primary_energy_source    = config.primary_energy_source,
        secondary_energy_source  = config.secondary_energy_source,
        annual_production_volume = float(config.annual_production_volume) if config.annual_production_volume else None,
        production_unit          = config.production_unit,
        reporting_year           = config.reporting_year,
        free_allocation_tonnes   = float(config.free_allocation_tonnes) if config.free_allocation_tonnes else None,
        framework_label          = FRAMEWORKS.get(config.framework),
    )


@router.get(
    "/calculate",
    response_model=EmissionsResultOut,
    summary="Calculate CO₂ emissions for current or delegated org",
)
def calculate_emissions(
    org_id:       Optional[int] = None,
    window_hours: int = 168,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Calculate CO₂ emissions using official methodology.
    - window_hours: lookback window (168 = 7 days, 720 = 30 days, 8760 = 1 year)
    - org_id: pass to calculate for a managed client org
    """
    target_org_id = _resolve_org_id(org_id, current_user, db)
    calc   = EmissionsCalculator(db)
    result = calc.calculate(organization_id=target_org_id, window_hours=window_hours)

    if not result:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unable to calculate emissions. Check that emission factors exist for this country/framework and that timeseries data is available.",
        )

    return EmissionsResultOut(
        organization_id            = result.organization_id,
        organization_name          = result.organization_name,
        country_code               = result.country_code,
        framework                  = result.framework,
        framework_label            = result.calculation_method,
        sector_code                = result.sector_code,
        reporting_year             = result.reporting_year,
        energy_source              = result.energy_source,
        total_kwh                  = result.total_kwh,
        total_tco2                 = result.total_tco2,
        emission_factor_kg_co2_kwh = result.emission_factor_kg_co2_kwh,
        annualised_tco2            = result.annualised_tco2,
        annualised_kwh             = result.annualised_kwh,
        free_allocation_tonnes     = result.free_allocation_tonnes,
        ets_surplus_deficit        = result.ets_surplus_deficit,
        ets_credit_cost_eur        = result.ets_credit_cost_eur,
        ets_position_label         = result.ets_position_label,
        benchmark_value            = result.benchmark_value,
        production_volume          = result.production_volume,
        production_unit            = result.production_unit,
        actual_intensity           = result.actual_intensity,
        benchmark_gap              = result.benchmark_gap,
        benchmark_gap_pct          = result.benchmark_gap_pct,
        benchmark_position_label   = result.benchmark_position_label,
        enpi_kwh_per_unit          = result.enpi_kwh_per_unit,
        emissions_intensity        = result.emissions_intensity,
        data_window_days           = result.data_window_days,
        data_points                = result.data_points,
        calculation_method         = result.calculation_method,
        factor_source              = result.factor_source,
        is_cbam_ready              = result.is_cbam_ready,
        calculated_at              = result.calculated_at.isoformat(),
    )