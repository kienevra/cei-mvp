# backend/app/api/v1/manage.py
"""
Phase 3 + 4 + 5 — Managing Org CRUD API, Portfolio Dashboard, Role Hardening

Phase 5 changes:
  - DELETE client org   → require_role="owner"  (destructive)
  - DELETE site         → require_role="owner"  (destructive)
  - DELETE token        → require_role="owner"  (destructive)
  - All other endpoints → require_role="manager_or_owner" (default)
  - Subscription status enforced via require_managing_org_dep on every call
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import (
    create_org_audit_event,
    require_managing_org_dep,
)
from app.api.v1.alerts import DEFAULT_THRESHOLDS
from app.core.security import OrgContext, get_org_context
from app.db.session import get_db
from app.models import (
    AlertEvent,
    IntegrationToken,
    OrgAlertThreshold, 
    Organization,
    Site,
    SiteEvent,
    TimeseriesRecord,
    User,
    OrgLinkRequest
)
from fastapi.responses import StreamingResponse
from app.services.reporting import generate_client_org_pdf

router = APIRouter(prefix="/manage", tags=["manage"])

INTEGRATION_TOKEN_PREFIX = "cei_int_"


def _generate_integration_token() -> str:
    return INTEGRATION_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Schemas — Phase 3
# ---------------------------------------------------------------------------

class ClientOrgCreateIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    primary_energy_sources: Optional[str] = None
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
    primary_energy_sources: Optional[str] = None
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
# Schemas — Phase 4
# ---------------------------------------------------------------------------

class ClientOrgIngestionStats(BaseModel):
    org_id: int
    org_name: str
    total_records: int
    active_sites: int
    last_ingestion_at: Optional[datetime] = None
    records_last_24h: int
    records_last_7d: int


class PortfolioSummaryOut(BaseModel):
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

def _get_client_org_or_404(db: Session, client_org_id: int, managing_org_id: int) -> Organization:
    org = db.query(Organization).filter(Organization.id == client_org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CLIENT_ORG_NOT_FOUND", "message": f"Client organization id={client_org_id} not found."},
        )
    if getattr(org, "managed_by_org_id", None) != managing_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NOT_YOUR_CLIENT_ORG", "message": f"Organization id={client_org_id} is not managed by your organization."},
        )
    return org


def _normalize_currency(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return str(code).strip().upper() or None


def _get_managing_org_id(org_context: OrgContext) -> int:
    mid = org_context.managing_org_id if org_context.is_delegated else org_context.organization_id
    if not mid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NO_ORG", "message": "Authenticated user or token is not attached to any organization."},
        )
    return mid


def _enforce_client_limit(db: Session, managing_org: Organization) -> None:
    limit = getattr(managing_org, "client_limit", None)
    if limit is None:
        return
    current = db.query(Organization).filter(Organization.managed_by_org_id == managing_org.id).count()
    if current >= limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "CLIENT_LIMIT_REACHED",
                "message": (
                    f"Your plan allows a maximum of {limit} client organization(s). "
                    f"You currently have {current}. "
                    "Upgrade your plan or remove an existing client org to continue."
                ),
            },
        )


def _get_site_ids_for_org(db: Session, org_id: int) -> List[str]:
    rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    return [f"site-{r[0]}" for r in rows]


def _actor_user_id(org_context: OrgContext) -> Optional[int]:
    return getattr(org_context.user, "id", None) if org_context.user else None


def _ingestion_stats(db: Session, org_id: int, org_name: str, now: datetime) -> ClientOrgIngestionStats:
    site_ids = _get_site_ids_for_org(db, org_id)
    if not site_ids:
        return ClientOrgIngestionStats(
            org_id=org_id, org_name=org_name, total_records=0,
            active_sites=0, last_ingestion_at=None, records_last_24h=0, records_last_7d=0,
        )
    base_q = db.query(TimeseriesRecord).filter(TimeseriesRecord.organization_id == org_id)
    total = base_q.count()
    last = base_q.order_by(TimeseriesRecord.timestamp.desc()).first()
    r24 = base_q.filter(TimeseriesRecord.timestamp >= now - timedelta(hours=24)).count()
    r7d = base_q.filter(TimeseriesRecord.timestamp >= now - timedelta(days=7)).count()
    active = (
        db.query(func.count(func.distinct(TimeseriesRecord.site_id)))
        .filter(TimeseriesRecord.organization_id == org_id, TimeseriesRecord.site_id.in_(site_ids))
        .scalar() or 0
    )
    return ClientOrgIngestionStats(
        org_id=org_id, org_name=org_name, total_records=total,
        active_sites=active, last_ingestion_at=last.timestamp if last else None,
        records_last_24h=r24, records_last_7d=r7d,
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
    """List all client orgs. Accessible by owner or manager."""
    return (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == _get_managing_org_id(org_context))
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
    """Create a client org. Accessible by owner or manager."""
    managing_org_id = _get_managing_org_id(org_context)
    _enforce_client_limit(db, managing_org)
    name = (payload.name or "").strip()
    new_org = Organization(
        name=name, org_type="client", managed_by_org_id=managing_org_id,
        primary_energy_sources=payload.primary_energy_sources,
        electricity_price_per_kwh=payload.electricity_price_per_kwh,
        gas_price_per_kwh=payload.gas_price_per_kwh,
        currency_code=_normalize_currency(payload.currency_code),
        plan_key="managed", subscription_plan_key="managed",
        subscription_status="active", enable_alerts=True, enable_reports=True,
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
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
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
    """Get a single client org. Accessible by owner or manager."""
    return _get_client_org_or_404(db, client_org_id, _get_managing_org_id(org_context))


@router.delete(
    "/client-orgs/{client_org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # Phase 5: destructive — owner only
)
def delete_client_org(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep(require_role="owner")),
) -> Response:
    """
    Delete a client org and all its data.
    Phase 5: OWNER ONLY — destructive action.
    """
    managing_org_id = _get_managing_org_id(org_context)
    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
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
    """List sites in a client org. Accessible by owner or manager."""
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
    """Create a site in a client org. Accessible by owner or manager."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)
    site = Site(name=payload.name.strip(), location=(payload.location or "").strip() or None, org_id=client_org_id)
    db.add(site)
    db.commit()
    db.refresh(site)
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
        title="Site created in client org",
        description=f"site_id={site.id}; site_name={site.name}; client_org_id={client_org_id}; managing_org_id={managing_org_id}",
    )
    return SiteOut(id=site.id, name=site.name, location=site.location, org_id=site.org_id, site_id=f"site-{site.id}", created_at=site.created_at)


