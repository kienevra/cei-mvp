# backend/app/api/v1/manage.py
"""
Phase 3 + Phase 4 — Managing Org CRUD API + Portfolio Dashboard

All endpoints in this router require:
  1. A valid JWT or integration token (standard CEI auth)
  2. The authenticated org must have org_type == "managing"

Phase 3 endpoints (/manage/client-orgs/...):
  Client org lifecycle:
    GET    /manage/client-orgs                                      → list all client orgs
    POST   /manage/client-orgs                                      → create a client org
    GET    /manage/client-orgs/{client_org_id}                      → get a single client org
    DELETE /manage/client-orgs/{client_org_id}                      → delete a client org

  Site management (within a client org):
    GET    /manage/client-orgs/{client_org_id}/sites                → list sites
    POST   /manage/client-orgs/{client_org_id}/sites                → create a site
    DELETE /manage/client-orgs/{client_org_id}/sites/{site_id}      → delete a site

  Ghost pricing:
    PATCH  /manage/client-orgs/{client_org_id}/pricing              → set pricing config

  Integration tokens:
    GET    /manage/client-orgs/{client_org_id}/integration-tokens
    POST   /manage/client-orgs/{client_org_id}/integration-tokens
    DELETE /manage/client-orgs/{client_org_id}/integration-tokens/{token_id}

  Users (read-only):
    GET    /manage/client-orgs/{client_org_id}/users

Phase 4 endpoints (/manage/portfolio/...):
    GET    /manage/portfolio                            → full portfolio summary
    GET    /manage/portfolio/analytics                  → aggregated + per-client KPIs
    GET    /manage/client-orgs/{client_org_id}/report   → per-client detailed report
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import (
    create_org_audit_event,
    require_managing_org_dep,
)
from app.core.security import OrgContext, get_org_context
from app.db.session import get_db
from app.models import (
    AlertEvent,
    IntegrationToken,
    Organization,
    Site,
    SiteEvent,
    TimeseriesRecord,
    User,
)

router = APIRouter(prefix="/manage", tags=["manage"])

# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

INTEGRATION_TOKEN_PREFIX = "cei_int_"


def _generate_integration_token() -> str:
    return INTEGRATION_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Phase 3 Schemas
# ---------------------------------------------------------------------------

class ClientOrgCreateIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    primary_energy_sources: Optional[str] = Field(default=None)
    electricity_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    gas_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    currency_code: Optional[str] = Field(default=None, max_length=8)
    model_config = {"extra": "forbid"}


class ClientOrgOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    org_type: str
    managed_by_org_id: Optional[int] = None
    client_limit: Optional[int] = None
    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None
    plan_key: Optional[str] = None
    subscription_status: Optional[str] = None
    created_at: Optional[datetime] = None


class ClientOrgSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    org_type: str
    managed_by_org_id: Optional[int] = None
    primary_energy_sources: Optional[str] = None
    currency_code: Optional[str] = None
    created_at: Optional[datetime] = None


class SiteCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    location: Optional[str] = Field(default=None, max_length=255)
    model_config = {"extra": "forbid"}


class SiteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    location: Optional[str] = None
    org_id: Optional[int] = None
    site_id: Optional[str] = None
    created_at: Optional[datetime] = None


class PricingUpdateIn(BaseModel):
    primary_energy_sources: Optional[str] = Field(default=None)
    electricity_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    gas_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    currency_code: Optional[str] = Field(default=None, max_length=8)
    model_config = {"extra": "forbid"}


class PricingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None


class IntegrationTokenCreateIn(BaseModel):
    name: str = Field(default="Integration token", min_length=1, max_length=255)
    model_config = {"extra": "forbid"}


class IntegrationTokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None


class IntegrationTokenWithSecretOut(IntegrationTokenOut):
    token: str


class ClientOrgUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    role: Optional[str] = None
    is_active: Optional[int] = None
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Phase 4 Schemas
# ---------------------------------------------------------------------------

class ClientOrgIngestionStats(BaseModel):
    """Ingestion health stats for a single client org."""
    org_id: int
    org_name: str
    total_records: int
    active_sites: int
    last_ingestion_at: Optional[datetime] = None
    records_last_24h: int
    records_last_7d: int


class PortfolioSummaryOut(BaseModel):
    """
    High-level portfolio overview for the managing org dashboard.
    Returned by GET /manage/portfolio.
    """
    managing_org_id: int
    managing_org_name: str
    total_client_orgs: int
    total_sites: int
    total_timeseries_records: int
    open_alerts_total: int
    clients_with_recent_ingestion: int
    clients_without_recent_ingestion: int
    generated_at: datetime
    clients: List[ClientOrgIngestionStats]


class ClientOrgKPI(BaseModel):
    """Per-client KPI block for the analytics view."""
    org_id: int
    org_name: str
    currency_code: Optional[str] = None
    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    total_records: int
    records_last_24h: int
    records_last_7d: int
    last_ingestion_at: Optional[datetime] = None
    total_sites: int
    active_sites: int
    open_alerts: int
    critical_alerts: int
    active_tokens: int


class PortfolioAnalyticsOut(BaseModel):
    """
    Aggregated + per-client KPI analytics.
    Returned by GET /manage/portfolio/analytics.
    """
    managing_org_id: int
    managing_org_name: str
    window_days: int
    generated_at: datetime
    total_records_in_window: int
    total_open_alerts: int
    total_critical_alerts: int
    total_active_tokens: int
    clients: List[ClientOrgKPI]


class RecentAuditEvent(BaseModel):
    id: int
    title: str
    type: Optional[str] = None
    created_at: Optional[datetime] = None


class ClientReportOut(BaseModel):
    """
    Detailed per-client report.
    Returned by GET /manage/client-orgs/{id}/report.
    Data source for per-client PDF/email reports the ESCO sends to clients.
    """
    generated_at: datetime
    managing_org_id: int
    managing_org_name: str
    client_org_id: int
    client_org_name: str
    client_org_created_at: Optional[datetime] = None
    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None
    sites: List[SiteOut]
    total_sites: int
    total_timeseries_records: int
    records_last_24h: int
    records_last_7d: int
    last_ingestion_at: Optional[datetime] = None
    active_site_ids: List[str]
    open_alerts: int
    critical_alerts: int
    alerts_last_7d: int
    active_tokens: int
    total_tokens: int
    total_users: int
    recent_audit_events: List[RecentAuditEvent]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_client_org_or_404(
    db: Session,
    client_org_id: int,
    managing_org_id: int,
) -> Organization:
    org = db.query(Organization).filter(Organization.id == client_org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "CLIENT_ORG_NOT_FOUND",
                "message": f"Client organization id={client_org_id} not found.",
            },
        )
    if getattr(org, "managed_by_org_id", None) != managing_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOT_YOUR_CLIENT_ORG",
                "message": f"Organization id={client_org_id} is not managed by your organization.",
            },
        )
    return org


def _normalize_currency(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    c = str(code).strip().upper()
    return c or None


def _get_managing_org_id(org_context: OrgContext) -> int:
    managing_org_id = (
        org_context.managing_org_id
        if org_context.is_delegated
        else org_context.organization_id
    )
    if not managing_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NO_ORG",
                "message": "Authenticated user or token is not attached to any organization.",
            },
        )
    return managing_org_id


def _enforce_client_limit(db: Session, managing_org: Organization) -> None:
    limit = getattr(managing_org, "client_limit", None)
    if limit is None:
        return
    current_count = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org.id)
        .count()
    )
    if current_count >= limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "CLIENT_LIMIT_REACHED",
                "message": (
                    f"Your plan allows a maximum of {limit} client organization(s). "
                    f"You currently have {current_count}. "
                    "Upgrade your plan or remove an existing client org to continue."
                ),
            },
        )


def _get_allowed_site_ids_for_org(db: Session, org_id: int) -> List[str]:
    rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    return [f"site-{r[0]}" for r in rows]


def _ingestion_stats_for_org(
    db: Session,
    org_id: int,
    org_name: str,
    now: datetime,
) -> ClientOrgIngestionStats:
    site_ids = _get_allowed_site_ids_for_org(db, org_id)
    if not site_ids:
        return ClientOrgIngestionStats(
            org_id=org_id,
            org_name=org_name,
            total_records=0,
            active_sites=0,
            last_ingestion_at=None,
            records_last_24h=0,
            records_last_7d=0,
        )

    cutoff_24h = now - timedelta(hours=24)
    cutoff_7d = now - timedelta(days=7)

    base_q = db.query(TimeseriesRecord).filter(
        TimeseriesRecord.organization_id == org_id
    )
    total_records = base_q.count()
    last_record = base_q.order_by(TimeseriesRecord.timestamp.desc()).first()
    last_ingestion_at = last_record.timestamp if last_record else None
    records_24h = base_q.filter(TimeseriesRecord.timestamp >= cutoff_24h).count()
    records_7d = base_q.filter(TimeseriesRecord.timestamp >= cutoff_7d).count()

    active_site_count = (
        db.query(func.count(func.distinct(TimeseriesRecord.site_id)))
        .filter(
            TimeseriesRecord.organization_id == org_id,
            TimeseriesRecord.site_id.in_(site_ids),
        )
        .scalar()
        or 0
    )

    return ClientOrgIngestionStats(
        org_id=org_id,
        org_name=org_name,
        total_records=total_records,
        active_sites=active_site_count,
        last_ingestion_at=last_ingestion_at,
        records_last_24h=records_24h,
        records_last_7d=records_7d,
    )


# ---------------------------------------------------------------------------
# Phase 3: Client org lifecycle
# ---------------------------------------------------------------------------

@router.get("/client-orgs", response_model=List[ClientOrgSummaryOut])
def list_client_orgs(
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[ClientOrgSummaryOut]:
    """List all client orgs managed by the authenticated managing org."""
    managing_org_id = _get_managing_org_id(org_context)
    return (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .order_by(Organization.created_at.asc())
        .all()
    )


@router.post("/client-orgs", response_model=ClientOrgOut, status_code=status.HTTP_201_CREATED)
def create_client_org(
    payload: ClientOrgCreateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> ClientOrgOut:
    """Create a new client org under the authenticated managing org."""
    managing_org_id = _get_managing_org_id(org_context)
    _enforce_client_limit(db, managing_org)

    name = (payload.name or "").strip()
    new_org = Organization(
        name=name,
        org_type="client",
        managed_by_org_id=managing_org_id,
        primary_energy_sources=payload.primary_energy_sources,
        electricity_price_per_kwh=payload.electricity_price_per_kwh,
        gas_price_per_kwh=payload.gas_price_per_kwh,
        currency_code=_normalize_currency(payload.currency_code),
        plan_key="managed",
        subscription_plan_key="managed",
        subscription_status="active",
        enable_alerts=True,
        enable_reports=True,
    )
    db.add(new_org)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "ORG_NAME_TAKEN", "message": f"An organization named '{name}' already exists."},
        )
    db.refresh(new_org)

    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=actor_user_id,
        title="Client org created",
        description=f"client_org_id={new_org.id}; client_org_name={new_org.name}; managing_org_id={managing_org_id}",
    )
    return new_org


@router.get("/client-orgs/{client_org_id}", response_model=ClientOrgOut)
def get_client_org(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> ClientOrgOut:
    """Get full details for a single client org."""
    return _get_client_org_or_404(db, client_org_id, _get_managing_org_id(org_context))


@router.delete("/client-orgs/{client_org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_org(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> Response:
    """Delete a client org and all its data (cascade)."""
    managing_org_id = _get_managing_org_id(org_context)
    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)
    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=actor_user_id,
        title="Client org deleted",
        description=f"client_org_id={client_org.id}; client_org_name={client_org.name}; managing_org_id={managing_org_id}",
    )
    db.delete(client_org)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Phase 3: Site management
# ---------------------------------------------------------------------------

@router.get("/client-orgs/{client_org_id}/sites", response_model=List[SiteOut])
def list_client_org_sites(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[SiteOut]:
    """List all sites belonging to a client org."""
    _get_client_org_or_404(db, client_org_id, _get_managing_org_id(org_context))
    sites = db.query(Site).filter(Site.org_id == client_org_id).order_by(Site.created_at.asc()).all()
    return [SiteOut(id=s.id, name=s.name, location=s.location, org_id=s.org_id, site_id=f"site-{s.id}", created_at=s.created_at) for s in sites]


@router.post("/client-orgs/{client_org_id}/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def create_client_org_site(
    client_org_id: int,
    payload: SiteCreateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> SiteOut:
    """Create a new site inside a client org."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)
    site = Site(name=payload.name.strip(), location=(payload.location or "").strip() or None, org_id=client_org_id)
    db.add(site)
    db.commit()
    db.refresh(site)
    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=actor_user_id,
        title="Site created in client org",
        description=f"site_id={site.id}; site_name={site.name}; client_org_id={client_org_id}; managing_org_id={managing_org_id}",
    )
    return SiteOut(id=site.id, name=site.name, location=site.location, org_id=site.org_id, site_id=f"site-{site.id}", created_at=site.created_at)


