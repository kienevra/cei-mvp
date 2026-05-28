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
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models import (
    User, Organization, OrgEmissionsConfig,
    EmissionFactor, SectorBenchmark,
    Site, TimeseriesRecord,
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
    cbam_confidence:           str   # none | low | medium | high
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
@router.get(
    "/calculate/site/{site_id}",
    response_model=EmissionsResultOut,
    summary="Calculate CO₂ emissions for a single site",
)
def calculate_site_emissions(
    site_id:      int,
    window_hours: int = 168,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Calculate CO₂ emissions for a single site using site-level config.
    Falls back to org-level config then defaults.
    """
    from app.models import Site as SiteModel
    site = db.query(SiteModel).filter(SiteModel.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    user_org_id = current_user.organization_id
    if site.org_id != user_org_id:
        client_org = db.query(Organization).filter(
            Organization.id == site.org_id,
            Organization.managed_by_org_id == user_org_id,
        ).first()
        if not client_org:
            raise HTTPException(status_code=403, detail="Not authorized to access this site.")

    calc   = EmissionsCalculator(db)
    result = calc.calculate_for_site(site_id=site_id, window_hours=window_hours)

    if not result:
        raise HTTPException(
            status_code=422,
            detail="Unable to calculate emissions. Check site config and timeseries data.",
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
        cbam_confidence            = result.cbam_confidence,
        calculated_at              = result.calculated_at.isoformat(),
    )

# ─────────────────────────────────────────────────────────────────────────────
# MRV Report helpers
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_timeseries_for_period(
    db: Session,
    site_id: int,
    period_start: date,
    period_end: date,
) -> dict:
    start_dt = datetime.combine(period_start, datetime.min.time())
    end_dt   = datetime.combine(period_end,   datetime.min.time())

    records = (
        db.query(TimeseriesRecord)
        .filter(
            TimeseriesRecord.site_id.in_([str(site_id), f"site-{site_id}"]),
            TimeseriesRecord.timestamp >= start_dt,
            TimeseriesRecord.timestamp <  end_dt,
        )
        .order_by(TimeseriesRecord.timestamp)
        .all()
    )

    monthly: dict = defaultdict(float)
    for rec in records:
        key = rec.timestamp.strftime("%Y-%m")
        monthly[key] += float(rec.value or 0)

    sorted_keys    = sorted(monthly.keys())
    monthly_labels = [datetime.strptime(k, "%Y-%m").strftime("%b %Y") for k in sorted_keys]
    monthly_kwh    = [monthly[k] for k in sorted_keys]

    return {
        "total_kwh":      sum(monthly_kwh),
        "monthly_labels": monthly_labels,
        "monthly_kwh":    monthly_kwh,
    }

@router.get("/mrv-report/{site_id}", summary="Generate MRV Declaration PDF")
async def get_mrv_report(
    site_id: int,
    period_start: date  = Query(..., description="Period start date, e.g. 2026-01-01"),
    period_end: date    = Query(..., description="Period end date,   e.g. 2026-03-31"),
    quarter: int | None = Query(None, ge=1, le=4),
    consultant_name: str = Query(""),
    consultant_org:  str = Query(""),
    consultant_role: str = Query("Certified Energy Manager"),
    lang: str            = Query("en", description="Language: en or it"),
    db: Session          = Depends(get_db),
    current_user         = Depends(get_current_active_user),
):
    # 1. Load site
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    site_org = site.organization
    is_owner   = site_org.id == current_user.organization_id
    is_manager = site_org.managed_by_org_id == current_user.organization_id
    if not (is_owner or is_manager):
        raise HTTPException(status_code=403, detail="Access denied")
    # Soft lock check — compliance docs are read-only for locked orgs
    from app.api.deps import check_soft_lock
    check_soft_lock(site_org, method="POST")
    # 2. Aggregate timeseries
    ts = _aggregate_timeseries_for_period(db, site_id, period_start, period_end)
    if ts["total_kwh"] == 0:
        raise HTTPException(
            status_code=422,
            detail="No energy data found for the requested period.",
        )

    # 3. Resolve emission factor
    calculator = EmissionsCalculator(db)
    country    = getattr(site, "country_code", "IT")
    framework  = getattr(site, "framework",    "EU_ETS")
    ef_record  = calculator.get_emission_factor(country, "electricity", period_start.year, framework)

    ef_value  = float(ef_record.factor_kg_co2_kwh) if ef_record else 0.280
    ef_source = (
        f"{ef_record.country_code} {ef_record.framework} {ef_record.valid_year}"
        if ef_record else "ISPRA 2024 (default)"
    )
    ef_year = ef_record.valid_year if ef_record else 2024

    # 4. Calculate emissions
    total_tco2    = ts["total_kwh"] * ef_value / 1000
    monthly_tco2  = [kwh * ef_value / 1000 for kwh in ts["monthly_kwh"]]

    production_vol  = float(getattr(site, "annual_production_volume", 0) or 0)
    production_unit = getattr(site, "production_unit", "tonnes") or "tonnes"
    period_days     = (period_end - period_start).days or 1
    period_fraction = period_days / 365.0
    period_prod     = production_vol * period_fraction
    tco2_per_tonne  = total_tco2 / period_prod if period_prod > 0 else 0.0

    free_alloc  = float(getattr(site, "free_allocation_tonnes", None) or 0) or None
    ets_surplus = ((free_alloc * period_fraction) - total_tco2) if free_alloc else None

    # 5. Build data dict
    data = {
        "site_name":          site.name,
        "site_address":       getattr(site, "address", None),
        "country_code":       country,
        "framework":          framework,
        "sector_code":        getattr(site, "sector_code", "manufacturing"),
        "installation_id":    site.id,
        "period_start":       str(period_start),
        "period_end":         str(period_end),
        "reporting_year":     period_start.year,
        "quarter":            quarter,
        "production_volume":  round(period_prod, 2),
        "production_unit":    production_unit,
        "total_kwh":          round(ts["total_kwh"], 2),
        "electricity_kwh":    round(ts["total_kwh"], 2),
        "gas_kwh":            0.0,
        "primary_energy_source": getattr(site, "primary_energy_source", "electricity"),
        "emission_factor_value":  ef_value,
        "emission_factor_source": ef_source,
        "emission_factor_year":   ef_year,
        "methodology_tier":       "Tier 2 — Calculation-based",
        "total_tco2":             round(total_tco2, 4),
        "tco2_per_tonne":         round(tco2_per_tonne, 6),
        "monthly_labels":         ts["monthly_labels"],
        "monthly_kwh":            [round(v, 2) for v in ts["monthly_kwh"]],
        "monthly_tco2":           [round(v, 4) for v in monthly_tco2],
        "free_allocation_tonnes": round(free_alloc * period_fraction, 2) if free_alloc else None,
        "ets_surplus_deficit":    round(ets_surplus, 4) if ets_surplus is not None else None,
        "consultant_name":        consultant_name or current_user.email,
        "consultant_org":         consultant_org  or getattr(current_user.organization, "name", "CEI Platform"),
        "consultant_role":        consultant_role,
        "report_date":            datetime.utcnow().strftime("%d %b %Y"),
    }

    # 6. Generate and stream PDF
    from app.services.pdf.mrv_report import generate_mrv_pdf
    pdf_buf  = generate_mrv_pdf(data, lang=lang)
    q_suffix = f"Q{quarter}_" if quarter else ""
    filename = f"CEI_MRV_{site.name.replace(' ', '_')}_{q_suffix}{period_start.year}.pdf"

    return StreamingResponse(
        pdf_buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.get("/ets-statement/{org_id}", summary="Generate ETS Position Statement PDF")
async def get_ets_statement(
    org_id: int,
    year: int            = Query(..., description="Reporting year, e.g. 2026"),
    lang: str            = Query("en", description="Language: en or it"),
    consultant_role: str = Query("Certified Energy Manager"),
    db: Session          = Depends(get_db),
    current_user         = Depends(get_current_active_user),
):
    from app.services.pdf.ets_statement import generate_ets_pdf, _build_ets_schedule

    # 1. Verify org access
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")

    is_owner   = org.id == current_user.organization_id
    is_manager = org.managed_by_org_id == current_user.organization_id
    if not (is_owner or is_manager):
        raise HTTPException(status_code=403, detail="Access denied")
    from app.api.deps import check_soft_lock
    check_soft_lock(org, method="POST")
    # 2. Load all sites for this org
    sites = db.query(Site).filter(Site.org_id == org_id).all()
    if not sites:
        raise HTTPException(status_code=422, detail="No sites found for this organisation.")

    # 3. Aggregate timeseries for the full year across all sites
    period_start = date(year, 1, 1)
    period_end   = date(year, 12, 31)

    calculator     = EmissionsCalculator(db)
    total_kwh      = 0.0
    total_tco2     = 0.0
    total_alloc    = 0.0
    monthly_totals: dict = defaultdict(float)
    sites_summary  = []

    for site in sites:
        ts = _aggregate_timeseries_for_period(db, site.id, period_start, period_end)
        if ts["total_kwh"] == 0:
            continue

        country   = getattr(site, "country_code", "IT")
        framework = getattr(site, "framework",    "EU_ETS")
        ef_record = calculator.get_emission_factor(country, "electricity", year, framework)
        ef_value  = float(ef_record.factor_kg_co2_kwh) if ef_record else 0.280

        site_tco2 = ts["total_kwh"] * ef_value / 1000
        site_alloc = float(getattr(site, "free_allocation_tonnes", None) or 0)

        total_kwh   += ts["total_kwh"]
        total_tco2  += site_tco2
        total_alloc += site_alloc

        for lbl, kwh in zip(ts["monthly_labels"], ts["monthly_kwh"]):
            monthly_totals[lbl] += kwh * ef_value / 1000

        sites_summary.append({
            "site_name":  site.name,
            "total_kwh":  round(ts["total_kwh"], 2),
            "total_tco2": round(site_tco2, 4),
            "free_alloc": round(site_alloc, 2) if site_alloc else None,
        })

    if total_kwh == 0:
        raise HTTPException(
            status_code=422,
            detail=f"No energy data found for {year}. Check that timeseries records exist.",
        )

    surplus        = total_alloc - total_tco2
    carbon_price   = ETS_CARBON_PRICE_EUR
    financial_impact = abs(surplus) * carbon_price

    # 4. Benchmark from org config
    org_config     = get_or_create_emissions_config(db, org_id)
    sector_code    = org_config.sector_code or "ceramics"
    framework      = org_config.framework   or "EU_ETS"
    production_vol = float(org_config.annual_production_volume or 0)
    production_unit = org_config.production_unit or "tonne"

    benchmark = calculator.get_sector_benchmark(sector_code, framework, year)
    bmark_val  = float(benchmark.benchmark_value) if benchmark else None
    actual_int = total_tco2 / production_vol if production_vol > 0 else None
    gap_pct    = ((actual_int - bmark_val) / bmark_val * 100) if (bmark_val and actual_int) else None

    # 5. Monthly labels + tco2
    sorted_months  = sorted(
        monthly_totals.keys(),
        key=lambda x: datetime.strptime(x, "%b %Y")
    )
    monthly_labels = sorted_months
    monthly_tco2   = [round(monthly_totals[m], 4) for m in sorted_months]

    # 6. ETS schedule
    ets_schedule = _build_ets_schedule(
        free_allocation=total_alloc,
        reporting_year=year,
    )

    # 7. Build data dict
    data = {
        "org_name":               org.name,
        "org_id":                 org_id,
        "country_code":           org_config.country_code or "IT",
        "framework":              framework,
        "sector_code":            sector_code,
        "reporting_year":         year,
        "sites":                  sites_summary,
        "total_kwh":              round(total_kwh, 2),
        "total_tco2":             round(total_tco2, 4),
        "free_allocation_tonnes": round(total_alloc, 2),
        "surplus_deficit":        round(surplus, 4),
        "ets_carbon_price":       carbon_price,
        "financial_impact_eur":   round(financial_impact, 2),
        "benchmark_value":        bmark_val,
        "production_volume":      production_vol,
        "production_unit":        production_unit,
        "actual_intensity":       round(actual_int, 6) if actual_int else None,
        "benchmark_gap_pct":      round(gap_pct, 2) if gap_pct is not None else None,
        "monthly_labels":         monthly_labels,
        "monthly_tco2":           monthly_tco2,
        "ets_schedule":           ets_schedule,
        "consultant_role":        consultant_role,
        "report_date":            datetime.utcnow().strftime("%d %b %Y"),
    }

    # 8. Generate and stream PDF
    pdf_buf  = generate_ets_pdf(data, lang=lang)
    filename = f"CEI_ETS_{org.name.replace(' ', '_')}_{year}.pdf"

    return StreamingResponse(
        pdf_buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.get("/enpi-report/{site_id}", summary="Generate EnPI Baseline Report PDF")
async def get_enpi_report(
    site_id: int,
    baseline_start: date = Query(..., description="Baseline start, e.g. 2025-03-01"),
    baseline_end:   date = Query(..., description="Baseline end,   e.g. 2026-02-28"),
    current_start:  date = Query(..., description="Current start,  e.g. 2026-02-20"),
    current_end:    date = Query(..., description="Current end,    e.g. 2026-05-20"),
    lang: str            = Query("en"),
    consultant_role: str = Query("Certified Energy Manager"),
    db: Session          = Depends(get_db),
    current_user         = Depends(get_current_active_user),
):
    from app.services.pdf.enpi_report import generate_enpi_pdf, compute_r_squared

    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    site_org   = site.organization
    is_owner   = site_org.id == current_user.organization_id
    is_manager = site_org.managed_by_org_id == current_user.organization_id
    if not (is_owner or is_manager):
        raise HTTPException(status_code=403, detail="Access denied")
    from app.api.deps import check_soft_lock
    check_soft_lock(site_org, method="POST")
    calculator = EmissionsCalculator(db)
    country    = getattr(site, "country_code", None) or "ITA"
    framework  = getattr(site, "framework",    None) or "EU_ETS"
    ef_record  = calculator.get_emission_factor(country, "electricity", current_start.year, framework)
    ef_value   = float(ef_record.factor_kg_co2_kwh) if ef_record else 0.280
    ef_source  = f"{ef_record.country_code} {ef_record.framework} {ef_record.valid_year}" if ef_record else "ISPRA 2024"

    b_ts = _aggregate_timeseries_for_period(db, site_id, baseline_start, baseline_end)
    c_ts = _aggregate_timeseries_for_period(db, site_id, current_start,  current_end)

    if b_ts["total_kwh"] == 0 and c_ts["total_kwh"] == 0:
        raise HTTPException(status_code=422, detail="No energy data found for either period.")

    prod_vol  = float(getattr(site, "annual_production_volume", 0) or 0)
    prod_unit = getattr(site, "production_unit", "tonne") or "tonne"

    b_days = (baseline_end - baseline_start).days or 1
    c_days = (current_end  - current_start).days  or 1
    b_prod = prod_vol * (b_days / 365)
    c_prod = prod_vol * (c_days / 365)

    b_enpi = b_ts["total_kwh"] / b_prod if b_prod > 0 else 0
    c_enpi = c_ts["total_kwh"] / c_prod if c_prod > 0 else 0
    chg    = (c_enpi - b_enpi) / b_enpi * 100 if b_enpi > 0 else 0

    r2, slope, p_value = compute_r_squared(c_ts["monthly_kwh"])

    data = {
        "site_name":          site.name,
        "site_address":       getattr(site, "address", None),
        "country_code":       country,
        "sector_code":        getattr(site, "sector_code", "manufacturing"),
        "installation_id":    site.id,
        "baseline_start":     str(baseline_start),
        "baseline_end":       str(baseline_end),
        "current_start":      str(current_start),
        "current_end":        str(current_end),
        "production_volume":  prod_vol,
        "production_unit":    prod_unit,
        "baseline_kwh":       round(b_ts["total_kwh"], 2),
        "baseline_tco2":      round(b_ts["total_kwh"] * ef_value / 1000, 4),
        "baseline_enpi":      round(b_enpi, 3),
        "baseline_months":    b_ts["monthly_labels"],
        "baseline_monthly_kwh": [round(v, 2) for v in b_ts["monthly_kwh"]],
        "current_kwh":        round(c_ts["total_kwh"], 2),
        "current_tco2":       round(c_ts["total_kwh"] * ef_value / 1000, 4),
        "current_enpi":       round(c_enpi, 3),
        "current_months":     c_ts["monthly_labels"],
        "current_monthly_kwh": [round(v, 2) for v in c_ts["monthly_kwh"]],
        "enpi_change_pct":    round(chg, 2),
        "r_squared":          r2,
        "trend_slope":        slope,
        "ef_value":           ef_value,
        "ef_source":          ef_source,
        "consultant_role":    consultant_role,
        "report_date":        datetime.utcnow().strftime("%d %b %Y"),
    }

    pdf_buf  = generate_enpi_pdf(data, lang=lang)
    filename = f"CEI_EnPI_{site.name.replace(' ', '_')}_{current_end.year}.pdf"
    return StreamingResponse(
        pdf_buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )