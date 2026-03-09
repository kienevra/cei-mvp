# backend/app/api/v1/manage.py
"""
Phase 3 — Managing Org CRUD API

All endpoints in this router require:
  1. A valid JWT or integration token (standard CEI auth)
  2. The authenticated org must have org_type == "managing"

Endpoints are prefixed /api/v1/manage/ and cover the full lifecycle
that an ESCO or energy consultant needs to manage their client portfolio:

  Client org lifecycle:
    GET    /manage/client-orgs                              → list all client orgs
    POST   /manage/client-orgs                              → create a client org
    GET    /manage/client-orgs/{client_org_id}              → get a single client org
    DELETE /manage/client-orgs/{client_org_id}              → delete a client org

  Site management (within a client org):
    GET    /manage/client-orgs/{client_org_id}/sites        → list sites
    POST   /manage/client-orgs/{client_org_id}/sites        → create a site
    DELETE /manage/client-orgs/{client_org_id}/sites/{site_id} → delete a site

  Ghost pricing (managing org sets energy prices for client org):
    PATCH  /manage/client-orgs/{client_org_id}/pricing      → set pricing config

  Integration tokens (for automated ingestion into client org):
    GET    /manage/client-orgs/{client_org_id}/integration-tokens
    POST   /manage/client-orgs/{client_org_id}/integration-tokens
    DELETE /manage/client-orgs/{client_org_id}/integration-tokens/{token_id}

  Users (read-only view of client org members):
    GET    /manage/client-orgs/{client_org_id}/users        → list users
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import (
    create_org_audit_event,
    require_managing_org_dep,
)
from app.core.security import OrgContext, get_org_context
from app.db.session import get_db
from app.models import IntegrationToken, Organization, Site, User

router = APIRouter(prefix="/manage", tags=["manage"])

# ---------------------------------------------------------------------------
# Token helpers (mirrors auth.py — kept local to avoid circular imports)
# ---------------------------------------------------------------------------

INTEGRATION_TOKEN_PREFIX = "cei_int_"


def _generate_integration_token() -> str:
    return INTEGRATION_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ClientOrgCreateIn(BaseModel):
    """Payload to create a new client org under the managing org."""
    name: str = Field(..., min_length=2, max_length=255)

    # Optional: seed the client org with pricing config right away
    primary_energy_sources: Optional[str] = Field(
        default=None,
        description="Comma-separated energy sources, e.g. 'electricity,gas'",
    )
    electricity_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    gas_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    currency_code: Optional[str] = Field(default=None, max_length=8)

    model_config = {"extra": "forbid"}


class ClientOrgOut(BaseModel):
    """Full client org representation returned by manage endpoints."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    org_type: str
    managed_by_org_id: Optional[int] = None
    client_limit: Optional[int] = None

    # Pricing / cost engine config
    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None

    # Billing / plan state (read-only for client orgs)
    plan_key: Optional[str] = None
    subscription_status: Optional[str] = None

    created_at: Optional[datetime] = None


class ClientOrgSummaryOut(BaseModel):
    """Lightweight summary for list views."""
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
    site_id: Optional[str] = None  # canonical "site-{id}" key
    created_at: Optional[datetime] = None


class PricingUpdateIn(BaseModel):
    """
    Ghost pricing payload. Managing org sets these on behalf of client org.
    All fields optional — PATCH semantics (only provided fields are updated).
    """
    primary_energy_sources: Optional[str] = Field(
        default=None,
        description="Comma-separated, e.g. 'electricity,gas,solar'",
    )
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
    """Returned ONCE at creation — raw token not stored server-side."""
    token: str


class ClientOrgUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: Optional[str] = None
    is_active: Optional[int] = None
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_client_org_or_404(
    db: Session,
    client_org_id: int,
    managing_org_id: int,
) -> Organization:
    """
    Load a client org and verify it belongs to the managing org.
    Raises 404 if not found, 403 if not owned by this managing org.
    """
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
                "message": (
                    f"Organization id={client_org_id} is not managed by your organization."
                ),
            },
        )
    return org