@router.delete(
    "/client-orgs/{client_org_id}/sites/{site_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # Phase 5: destructive — owner only
)
def delete_client_org_site(
    client_org_id: int,
    site_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep(require_role="owner")),
) -> Response:
    """
    Delete a site from a client org.
    Phase 5: OWNER ONLY — destructive action.
    """
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)
    site = db.query(Site).filter(Site.id == site_id, Site.org_id == client_org_id).first()
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SITE_NOT_FOUND", "message": f"Site id={site_id} not found in client org id={client_org_id}."},
        )
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
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
    """Update ghost pricing. Accessible by owner or manager."""
    managing_org_id = _get_managing_org_id(org_context)
    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)
    updated = []
    if payload.primary_energy_sources is not None:
        client_org.primary_energy_sources = payload.primary_energy_sources.strip()
        updated.append("primary_energy_sources")
    if payload.electricity_price_per_kwh is not None:
        client_org.electricity_price_per_kwh = payload.electricity_price_per_kwh
        updated.append("electricity_price_per_kwh")
    if payload.gas_price_per_kwh is not None:
        client_org.gas_price_per_kwh = payload.gas_price_per_kwh
        updated.append("gas_price_per_kwh")
    if payload.currency_code is not None:
        client_org.currency_code = _normalize_currency(payload.currency_code)
        updated.append("currency_code")
    if updated:
        db.add(client_org)
        db.commit()
        db.refresh(client_org)
        create_org_audit_event(
            db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
            title="Client org pricing updated",
            description=f"client_org_id={client_org_id}; updated_fields={','.join(updated)}; managing_org_id={managing_org_id}",
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
    """List integration tokens for a client org. Accessible by owner or manager."""
    _get_client_org_or_404(db, client_org_id, _get_managing_org_id(org_context))
    return (
        db.query(IntegrationToken)
        .filter(IntegrationToken.organization_id == client_org_id)
        .order_by(IntegrationToken.created_at.desc())
        .all()
    )


@router.post(
    "/client-orgs/{client_org_id}/integration-tokens",
    response_model=IntegrationTokenWithSecretOut,
    status_code=status.HTTP_201_CREATED,
)
def create_client_org_integration_token(
    client_org_id: int,
    payload: IntegrationTokenCreateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> IntegrationTokenWithSecretOut:
    """
    Create an integration token for a client org. Accessible by owner or manager.
    Raw token returned ONCE — use with POST /api/v1/timeseries/batch.
    """
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)
    raw = _generate_integration_token()
    db_token = IntegrationToken(
        organization_id=client_org_id,
        name=(payload.name or "").strip() or "Integration token",
        token_hash=_hash_token(raw),
        is_active=True,
    )
    db.add(db_token)
    db.commit()
    db.refresh(db_token)
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
        title="Integration token created for client org",
        description=f"token_id={db_token.id}; token_name={db_token.name}; client_org_id={client_org_id}; managing_org_id={managing_org_id}",
    )
    return IntegrationTokenWithSecretOut(
        id=db_token.id, name=db_token.name, is_active=db_token.is_active,
        created_at=db_token.created_at, last_used_at=db_token.last_used_at, token=raw,
    )


