# backend/app/api/v1/sites.py
from __future__ import annotations

from typing import List, Optional, Set
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import get_current_user, get_org_context, OrgContext
from app.models import Site, User, TimeseriesRecord

# These are still coming from the shim in your repo. Leaving as-is to avoid regressions.
from app.db.models import SiteEvent, AlertEvent

router = APIRouter(prefix="/sites", tags=["sites"])
logger = logging.getLogger("cei")


def _canonical_site_key(site_db_id: int) -> str:
    """
    Canonical site_id used by TimeseriesRecord and ingest endpoints.

    We standardize on "site-<id>" everywhere.
    """
    return f"site-{site_db_id}"


def _timeseries_site_keys(site_db_id: int) -> Set[str]:
    """
    Timeseries keys we may need to match historically.
    Canonical is "site-<id>", but older data might have "<id>".
    """
    return {_canonical_site_key(site_db_id), str(site_db_id)}


def _org_id_from_ctx(ctx: OrgContext) -> Optional[int]:
    """
    Normalize org_id from either JWT user or integration token.

    Keep legacy behavior for dev/single-tenant:
      - If org_id is None AND auth_type == "user": treat as legacy and allow unscoped reads.
    For integration tokens:
      - org_id must exist; otherwise deny (integration tokens must always be org-scoped).
    """
    org_id = getattr(ctx, "organization_id", None)

    if org_id is None and getattr(ctx, "auth_type", "user") == "integration":
        # Integration tokens are explicitly org-scoped in this codebase.
        # If we ever see None here, it's a data/config issue; fail hard.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "INTEGRATION_TOKEN_NO_ORG",
                "message": "Integration token is not attached to an organization.",
            },
        )

    return org_id


class SiteBase(BaseModel):
    name: str
    location: Optional[str] = None


class SiteCreate(SiteBase):
    pass