def _normalize_currency(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    c = str(code).strip().upper()
    return c or None


def _get_managing_org_id(org_context: OrgContext) -> int:
    """
    Extract the managing org id from the OrgContext.
    For delegated requests, managing_org_id is the authenticated org.
    For direct requests, organization_id is the managing org.
    """
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
    """
    Check client_limit before creating a new client org.
    Raises 409 if the limit is reached.
    """
    limit = getattr(managing_org, "client_limit", None)
    if limit is None:
        return  # unlimited

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


# ---------------------------------------------------------------------------
# Client org lifecycle
# ---------------------------------------------------------------------------

@router.get(
    "/client-orgs",
    response_model=List[ClientOrgSummaryOut],
    status_code=status.HTTP_200_OK,
)
def list_client_orgs(
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[ClientOrgSummaryOut]:
    """
    List all client orgs managed by the authenticated managing org.
    """
    managing_org_id = _get_managing_org_id(org_context)

    client_orgs = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .order_by(Organization.created_at.asc())
        .all()
    )
    return client_orgs


@router.post(
    "/client-orgs",
    response_model=ClientOrgOut,
    status_code=status.HTTP_201_CREATED,
)
def create_client_org(
    payload: ClientOrgCreateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> ClientOrgOut:
    """
    Create a new client org under the authenticated managing org.

    Guardrails:
    - Managing org must have org_type == "managing"
    - client_limit is enforced if set on the managing org
    - Org name must be globally unique
    - New client org defaults to org_type == "client"
    """
    managing_org_id = _get_managing_org_id(org_context)

    # Enforce plan-level client limit
    _enforce_client_limit(db, managing_org)

    name = (payload.name or "").strip()

    new_org = Organization(
        name=name,
        org_type="client",
        managed_by_org_id=managing_org_id,
        # Seed pricing if provided
        primary_energy_sources=payload.primary_energy_sources,
        electricity_price_per_kwh=payload.electricity_price_per_kwh,
        gas_price_per_kwh=payload.gas_price_per_kwh,
        currency_code=_normalize_currency(payload.currency_code),
        # Client orgs inherit a default plan; billing is handled by managing org
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
            detail={
                "code": "ORG_NAME_TAKEN",
                "message": f"An organization named '{name}' already exists.",
            },
        )

    db.refresh(new_org)

    # Determine actor for audit log
    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None

    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_user_id,
        title="Client org created",
        description=(
            f"client_org_id={new_org.id}; client_org_name={new_org.name}; "
            f"managing_org_id={managing_org_id}"
        ),
    )

    return new_org


@router.get(
    "/client-orgs/{client_org_id}",
    response_model=ClientOrgOut,
    status_code=status.HTTP_200_OK,
)
def get_client_org(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> ClientOrgOut:
    """
    Get full details for a single client org.
    """
    managing_org_id = _get_managing_org_id(org_context)
    return _get_client_org_or_404(db, client_org_id, managing_org_id)


@router.delete(
    "/client-orgs/{client_org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_client_org(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> Response:
    """
    Delete a client org and all its data (sites, users, tokens, timeseries).

    This is a hard delete — all cascading deletes are handled by SQLAlchemy
    relationships (cascade="all, delete-orphan") defined in models.py.

    Use with caution. Consider adding a confirmation flag in a future iteration.
    """
    managing_org_id = _get_managing_org_id(org_context)
    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)

    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None

    # Audit before delete (org_id won't exist after)
    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_user_id,
        title="Client org deleted",
        description=(
            f"client_org_id={client_org.id}; client_org_name={client_org.name}; "
            f"managing_org_id={managing_org_id}"
        ),
    )

    db.delete(client_org)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Site management within a client org
# ---------------------------------------------------------------------------

@router.get(
    "/client-orgs/{client_org_id}/sites",
    response_model=List[SiteOut],
    status_code=status.HTTP_200_OK,
)
def list_client_org_sites(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[SiteOut]:
    """List all sites belonging to a client org."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)

    sites = (
        db.query(Site)
        .filter(Site.org_id == client_org_id)
        .order_by(Site.created_at.asc())
        .all()
    )

    # Inject canonical site_id key
    result = []
    for s in sites:
        result.append(
            SiteOut(
                id=s.id,
                name=s.name,
                location=s.location,
                org_id=s.org_id,
                site_id=f"site-{s.id}",
                created_at=s.created_at,
            )
        )
    return result


@router.post(
    "/client-orgs/{client_org_id}/sites",
    response_model=SiteOut,
    status_code=status.HTTP_201_CREATED,
)
def create_client_org_site(
    client_org_id: int,
    payload: SiteCreateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> SiteOut:
    """
    Create a new site inside a client org.
    The managing org controls all site creation for its clients.
    """
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)

    site = Site(
        name=payload.name.strip(),
        location=(payload.location or "").strip() or None,
        org_id=client_org_id,
    )
    db.add(site)
    db.commit()
    db.refresh(site)

    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None

    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_user_id,
        title="Site created in client org",
        description=(
            f"site_id={site.id}; site_name={site.name}; "
            f"client_org_id={client_org_id}; managing_org_id={managing_org_id}"
        ),
    )

    return SiteOut(
        id=site.id,
        name=site.name,
        location=site.location,
        org_id=site.org_id,
        site_id=f"site-{site.id}",
        created_at=site.created_at,
    )


@router.delete(
    "/client-orgs/{client_org_id}/sites/{site_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
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

    site = (
        db.query(Site)
        .filter(Site.id == site_id, Site.org_id == client_org_id)
        .first()
    )
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "SITE_NOT_FOUND",
                "message": f"Site id={site_id} not found in client org id={client_org_id}.",
            },
        )

    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None

    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_user_id,
        title="Site deleted from client org",
        description=(
            f"site_id={site.id}; site_name={site.name}; "
            f"client_org_id={client_org_id}; managing_org_id={managing_org_id}"
        ),
    )

    db.delete(site)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Ghost pricing
# ---------------------------------------------------------------------------

@router.patch(
    "/client-orgs/{client_org_id}/pricing",
    response_model=PricingOut,
    status_code=status.HTTP_200_OK,
)
def update_client_org_pricing(
    client_org_id: int,
    payload: PricingUpdateIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> PricingOut:
    """
    Set ghost pricing for a client org.

    PATCH semantics: only fields included in the payload are updated.
    Fields omitted remain unchanged.

    The managing org controls all pricing for its client orgs, allowing
    them to set accurate cost baselines without the client needing to
    configure anything themselves.
    """
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
            db,
            org_id=managing_org_id,
            user_id=actor_user_id,
            title="Client org pricing updated",
            description=(
                f"client_org_id={client_org_id}; "
                f"updated_fields={','.join(updated_fields)}; "
                f"managing_org_id={managing_org_id}"
            ),
        )

    return PricingOut(
        id=client_org.id,
        name=client_org.name,
        primary_energy_sources=client_org.primary_energy_sources,
        electricity_price_per_kwh=client_org.electricity_price_per_kwh,
        gas_price_per_kwh=client_org.gas_price_per_kwh,
        currency_code=client_org.currency_code,
    )


# ---------------------------------------------------------------------------
# Integration tokens scoped to client org
# ---------------------------------------------------------------------------

@router.get(
    "/client-orgs/{client_org_id}/integration-tokens",
    response_model=List[IntegrationTokenOut],
    status_code=status.HTTP_200_OK,
)
def list_client_org_integration_tokens(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[IntegrationTokenOut]:
    """List all integration tokens scoped to a client org."""
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)

    tokens = (
        db.query(IntegrationToken)
        .filter(IntegrationToken.organization_id == client_org_id)
        .order_by(IntegrationToken.created_at.desc())
        .all()
    )
    return tokens


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
    Create an integration token scoped to a client org.

    The raw token is returned ONCE and never stored — only its SHA-256
    hash is persisted. The managing org uses this token to push timeseries
    data on behalf of the client org via /api/v1/timeseries/batch.

    Usage after creation:
        curl -X POST https://api.carbonefficiencyintel.com/api/v1/timeseries/batch \\
          -H "Authorization: Bearer cei_int_<raw_token>" \\
          -H "Content-Type: application/json" \\
          -d '{ "records": [...] }'

    Because the token is scoped to the client org, all ingested data is
    automatically attributed to that client org — no X-CEI-ORG-ID header needed.
    """
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)

    raw_token = _generate_integration_token()
    token_hash = _hash_token(raw_token)
    name = (payload.name or "").strip() or "Integration token"

    db_token = IntegrationToken(
        organization_id=client_org_id,  # scoped to the CLIENT org
        name=name,
        token_hash=token_hash,
        is_active=True,
    )
    db.add(db_token)
    db.commit()
    db.refresh(db_token)

    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None

    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_user_id,
        title="Integration token created for client org",
        description=(
            f"token_id={db_token.id}; token_name={db_token.name}; "
            f"client_org_id={client_org_id}; managing_org_id={managing_org_id}"
        ),
    )

    return IntegrationTokenWithSecretOut(
        id=db_token.id,
        name=db_token.name,
        is_active=db_token.is_active,
        created_at=db_token.created_at,
        last_used_at=db_token.last_used_at,
        token=raw_token,
    )