@router.delete(
    "/client-orgs/{client_org_id}/integration-tokens/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # Phase 5: destructive — owner only
)
def revoke_client_org_integration_token(
    client_org_id: int,
    token_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep(require_role="owner")),
) -> Response:
    """
    Revoke an integration token for a client org.
    Phase 5: OWNER ONLY — destructive action.
    """
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
    create_org_audit_event(
        db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
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
    """List users in a client org (read-only). Accessible by owner or manager."""
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
    Portfolio overview — all clients, sites, ingestion health, open alerts.
    Accessible by owner or manager.
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
    total_records = open_alerts = 0
    if client_org_ids:
        total_records = db.query(func.count(TimeseriesRecord.id)).filter(TimeseriesRecord.organization_id.in_(client_org_ids)).scalar() or 0
        open_alerts = db.query(func.count(AlertEvent.id)).filter(AlertEvent.organization_id.in_(client_org_ids), AlertEvent.status == "open").scalar() or 0
    client_stats = [_ingestion_stats(db, o.id, o.name, now) for o in client_orgs]
    with_recent = sum(1 for s in client_stats if s.records_last_24h > 0)
    return PortfolioSummaryOut(
        managing_org_id=managing_org_id, managing_org_name=managing_org.name,
        total_client_orgs=len(client_orgs), total_sites=total_sites,
        total_timeseries_records=total_records, open_alerts_total=open_alerts,
        clients_with_recent_ingestion=with_recent,
        clients_without_recent_ingestion=len(client_orgs) - with_recent,
        generated_at=now, clients=client_stats,
    )


# ---------------------------------------------------------------------------
# Phase 4: Portfolio analytics
# ---------------------------------------------------------------------------

@router.get("/portfolio/analytics", response_model=PortfolioAnalyticsOut)
def get_portfolio_analytics(
    window_days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> PortfolioAnalyticsOut:
    """
    Per-client KPI analytics with a configurable time window (1-90 days).
    Accessible by owner or manager.
    """
    managing_org_id = _get_managing_org_id(org_context)
    now = datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)
    cutoff_w = now - timedelta(days=window_days)
    client_orgs = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .order_by(Organization.created_at.asc())
        .all()
    )
    kpis: List[ClientOrgKPI] = []
    total_rw = total_oa = total_ca = total_at = 0
    for org in client_orgs:
        site_ids = _get_site_ids_for_org(db, org.id)
        base_q = db.query(TimeseriesRecord).filter(TimeseriesRecord.organization_id == org.id)
        total_r = base_q.count()
        r24 = base_q.filter(TimeseriesRecord.timestamp >= cutoff_24h).count()
        rw = base_q.filter(TimeseriesRecord.timestamp >= cutoff_w).count()
        last = base_q.order_by(TimeseriesRecord.timestamp.desc()).first()
        active_s = (
            db.query(func.count(func.distinct(TimeseriesRecord.site_id)))
            .filter(TimeseriesRecord.organization_id == org.id, TimeseriesRecord.site_id.in_(site_ids))
            .scalar() or 0
        ) if site_ids else 0
        oa = db.query(AlertEvent).filter(AlertEvent.organization_id == org.id, AlertEvent.status == "open").count()
        ca = db.query(AlertEvent).filter(AlertEvent.organization_id == org.id, AlertEvent.status == "open", AlertEvent.severity == "critical").count()
        at = db.query(IntegrationToken).filter(IntegrationToken.organization_id == org.id, IntegrationToken.is_active.is_(True)).count()
        total_rw += rw; total_oa += oa; total_ca += ca; total_at += at
        kpis.append(ClientOrgKPI(
            org_id=org.id, org_name=org.name,
            currency_code=getattr(org, "currency_code", None),
            primary_energy_sources=getattr(org, "primary_energy_sources", None),
            electricity_price_per_kwh=getattr(org, "electricity_price_per_kwh", None),
            gas_price_per_kwh=getattr(org, "gas_price_per_kwh", None),
            total_records=total_r, records_last_24h=r24, records_last_7d=rw,
            last_ingestion_at=last.timestamp if last else None,
            total_sites=len(site_ids), active_sites=active_s,
            open_alerts=oa, critical_alerts=ca, active_tokens=at,
        ))
    return PortfolioAnalyticsOut(
        managing_org_id=managing_org_id, managing_org_name=managing_org.name,
        window_days=window_days, generated_at=now,
        total_records_in_window=total_rw, total_open_alerts=total_oa,
        total_critical_alerts=total_ca, total_active_tokens=total_at, clients=kpis,
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
    Full per-client snapshot — data source for PDF/email reports.
    Accessible by owner or manager.
    """
    managing_org_id = _get_managing_org_id(org_context)
    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)
    now = datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)
    cutoff_7d = now - timedelta(days=7)
    sites_raw = db.query(Site).filter(Site.org_id == client_org_id).order_by(Site.created_at.asc()).all()
    sites_out = [SiteOut(id=s.id, name=s.name, location=s.location, org_id=s.org_id, site_id=f"site-{s.id}", created_at=s.created_at) for s in sites_raw]
    site_ids = [f"site-{s.id}" for s in sites_raw]
    base_q = db.query(TimeseriesRecord).filter(TimeseriesRecord.organization_id == client_org_id)
    total_r = base_q.count()
    r24 = base_q.filter(TimeseriesRecord.timestamp >= cutoff_24h).count()
    r7d = base_q.filter(TimeseriesRecord.timestamp >= cutoff_7d).count()
    last = base_q.order_by(TimeseriesRecord.timestamp.desc()).first()
    active_sids = [r[0] for r in (
        db.query(func.distinct(TimeseriesRecord.site_id))
        .filter(TimeseriesRecord.organization_id == client_org_id, TimeseriesRecord.site_id.in_(site_ids))
        .all()
    )] if site_ids else []
    oa = db.query(AlertEvent).filter(AlertEvent.organization_id == client_org_id, AlertEvent.status == "open").count()
    ca = db.query(AlertEvent).filter(AlertEvent.organization_id == client_org_id, AlertEvent.status == "open", AlertEvent.severity == "critical").count()
    a7d = db.query(AlertEvent).filter(AlertEvent.organization_id == client_org_id, AlertEvent.triggered_at >= cutoff_7d).count()
    at = db.query(IntegrationToken).filter(IntegrationToken.organization_id == client_org_id, IntegrationToken.is_active.is_(True)).count()
    tt = db.query(IntegrationToken).filter(IntegrationToken.organization_id == client_org_id).count()
    total_u = db.query(func.count(User.id)).filter(User.organization_id == client_org_id).scalar() or 0
    audit_raw = db.query(SiteEvent).filter(SiteEvent.organization_id == client_org_id).order_by(SiteEvent.created_at.desc()).limit(20).all()
    return ClientReportOut(
        generated_at=now, managing_org_id=managing_org_id, managing_org_name=managing_org.name,
        client_org_id=client_org.id, client_org_name=client_org.name,
        client_org_created_at=getattr(client_org, "created_at", None),
        primary_energy_sources=getattr(client_org, "primary_energy_sources", None),
        electricity_price_per_kwh=getattr(client_org, "electricity_price_per_kwh", None),
        gas_price_per_kwh=getattr(client_org, "gas_price_per_kwh", None),
        currency_code=getattr(client_org, "currency_code", None),
        sites=sites_out, total_sites=len(sites_out),
        total_timeseries_records=total_r, records_last_24h=r24, records_last_7d=r7d,
        last_ingestion_at=last.timestamp if last else None,
        active_site_ids=active_sids, open_alerts=oa, critical_alerts=ca, alerts_last_7d=a7d,
        active_tokens=at, total_tokens=tt, total_users=total_u,
        recent_audit_events=[RecentAuditEvent(id=e.id, title=e.title, type=e.type, created_at=e.created_at) for e in audit_raw],
    )

# ---------------------------------------------------------------------------
# Phase 3+: Alert threshold schemas
# ---------------------------------------------------------------------------

class AlertThresholdsIn(BaseModel):
    scope: str = Field(default="org", pattern="^(org|site)$")
    site_id: Optional[str] = Field(default=None)
    night_warning_ratio: Optional[float] = Field(default=None, ge=0.0, le=5.0)
    night_critical_ratio: Optional[float] = Field(default=None, ge=0.0, le=5.0)
    spike_warning_ratio: Optional[float] = Field(default=None, ge=0.0, le=20.0)
    portfolio_share_info_ratio: Optional[float] = Field(default=None, ge=0.0, le=20.0)
    weekend_warning_ratio: Optional[float] = Field(default=None, ge=0.0, le=5.0)
    weekend_critical_ratio: Optional[float] = Field(default=None, ge=0.0, le=5.0)
    min_points: Optional[int] = Field(default=None, ge=0, le=1000)
    min_total_kwh: Optional[float] = Field(default=None, ge=0.0)
    model_config = {"extra": "forbid"}


class AlertThresholdsOut(BaseModel):
    org_id: int
    scope: str
    site_id: Optional[str] = None
    has_custom_thresholds: bool
    night_warning_ratio: float
    night_critical_ratio: float
    spike_warning_ratio: float
    portfolio_share_info_ratio: float
    weekend_warning_ratio: float
    weekend_critical_ratio: float
    min_points: int
    min_total_kwh: float
    updated_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Phase 3+: Alert threshold endpoints
# ---------------------------------------------------------------------------

@router.get("/client-orgs/{client_org_id}/alert-thresholds", response_model=AlertThresholdsOut)
def get_client_org_alert_thresholds(
    client_org_id: int,
    site_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> AlertThresholdsOut:
    """Get effective alert thresholds for a client org or specific site."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)

    q = db.query(OrgAlertThreshold).filter(OrgAlertThreshold.organization_id == client_org_id)
    if site_id:
        q = q.filter(OrgAlertThreshold.site_id == site_id)
    else:
        q = q.filter(OrgAlertThreshold.site_id.is_(None))
    db_row = q.first()

    d = DEFAULT_THRESHOLDS
    def _v(attr, default):
        if db_row and getattr(db_row, attr, None) is not None:
            return getattr(db_row, attr)
        return default

    return AlertThresholdsOut(
        org_id=client_org_id, scope="site" if site_id else "org", site_id=site_id,
        has_custom_thresholds=db_row is not None,
        night_warning_ratio=_v("night_warning_ratio", d.night_warning_ratio),
        night_critical_ratio=_v("night_critical_ratio", d.night_critical_ratio),
        spike_warning_ratio=_v("spike_warning_ratio", d.spike_warning_ratio),
        portfolio_share_info_ratio=_v("portfolio_share_info_ratio", d.portfolio_share_info_ratio),
        weekend_warning_ratio=_v("weekend_warning_ratio", d.weekend_warning_ratio),
        weekend_critical_ratio=_v("weekend_critical_ratio", d.weekend_critical_ratio),
        min_points=_v("min_points", d.min_points),
        min_total_kwh=_v("min_total_kwh", d.min_total_kwh),
        updated_at=getattr(db_row, "updated_at", None) if db_row else None,
    )


@router.patch("/client-orgs/{client_org_id}/alert-thresholds", response_model=AlertThresholdsOut)
def set_client_org_alert_thresholds(
    client_org_id: int,
    payload: AlertThresholdsIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> AlertThresholdsOut:
    """Upsert alert thresholds for a client org or specific site."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)

    scope = payload.scope or "org"
    site_id: Optional[str] = None

    if scope == "site":
        if not payload.site_id:
            raise HTTPException(status_code=422, detail={"code": "SITE_ID_REQUIRED", "message": "site_id is required when scope='site'."})
        raw_id = payload.site_id.replace("site-", "")
        try:
            numeric_id = int(raw_id)
        except ValueError:
            raise HTTPException(status_code=422, detail={"code": "INVALID_SITE_ID", "message": f"Invalid site_id format: {payload.site_id}"})
        site = db.query(Site).filter(Site.id == numeric_id, Site.org_id == client_org_id).first()
        if not site:
            raise HTTPException(status_code=404, detail={"code": "SITE_NOT_FOUND", "message": f"Site {payload.site_id} not found in client org {client_org_id}."})
        site_id = payload.site_id

    q = db.query(OrgAlertThreshold).filter(OrgAlertThreshold.organization_id == client_org_id)
    q = q.filter(OrgAlertThreshold.site_id == site_id) if site_id else q.filter(OrgAlertThreshold.site_id.is_(None))
    db_row = q.first()

    if db_row is None:
        db_row = OrgAlertThreshold(organization_id=client_org_id, site_id=site_id)
        db.add(db_row)

    fields = ["night_warning_ratio", "night_critical_ratio", "spike_warning_ratio",
              "portfolio_share_info_ratio", "weekend_warning_ratio", "weekend_critical_ratio",
              "min_points", "min_total_kwh"]
    updated = []
    for field in fields:
        val = getattr(payload, field, None)
        if val is not None:
            setattr(db_row, field, val)
            updated.append(field)

    db_row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_row)

    create_org_audit_event(
        db, org_id=managing_org_id, user_id=_actor_user_id(org_context),
        title="Alert thresholds updated for client org",
        description=f"client_org_id={client_org_id}; scope={scope}; site_id={site_id}; updated_fields={','.join(updated)}",
    )

    d = DEFAULT_THRESHOLDS
    def _v(attr, default):
        v = getattr(db_row, attr, None)
        return v if v is not None else default

    return AlertThresholdsOut(
        org_id=client_org_id, scope=scope, site_id=site_id, has_custom_thresholds=True,
        night_warning_ratio=_v("night_warning_ratio", d.night_warning_ratio),
        night_critical_ratio=_v("night_critical_ratio", d.night_critical_ratio),
        spike_warning_ratio=_v("spike_warning_ratio", d.spike_warning_ratio),
        portfolio_share_info_ratio=_v("portfolio_share_info_ratio", d.portfolio_share_info_ratio),
        weekend_warning_ratio=_v("weekend_warning_ratio", d.weekend_warning_ratio),
        weekend_critical_ratio=_v("weekend_critical_ratio", d.weekend_critical_ratio),
        min_points=_v("min_points", d.min_points),
        min_total_kwh=_v("min_total_kwh", d.min_total_kwh),
        updated_at=db_row.updated_at,
    )

@router.get(
    "/client-orgs/{client_org_id}/report/pdf",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": "PDF report for the client org.",
        }
    },
)
def get_client_org_report_pdf(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> StreamingResponse:
    """
    Download a PDF report for a client org.
 
    Internally calls the same logic as GET /manage/client-orgs/{id}/report
    and renders the result as a downloadable multi-section PDF.
 
    Sections:
      - Cover (managing org, client org, generation date)
      - Summary KPIs
      - Energy configuration (pricing, sources, currency)
      - Sites table (with active/silent status)
      - Ingestion detail
      - Alert summary
      - Integration tokens
      - Recent audit trail (last 20 events)
 
    Accessible by owner or manager.
    """
    # Reuse the existing JSON report logic
    report = get_client_org_report(
        client_org_id=client_org_id,
        db=db,
        org_context=org_context,
        managing_org=managing_org,
    )
 
    pdf_bytes = generate_client_org_pdf(report)
 
    filename = (
        f"cei_report_{report.client_org_name.lower().replace(' ', '_')}"
        f"_{report.generated_at.strftime('%Y%m%d')}.pdf"
    )
 
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

# ── Schemas ──

class LinkRequestOut(BaseModel):
    id: int
    managing_org_id: int
    managing_org_name: str
    client_org_id: int
    client_org_name: str
    initiated_by: str
    status: str
    message: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class InitiateLinkIn(BaseModel):
    """Consultant initiates — provide the standalone org's owner email."""
    target_org_email: EmailStr
    message: Optional[str] = None


# ── Consultant-side endpoints ──

@router.post(
    "/link-requests",
    response_model=LinkRequestOut,
    status_code=status.HTTP_201_CREATED,
    summary="Consultant initiates a link request to an existing standalone org",
)
def consultant_initiate_link_request(
    payload: InitiateLinkIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
):
    """
    The consultant sends a link request to a standalone org by the org owner's email.
    The org owner must accept before the org is linked.
    """
    managing_org_id = _get_managing_org_id(org_context)
    managing_org = db.get(Organization, managing_org_id)

    # Find the target user by email
    from app.models import User as UserModel
    target_user = db.query(UserModel).filter(
        func.lower(UserModel.email) == payload.target_org_email.lower(),
        UserModel.is_active == True,
    ).first()

    if not target_user or not target_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active account found with that email address.",
        )

    target_org = db.get(Organization, target_user.organization_id)
    if not target_org:
        raise HTTPException(status_code=404, detail="Organization not found.")

    if target_org.org_type != "standalone":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That organization is already managed or is a managing org itself.",
        )

    if target_org.id == managing_org_id:
        raise HTTPException(status_code=400, detail="Cannot link your own organization.")

    # Check for existing pending request
    existing = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.managing_org_id == managing_org_id,
        OrgLinkRequest.client_org_id == target_org.id,
        OrgLinkRequest.status == "pending",
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending link request already exists for this organization.",
        )

    req = OrgLinkRequest(
        managing_org_id=managing_org_id,
        client_org_id=target_org.id,
        initiated_by="consultant",
        status="pending",
        token=OrgLinkRequest.generate_token(),
        message=payload.message,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    return LinkRequestOut(
        id=req.id,
        managing_org_id=req.managing_org_id,
        managing_org_name=managing_org.name,
        client_org_id=req.client_org_id,
        client_org_name=target_org.name,
        initiated_by=req.initiated_by,
        status=req.status,
        message=req.message,
        created_at=req.created_at,
    )


@router.get(
    "/link-requests",
    response_model=List[LinkRequestOut],
    summary="List all link requests for this managing org (sent + incoming)",
)
def list_consultant_link_requests(
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
):
    """Returns both consultant-initiated and org-owner-initiated requests."""
    managing_org_id = _get_managing_org_id(org_context)
    reqs = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.managing_org_id == managing_org_id,
    ).order_by(OrgLinkRequest.created_at.desc()).all()

    result = []
    for req in reqs:
        managing_org = db.get(Organization, req.managing_org_id)
        client_org   = db.get(Organization, req.client_org_id)
        result.append(LinkRequestOut(
            id=req.id,
            managing_org_id=req.managing_org_id,
            managing_org_name=managing_org.name if managing_org else "—",
            client_org_id=req.client_org_id,
            client_org_name=client_org.name if client_org else "—",
            initiated_by=req.initiated_by,
            status=req.status,
            message=req.message,
            created_at=req.created_at,
        ))
    return result