@router.delete("/client-orgs/{client_org_id}/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_org_site(
    client_org_id: int,
    site_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> Response:
    """Delete a site from a client org."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)
    site = db.query(Site).filter(Site.id == site_id, Site.org_id == client_org_id).first()
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SITE_NOT_FOUND", "message": f"Site id={site_id} not found in client org id={client_org_id}."},
        )
    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=actor_user_id,
        title="Site deleted from client org",
        description=f"site_id={site.id}; site_name={site.name}; client_org_id={client_org_id}; managing_org_id={managing_org_id}",
    )
    db.delete(site)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Phase 3: Ghost pricing
# ---------------------------------------------------------------------------

@router.patch("/client-orgs/{client_org_id}/pricing", response_model=PricingOut)
def update_client_org_pricing(
    client_org_id: int,
    payload: PricingUpdateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> PricingOut:
    """Set ghost pricing for a client org (PATCH semantics — only provided fields updated)."""
    managing_org_id = _get_managing_org_id(org_context)
    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)
    updated_fields = []
    if payload.primary_energy_sources is not None:
        client_org.primary_energy_sources = payload.primary_energy_sources.strip()
        updated_fields.append("primary_energy_sources")
    if payload.electricity_price_per_kwh is not None:
        client_org.electricity_price_per_kwh = payload.electricity_price_per_kwh
        updated_fields.append("electricity_price_per_kwh")
    if payload.gas_price_per_kwh is not None:
        client_org.gas_price_per_kwh = payload.gas_price_per_kwh
        updated_fields.append("gas_price_per_kwh")
    if payload.currency_code is not None:
        client_org.currency_code = _normalize_currency(payload.currency_code)
        updated_fields.append("currency_code")
    if updated_fields:
        db.add(client_org)
        db.commit()
        db.refresh(client_org)
        actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None
        create_org_audit_event(
            db, org_id=managing_org_id, user_id=actor_user_id,
            title="Client org pricing updated",
            description=f"client_org_id={client_org_id}; updated_fields={','.join(updated_fields)}; managing_org_id={managing_org_id}",
        )
    return PricingOut(
        id=client_org.id, name=client_org.name,
        primary_energy_sources=client_org.primary_energy_sources,
        electricity_price_per_kwh=client_org.electricity_price_per_kwh,
        gas_price_per_kwh=client_org.gas_price_per_kwh,
        currency_code=client_org.currency_code,
    )


# ---------------------------------------------------------------------------
# Phase 3: Integration tokens
# ---------------------------------------------------------------------------

@router.get("/client-orgs/{client_org_id}/integration-tokens", response_model=List[IntegrationTokenOut])
def list_client_org_integration_tokens(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[IntegrationTokenOut]:
    """List all integration tokens scoped to a client org."""
    _get_client_org_or_404(db, client_org_id, _get_managing_org_id(org_context))
    return (
        db.query(IntegrationToken)
        .filter(IntegrationToken.organization_id == client_org_id)
        .order_by(IntegrationToken.created_at.desc())
        .all()
    )


@router.post("/client-orgs/{client_org_id}/integration-tokens", response_model=IntegrationTokenWithSecretOut, status_code=status.HTTP_201_CREATED)
def create_client_org_integration_token(
    client_org_id: int,
    payload: IntegrationTokenCreateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> IntegrationTokenWithSecretOut:
    """
    Create an integration token scoped to a client org.
    Raw token returned ONCE. Use with POST /api/v1/timeseries/batch
    to push data on behalf of the client — no X-CEI-ORG-ID needed.
    """
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)
    raw_token = _generate_integration_token()
    token_hash = _hash_token(raw_token)
    name = (payload.name or "").strip() or "Integration token"
    db_token = IntegrationToken(organization_id=client_org_id, name=name, token_hash=token_hash, is_active=True)
    db.add(db_token)
    db.commit()
    db.refresh(db_token)
    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=actor_user_id,
        title="Integration token created for client org",
        description=f"token_id={db_token.id}; token_name={db_token.name}; client_org_id={client_org_id}; managing_org_id={managing_org_id}",
    )
    return IntegrationTokenWithSecretOut(
        id=db_token.id, name=db_token.name, is_active=db_token.is_active,
        created_at=db_token.created_at, last_used_at=db_token.last_used_at, token=raw_token,
    )


@router.delete("/client-orgs/{client_org_id}/integration-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_client_org_integration_token(
    client_org_id: int,
    token_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> Response:
    """Revoke (soft-delete) an integration token scoped to a client org."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)
    token = db.query(IntegrationToken).filter(
        IntegrationToken.id == token_id,
        IntegrationToken.organization_id == client_org_id,
    ).first()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "TOKEN_NOT_FOUND", "message": f"Integration token id={token_id} not found for client org id={client_org_id}."},
        )
    if not bool(getattr(token, "is_active", True)):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    token.is_active = False
    db.add(token)
    db.commit()
    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=actor_user_id,
        title="Integration token revoked for client org",
        description=f"token_id={token_id}; token_name={getattr(token, 'name', None)}; client_org_id={client_org_id}; managing_org_id={managing_org_id}",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Phase 3: Users (read-only)