@router.delete(
    "/client-orgs/{client_org_id}/integration-tokens/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
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

    token = (
        db.query(IntegrationToken)
        .filter(
            IntegrationToken.id == token_id,
            IntegrationToken.organization_id == client_org_id,
        )
        .first()
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "TOKEN_NOT_FOUND",
                "message": f"Integration token id={token_id} not found for client org id={client_org_id}.",
            },
        )

    # Idempotent: already revoked → no-op
    if not bool(getattr(token, "is_active", True)):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    token.is_active = False
    db.add(token)
    db.commit()

    actor_user_id = getattr(org_context.user, "id", None) if org_context.user else None

    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_user_id,
        title="Integration token revoked for client org",
        description=(
            f"token_id={token_id}; token_name={getattr(token, 'name', None)}; "
            f"client_org_id={client_org_id}; managing_org_id={managing_org_id}"
        ),
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Users (read-only view of client org members)
# ---------------------------------------------------------------------------

@router.get(
    "/client-orgs/{client_org_id}/users",
    response_model=List[ClientOrgUserOut],
    status_code=status.HTTP_200_OK,
)
def list_client_org_users(
    client_org_id: int,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> List[ClientOrgUserOut]:
    """
    List all users belonging to a client org.

    Read-only — the managing org can see who is in the org but cannot
    create or delete client org users via this endpoint. User management
    for client orgs is handled via the standard invite flow.
    """
    managing_org_id = _get_managing_org_id(org_context)
    _get_client_org_or_404(db, client_org_id, managing_org_id)

    users = (
        db.query(User)
        .filter(User.organization_id == client_org_id)
        .order_by(User.created_at.asc())
        .all()
    )
    return users