@router.post(
    "/link-requests/{request_id}/accept",
    response_model=LinkRequestOut,
    summary="Consultant accepts an org-owner-initiated link request",
)
def consultant_accept_link_request(
    request_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
):
    managing_org_id = _get_managing_org_id(org_context)
    req = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.id == request_id,
        OrgLinkRequest.managing_org_id == managing_org_id,
        OrgLinkRequest.initiated_by == "org_owner",
        OrgLinkRequest.status == "pending",
    ).first()

    if not req:
        raise HTTPException(status_code=404, detail="Link request not found or not actionable.")

    _enforce_client_limit(db, db.get(Organization, managing_org_id))
    _apply_link(db, req)
    return _req_to_out(db, req)


@router.post(
    "/link-requests/{request_id}/reject",
    response_model=LinkRequestOut,
    summary="Consultant rejects a link request",
)
def consultant_reject_link_request(
    request_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
):
    managing_org_id = _get_managing_org_id(org_context)
    req = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.id == request_id,
        OrgLinkRequest.managing_org_id == managing_org_id,
        OrgLinkRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Link request not found.")
    req.status = "rejected"
    req.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(req)
    return _req_to_out(db, req)


@router.delete(
    "/link-requests/{request_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Consultant cancels a link request they initiated",
)
def consultant_cancel_link_request(
    request_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
):
    managing_org_id = _get_managing_org_id(org_context)
    req = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.id == request_id,
        OrgLinkRequest.managing_org_id == managing_org_id,
        OrgLinkRequest.initiated_by == "consultant",
        OrgLinkRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Link request not found.")
    req.status = "cancelled"
    req.updated_at = datetime.utcnow()
    db.commit()


# ── Shared helpers (add near other helpers in manage.py) ──

def _apply_link(db: Session, req: OrgLinkRequest) -> None:
    """Accept a link request — link the client org to the managing org."""
    client_org = db.get(Organization, req.client_org_id)
    if not client_org:
        raise HTTPException(status_code=404, detail="Client org not found.")
    client_org.managed_by_org_id = req.managing_org_id
    client_org.org_type = "client"
    req.status = "accepted"
    req.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(req)


def _req_to_out(db: Session, req: OrgLinkRequest) -> LinkRequestOut:
    managing_org = db.get(Organization, req.managing_org_id)
    client_org   = db.get(Organization, req.client_org_id)
    return LinkRequestOut(
        id=req.id,
        managing_org_id=req.managing_org_id,
        managing_org_name=managing_org.name if managing_org else "—",
        client_org_id=req.client_org_id,
        client_org_name=client_org.name if client_org else "—",
        initiated_by=req.initiated_by,
        status=req.status,
        message=req.message,
        created_at=req.created_at,
    )