# ---------------------------------------------------------------------------

@router.get("/client-orgs/{client_org_id}/users", response_model=List[ClientOrgUserOut])
def list_client_org_users(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[ClientOrgUserOut]:
    """List all users belonging to a client org (read-only)."""
    _get_client_org_or_404(db, client_org_id, _get_managing_org_id(org_context))
    return db.query(User).filter(User.organization_id == client_org_id).order_by(User.created_at.asc()).all()


# ---------------------------------------------------------------------------
# Phase 4: Portfolio summary
# ---------------------------------------------------------------------------

@router.get("/portfolio", response_model=PortfolioSummaryOut)
def get_portfolio_summary(
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> PortfolioSummaryOut:
    """
    Full portfolio summary for the managing org dashboard.

    Returns at a glance:
    - Total client orgs, sites, timeseries records, open alerts
    - Per-client ingestion health (records, active sites, last ingestion)
    - Clients active vs inactive in the last 24h

    The top-level screen an ESCO opens to see the health of their entire
    client portfolio without drilling into individual clients.
    """
    managing_org_id = _get_managing_org_id(org_context)
    now = datetime.utcnow()

    client_orgs = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .order_by(Organization.created_at.asc())
        .all()
    )
    client_org_ids = [o.id for o in client_orgs]

    total_sites = (
        db.query(func.count(Site.id))
        .join(Organization, Site.org_id == Organization.id)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .scalar() or 0
    )

    total_records = 0
    open_alerts_total = 0
    if client_org_ids:
        total_records = (
            db.query(func.count(TimeseriesRecord.id))
            .filter(TimeseriesRecord.organization_id.in_(client_org_ids))
            .scalar() or 0
        )
        open_alerts_total = (
            db.query(func.count(AlertEvent.id))
            .filter(AlertEvent.organization_id.in_(client_org_ids), AlertEvent.status == "open")
            .scalar() or 0
        )

    client_stats = [_ingestion_stats_for_org(db, org.id, org.name, now) for org in client_orgs]
    clients_with_recent = sum(1 for s in client_stats if s.records_last_24h > 0)

    return PortfolioSummaryOut(
        managing_org_id=managing_org_id,
        managing_org_name=managing_org.name,
        total_client_orgs=len(client_orgs),
        total_sites=total_sites,
        total_timeseries_records=total_records,
        open_alerts_total=open_alerts_total,
        clients_with_recent_ingestion=clients_with_recent,
        clients_without_recent_ingestion=len(client_orgs) - clients_with_recent,
        generated_at=now,
        clients=client_stats,
    )


# ---------------------------------------------------------------------------
# Phase 4: Portfolio analytics
# ---------------------------------------------------------------------------

@router.get("/portfolio/analytics", response_model=PortfolioAnalyticsOut)
def get_portfolio_analytics(
    window_days: int = Query(default=7, ge=1, le=90, description="Analytics window in days (1-90). Default: 7."),
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> PortfolioAnalyticsOut:
    """
    Aggregated + per-client KPI analytics across the full portfolio.

    Query params:
        window_days (int, 1-90, default 7): time window for record counts

    Per-client KPIs include ingestion volume, site health, alert status,
    pricing config snapshot, and integration token counts.

    The analytics deep-dive screen where the ESCO reviews performance
    and energy cost metrics across their entire client base.
    """
    managing_org_id = _get_managing_org_id(org_context)
    now = datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)
    cutoff_window = now - timedelta(days=window_days)

    client_orgs = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .order_by(Organization.created_at.asc())
        .all()
    )

    client_kpis: List[ClientOrgKPI] = []
    total_records_in_window = 0
    total_open_alerts = 0
    total_critical_alerts = 0
    total_active_tokens = 0

    for org in client_orgs:
        site_ids = _get_allowed_site_ids_for_org(db, org.id)
        total_sites = len(site_ids)

        base_q = db.query(TimeseriesRecord).filter(TimeseriesRecord.organization_id == org.id)
        total_records = base_q.count()
        records_24h = base_q.filter(TimeseriesRecord.timestamp >= cutoff_24h).count()
        records_window = base_q.filter(TimeseriesRecord.timestamp >= cutoff_window).count()
        last_record = base_q.order_by(TimeseriesRecord.timestamp.desc()).first()
        last_ingestion_at = last_record.timestamp if last_record else None

        active_sites = (
            db.query(func.count(func.distinct(TimeseriesRecord.site_id)))
            .filter(TimeseriesRecord.organization_id == org.id, TimeseriesRecord.site_id.in_(site_ids))
            .scalar() or 0
        ) if site_ids else 0

        open_alerts = db.query(AlertEvent).filter(AlertEvent.organization_id == org.id, AlertEvent.status == "open").count()
        critical_alerts = db.query(AlertEvent).filter(
            AlertEvent.organization_id == org.id, AlertEvent.status == "open", AlertEvent.severity == "critical"
        ).count()
        active_tokens = db.query(IntegrationToken).filter(
            IntegrationToken.organization_id == org.id, IntegrationToken.is_active.is_(True)
        ).count()

        total_records_in_window += records_window
        total_open_alerts += open_alerts
        total_critical_alerts += critical_alerts
        total_active_tokens += active_tokens

        client_kpis.append(ClientOrgKPI(
            org_id=org.id,
            org_name=org.name,
            currency_code=getattr(org, "currency_code", None),
            primary_energy_sources=getattr(org, "primary_energy_sources", None),
            electricity_price_per_kwh=getattr(org, "electricity_price_per_kwh", None),
            gas_price_per_kwh=getattr(org, "gas_price_per_kwh", None),
            total_records=total_records,
            records_last_24h=records_24h,
            records_last_7d=records_window,
            last_ingestion_at=last_ingestion_at,
            total_sites=total_sites,
            active_sites=active_sites,
            open_alerts=open_alerts,
            critical_alerts=critical_alerts,
            active_tokens=active_tokens,
        ))

    return PortfolioAnalyticsOut(
        managing_org_id=managing_org_id,
        managing_org_name=managing_org.name,
        window_days=window_days,
        generated_at=now,
        total_records_in_window=total_records_in_window,
        total_open_alerts=total_open_alerts,
        total_critical_alerts=total_critical_alerts,
        total_active_tokens=total_active_tokens,
        clients=client_kpis,
    )