class SiteRead(SiteBase):
    """
    API response model.

    - id: numeric DB id (legacy/backward compatible)
    - site_id: canonical string key used by timeseries ingestion ("site-<id>")
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    site_id: str


# IMPORTANT:
# We support BOTH "/sites" and "/sites/" to avoid Starlette's automatic 307 redirect.
# This fixes curl/axios behavior and removes the redirect hop.
@router.get("", response_model=List[SiteRead])
@router.get("/", response_model=List[SiteRead])
def list_sites(
    db: Session = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """
    List sites for the current org context.

    Supports BOTH:
      - User JWT (normal app usage)
      - Integration tokens (factory/pilot usage)

    Multi-tenant behavior:
    - If ctx.organization_id is set -> only return sites for that org.
    - If ctx.organization_id is None AND ctx.auth_type == "user"
        -> treat as single-tenant/dev and return all sites (legacy behavior).
    - If ctx.auth_type == "integration" and org_id is None -> 403 (should never happen).
    """
    org_id = _org_id_from_ctx(ctx)

    query = db.query(Site).order_by(Site.id.asc())
    if org_id is not None:
        query = query.filter(Site.org_id == org_id)

    sites = query.all()

    out: List[SiteRead] = []
    for s in sites:
        out.append(
            SiteRead(
                id=s.id,
                site_id=_canonical_site_key(s.id),
                name=getattr(s, "name", ""),
                location=getattr(s, "location", None),
            )
        )
    return out


@router.get("/{site_id}", response_model=SiteRead)
def get_site(
    site_id: int,
    db: Session = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """
    Fetch a single site by numeric DB id.

    Supports BOTH:
      - User JWT
      - Integration tokens

    Multi-tenant behavior:
    - If ctx.organization_id is set -> enforce Site.org_id == ctx.organization_id.
    - If ctx.organization_id is None AND ctx.auth_type == "user"
        -> fall back to legacy behavior (by id only).
    - If ctx.auth_type == "integration" and org_id is None -> 403 (should never happen).
    """
    org_id = _org_id_from_ctx(ctx)

    query = db.query(Site).filter(Site.id == site_id)
    if org_id is not None:
        query = query.filter(Site.org_id == org_id)

    site = query.first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    return SiteRead(
        id=site.id,
        site_id=_canonical_site_key(site.id),
        name=getattr(site, "name", ""),
        location=getattr(site, "location", None),
    )


@router.post("", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Create a site for the current user's organization.

    SECURITY:
    - JWT user only (NOT integration tokens)

    Multi-tenant behavior:
    - Requires user.organization_id; sites are always attached to an org.
    - If the user has no organization, we fail fast with 400.
    """
    org_id = getattr(user, "organization_id", None)
    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not attached to an organization; cannot create site.",
        )

    site = Site(
        org_id=org_id,
        name=payload.name,
        location=payload.location,
    )
    db.add(site)
    db.commit()
    db.refresh(site)

    return SiteRead(
        id=site.id,
        site_id=_canonical_site_key(site.id),
        name=site.name,
        location=site.location,
    )


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Hard-delete a site and all of its org-scoped footprint.

    SECURITY:
    - JWT user only (NOT integration tokens)

    Multi-tenant behavior:
    - If user.organization_id is set -> only allow deleting sites in that org.
    - If user.organization_id is None -> fall back to legacy behavior (by id only).

    Deletes:
    - Site row
    - TimeseriesRecord rows matching site_id keyspace ("site-<id>" and "<id>")
    - SiteEvent rows tied to this site keyspace
    - AlertEvent rows tied to this site keyspace
    """
    org_id = getattr(user, "organization_id", None)

    # 1) Resolve site row with org scoping
    site_query = db.query(Site).filter(Site.id == site_id)
    if org_id is not None:
        site_query = site_query.filter(Site.org_id == org_id)

    site = site_query.first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    timeseries_keys = _timeseries_site_keys(site.id)

    logger.info(
        "Deleting site %s (org_id=%s, keys=%s) with cascade",
        site.id,
        org_id,
        sorted(timeseries_keys),
    )

    # 2) Delete timeseries data for this site keyspace
    deleted_ts = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id.in_(timeseries_keys))
        .delete(synchronize_session=False)
    )

    # 3) Delete alert history/workflow rows tied to this site
    alert_q = db.query(AlertEvent).filter(AlertEvent.site_id.in_(timeseries_keys))
    if org_id is not None and hasattr(AlertEvent, "organization_id"):
        alert_q = alert_q.filter(AlertEvent.organization_id == org_id)
    deleted_alerts = alert_q.delete(synchronize_session=False)

    # 4) Delete site timeline events tied to this site
    se_q = db.query(SiteEvent).filter(SiteEvent.site_id.in_(timeseries_keys))
    if org_id is not None and hasattr(SiteEvent, "organization_id"):
        se_q = se_q.filter(SiteEvent.organization_id == org_id)
    deleted_site_events = se_q.delete(synchronize_session=False)

    # 5) Delete site row
    db.delete(site)
    db.commit()

    logger.info(
        "Deleted site %s cascade complete: timeseries=%s, alert_events=%s, site_events=%s",
        site_id,
        deleted_ts,
        deleted_alerts,
        deleted_site_events,
    )
    return

# ── Site config schemas ────────────────────────────────────────────────────────

class SiteConfigIn(BaseModel):
    electricity_price_per_kwh:  Optional[float] = None
    gas_price_per_kwh:          Optional[float] = None
    currency_code:              Optional[str]   = None
    country_code:               Optional[str]   = None
    framework:                  Optional[str]   = None
    sector_code:                Optional[str]   = None
    primary_energy_source:      Optional[str]   = None
    secondary_energy_source:    Optional[str]   = None
    annual_production_volume:   Optional[float] = None
    production_unit:            Optional[str]   = None
    free_allocation_tonnes:     Optional[float] = None
    reporting_year:             Optional[int]   = None


class SiteConfigOut(BaseModel):
    site_id:                    int
    site_name:                  str
    electricity_price_per_kwh:  Optional[float]
    gas_price_per_kwh:          Optional[float]
    currency_code:              Optional[str]
    country_code:               Optional[str]
    framework:                  Optional[str]
    sector_code:                Optional[str]
    primary_energy_source:      Optional[str]
    secondary_energy_source:    Optional[str]
    annual_production_volume:   Optional[float]
    production_unit:            Optional[str]
    free_allocation_tonnes:     Optional[float]
    reporting_year:             Optional[int]
    config_updated_at:          Optional[str]

    model_config = ConfigDict(from_attributes=True)


@router.get("/{site_id}/config", response_model=SiteConfigOut)
def get_site_config(
    site_id: int,
    db: Session = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """Get energy and emissions config for a site."""
    org_id = _org_id_from_ctx(ctx)
    q = db.query(Site).filter(Site.id == site_id)
    if org_id:
        q = q.filter(Site.org_id == org_id)
    site = q.first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    return SiteConfigOut(
        site_id                   = site.id,
        site_name                 = site.name,
        electricity_price_per_kwh = float(site.electricity_price_per_kwh) if site.electricity_price_per_kwh else None,
        gas_price_per_kwh         = float(site.gas_price_per_kwh)         if site.gas_price_per_kwh         else None,
        currency_code             = site.currency_code,
        country_code              = site.country_code,
        framework                 = site.framework,
        sector_code               = site.sector_code,
        primary_energy_source     = site.primary_energy_source,
        secondary_energy_source   = site.secondary_energy_source,
        annual_production_volume  = float(site.annual_production_volume)  if site.annual_production_volume  else None,
        production_unit           = site.production_unit,
        free_allocation_tonnes    = float(site.free_allocation_tonnes)    if site.free_allocation_tonnes    else None,
        reporting_year            = site.reporting_year,
        config_updated_at         = site.config_updated_at.isoformat() if site.config_updated_at else None,
    )


@router.patch("/{site_id}/config", response_model=SiteConfigOut)
def update_site_config(
    site_id: int,
    body: SiteConfigIn,
    db: Session = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """Update energy and emissions config for a site."""
    from datetime import datetime, timezone
    org_id = _org_id_from_ctx(ctx)
    q = db.query(Site).filter(Site.id == site_id)
    if org_id:
        q = q.filter(Site.org_id == org_id)
    site = q.first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    if body.electricity_price_per_kwh  is not None: site.electricity_price_per_kwh  = body.electricity_price_per_kwh
    if body.gas_price_per_kwh          is not None: site.gas_price_per_kwh          = body.gas_price_per_kwh
    if body.currency_code              is not None: site.currency_code              = body.currency_code.upper()
    if body.country_code               is not None: site.country_code               = body.country_code.upper()
    if body.framework                  is not None: site.framework                  = body.framework.upper()
    if body.sector_code                is not None: site.sector_code                = body.sector_code.lower()
    if body.primary_energy_source      is not None: site.primary_energy_source      = body.primary_energy_source.lower()
    if body.secondary_energy_source    is not None: site.secondary_energy_source    = body.secondary_energy_source.lower()
    if body.annual_production_volume   is not None: site.annual_production_volume   = body.annual_production_volume
    if body.production_unit            is not None: site.production_unit            = body.production_unit
    if body.free_allocation_tonnes     is not None: site.free_allocation_tonnes     = body.free_allocation_tonnes
    if body.reporting_year             is not None: site.reporting_year             = body.reporting_year
    site.config_updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(site)

    return SiteConfigOut(
        site_id                   = site.id,
        site_name                 = site.name,
        electricity_price_per_kwh = float(site.electricity_price_per_kwh) if site.electricity_price_per_kwh else None,
        gas_price_per_kwh         = float(site.gas_price_per_kwh)         if site.gas_price_per_kwh         else None,
        currency_code             = site.currency_code,
        country_code              = site.country_code,
        framework                 = site.framework,
        sector_code               = site.sector_code,
        primary_energy_source     = site.primary_energy_source,
        secondary_energy_source   = site.secondary_energy_source,
        annual_production_volume  = float(site.annual_production_volume)  if site.annual_production_volume  else None,
        production_unit           = site.production_unit,
        free_allocation_tonnes    = float(site.free_allocation_tonnes)    if site.free_allocation_tonnes    else None,
        reporting_year            = site.reporting_year,
        config_updated_at         = site.config_updated_at.isoformat() if site.config_updated_at else None,
    )