# ---------------------------------------------------------------------------
# Phase 4: Per-client report
# ---------------------------------------------------------------------------

@router.get("/client-orgs/{client_org_id}/report", response_model=ClientReportOut)
def get_client_org_report(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> ClientReportOut:
    """
    Detailed per-client report — the data source for per-client
    PDF/email reports the ESCO sends to their clients.

    Returns a full snapshot including:
    - Identity and pricing config
    - All sites with canonical site_id keys
    - Ingestion stats (total, last 24h, last 7d, last timestamp)
    - Which site_ids have ingested data (active vs silent)
    - Alert summary (open, critical, last 7d)
    - Integration token counts (active vs total)
    - User count
    - Last 20 audit events
    """
    managing_org_id = _get_managing_org_id(org_context)
    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)
    now = datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)
    cutoff_7d = now - timedelta(days=7)

    # Sites
    sites_raw = db.query(Site).filter(Site.org_id == client_org_id).order_by(Site.created_at.asc()).all()
    sites_out = [SiteOut(id=s.id, name=s.name, location=s.location, org_id=s.org_id, site_id=f"site-{s.id}", created_at=s.created_at) for s in sites_raw]
    site_ids = [f"site-{s.id}" for s in sites_raw]

    # Ingestion
    base_q = db.query(TimeseriesRecord).filter(TimeseriesRecord.organization_id == client_org_id)
    total_records = base_q.count()
    records_24h = base_q.filter(TimeseriesRecord.timestamp >= cutoff_24h).count()
    records_7d = base_q.filter(TimeseriesRecord.timestamp >= cutoff_7d).count()
    last_record = base_q.order_by(TimeseriesRecord.timestamp.desc()).first()
    last_ingestion_at = last_record.timestamp if last_record else None

    active_site_rows = (
        db.query(func.distinct(TimeseriesRecord.site_id))
        .filter(TimeseriesRecord.organization_id == client_org_id, TimeseriesRecord.site_id.in_(site_ids))
        .all()
    ) if site_ids else []
    active_site_ids = [r[0] for r in active_site_rows]

    # Alerts
    open_alerts = db.query(AlertEvent).filter(AlertEvent.organization_id == client_org_id, AlertEvent.status == "open").count()
    critical_alerts = db.query(AlertEvent).filter(AlertEvent.organization_id == client_org_id, AlertEvent.status == "open", AlertEvent.severity == "critical").count()
    alerts_7d = db.query(AlertEvent).filter(AlertEvent.organization_id == client_org_id, AlertEvent.triggered_at >= cutoff_7d).count()

    # Tokens
    active_tokens = db.query(IntegrationToken).filter(IntegrationToken.organization_id == client_org_id, IntegrationToken.is_active.is_(True)).count()
    total_tokens = db.query(IntegrationToken).filter(IntegrationToken.organization_id == client_org_id).count()

    # Users
    total_users = db.query(func.count(User.id)).filter(User.organization_id == client_org_id).scalar() or 0

    # Audit trail
    audit_events_raw = (
        db.query(SiteEvent)
        .filter(SiteEvent.organization_id == client_org_id)
        .order_by(SiteEvent.created_at.desc())
        .limit(20)
        .all()
    )
    recent_audit_events = [RecentAuditEvent(id=e.id, title=e.title, type=e.type, created_at=e.created_at) for e in audit_events_raw]

    return ClientReportOut(
        generated_at=now,
        managing_org_id=managing_org_id,
        managing_org_name=managing_org.name,
        client_org_id=client_org.id,
        client_org_name=client_org.name,
        client_org_created_at=getattr(client_org, "created_at", None),
        primary_energy_sources=getattr(client_org, "primary_energy_sources", None),
        electricity_price_per_kwh=getattr(client_org, "electricity_price_per_kwh", None),
        gas_price_per_kwh=getattr(client_org, "gas_price_per_kwh", None),
        currency_code=getattr(client_org, "currency_code", None),
        sites=sites_out,
        total_sites=len(sites_out),
        total_timeseries_records=total_records,
        records_last_24h=records_24h,
        records_last_7d=records_7d,
        last_ingestion_at=last_ingestion_at,
        active_site_ids=active_site_ids,
        open_alerts=open_alerts,
        critical_alerts=critical_alerts,
        alerts_last_7d=alerts_7d,
        active_tokens=active_tokens,
        total_tokens=total_tokens,
        total_users=total_users,
        recent_audit_events=recent_audit_events,
    )