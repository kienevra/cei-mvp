# backend/app/api/v1/onboarding.py
"""
ESCO Self-Serve Onboarding Flow
================================

Endpoints:
  POST /manage/onboarding/bootstrap
      Atomic setup: creates a client org + site + integration token in one call.
      Idempotent on client org name — reuses an existing client org if the name
      already exists under this managing org.

  POST /manage/client-orgs/{client_org_id}/invite-user
      Invite a user into a specific client org.
      Reuses the existing OrgInvite model and accept-and-signup flow.
      The invited user joins the client org directly, not the managing org.

  GET /manage/onboarding/status
      Onboarding checklist — which steps are complete vs pending.
      Designed for a frontend wizard or API-driven runbook validation.

All endpoints require:
  - Valid JWT auth
  - Authenticated org must be org_type="managing"
  - Subscription must be active/trialing (enforced via require_managing_org_dep)
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import create_org_audit_event, require_managing_org_dep
from app.core.security import OrgContext, get_org_context
from app.db.session import get_db
from app.models import IntegrationToken, OrgInvite, Organization, Site, TimeseriesRecord, User
from app.services.invites import generate_invite_token, hash_invite_token, normalize_email

router = APIRouter(prefix="/manage", tags=["onboarding"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

INTEGRATION_TOKEN_PREFIX = "cei_int_"
ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_managing_org_id(org_context: OrgContext) -> int:
    mid = org_context.managing_org_id if org_context.is_delegated else org_context.organization_id
    if not mid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NO_ORG", "message": "Authenticated user or token is not attached to any organization."},
        )
    return mid


def _actor_user_id(org_context: OrgContext) -> Optional[int]:
    return getattr(org_context.user, "id", None) if org_context.user else None


def _generate_token() -> str:
    return INTEGRATION_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


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


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class BootstrapIn(BaseModel):
    """
    Atomic ESCO onboarding payload.

    Creates a client org + site + integration token in one call.
    All fields are optional with sensible defaults so the ESCO can bootstrap
    with minimal input and configure details later.
    """
    # Client org
    client_org_name: str = Field(..., min_length=2, max_length=255, description="Name of the client organization (factory / facility).")
    primary_energy_sources: Optional[str] = Field(default=None, description="Comma-separated e.g. 'electricity,gas'")
    electricity_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    gas_price_per_kwh: Optional[float] = Field(default=None, ge=0)
    currency_code: Optional[str] = Field(default="EUR", max_length=8)

    # First site
    site_name: str = Field(default="Main Plant", min_length=1, max_length=255)
    site_location: Optional[str] = Field(default=None, max_length=255)

    # Integration token
    token_name: str = Field(default="Primary integration token", min_length=1, max_length=255)

    model_config = {"extra": "forbid"}


class BootstrappedSiteOut(BaseModel):
    id: int
    name: str
    location: Optional[str] = None
    site_id: str


class BootstrappedTokenOut(BaseModel):
    id: int
    name: str
    token: str  # raw — shown ONCE


class BootstrapOut(BaseModel):
    """
    Full result of a bootstrap call.
    The integration token raw value is returned once — store it securely.
    """
    managing_org_id: int
    managing_org_name: str

    client_org_id: int
    client_org_name: str
    client_org_created: bool  # True = newly created, False = pre-existing (idempotent)

    site: BootstrappedSiteOut
    site_created: bool  # True = newly created

    integration_token: BootstrappedTokenOut

    # Quick-start instructions
    next_steps: List[str]


class InviteClientUserIn(BaseModel):
    """Invite a user to join a specific client org."""
    email: str = Field(..., description="Email address of the user to invite.")
    role: str = Field(default="member", description="'member' or 'owner'")
    expires_in_days: int = Field(default=7, ge=1, le=30)

    model_config = {"extra": "forbid"}


class InviteClientUserOut(BaseModel):
    invite_id: int
    email: str
    role: str
    client_org_id: int
    client_org_name: str
    expires_at: datetime
    token: str  # raw invite token — send to the user
    accept_url_hint: str  # hint for the frontend to build the accept URL


# ---------------------------------------------------------------------------
# Onboarding status
# ---------------------------------------------------------------------------

class OnboardingStep(BaseModel):
    key: str
    label: str
    complete: bool
    detail: Optional[str] = None


class OnboardingStatusOut(BaseModel):
    """
    Checklist of onboarding steps for the managing org.
    Designed for a frontend wizard or API-driven runbook validation.
    """
    managing_org_id: int
    managing_org_name: str
    all_complete: bool
    steps: List[OnboardingStep]
    generated_at: datetime


# ---------------------------------------------------------------------------
# 1. Bootstrap endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/onboarding/bootstrap",
    response_model=BootstrapOut,
    status_code=status.HTTP_201_CREATED,
)
def bootstrap_esco(
    payload: BootstrapIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> BootstrapOut:
    """
    Atomic ESCO onboarding bootstrap.

    In a single call:
      1. Creates (or reuses) a client org under the managing org
      2. Creates (or reuses) a site within that client org
      3. Creates a fresh integration token scoped to the client org

    Idempotent on (client_org_name, site_name) — safe to call multiple times
    during setup without creating duplicates.

    The integration token raw value is returned ONCE. Store it securely and
    use it with POST /api/v1/timeseries/batch to push energy data.
    """
    managing_org_id = _get_managing_org_id(org_context)
    actor_id = _actor_user_id(org_context)
    client_org_name = (payload.client_org_name or "").strip()
    currency = (payload.currency_code or "EUR").strip().upper()

    # ------------------------------------------------------------------
    # Step 1: Client org — create or reuse
    # ------------------------------------------------------------------
    existing_client = (
        db.query(Organization)
        .filter(
            Organization.managed_by_org_id == managing_org_id,
            Organization.name == client_org_name,
        )
        .first()
    )

    client_org_created = False

    if existing_client:
        client_org = existing_client
    else:
        # Check client limit
        limit = getattr(managing_org, "client_limit", None)
        if limit is not None:
            current_count = (
                db.query(Organization)
                .filter(Organization.managed_by_org_id == managing_org_id)
                .count()
            )
            if current_count >= limit:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "CLIENT_LIMIT_REACHED",
                        "message": (
                            f"Your plan allows a maximum of {limit} client organization(s). "
                            f"You currently have {current_count}."
                        ),
                    },
                )

        client_org = Organization(
            name=client_org_name,
            org_type="client",
            managed_by_org_id=managing_org_id,
            primary_energy_sources=payload.primary_energy_sources,
            electricity_price_per_kwh=payload.electricity_price_per_kwh,
            gas_price_per_kwh=payload.gas_price_per_kwh,
            currency_code=currency,
            plan_key="managed",
            subscription_plan_key="managed",
            subscription_status="active",
            enable_alerts=True,
            enable_reports=True,
        )
        db.add(client_org)
        try:
            db.flush()  # get client_org.id without committing yet
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "ORG_NAME_TAKEN", "message": f"Organization '{client_org_name}' already exists."},
            )
        client_org_created = True

    # ------------------------------------------------------------------
    # Step 2: Site — create or reuse within this client org
    # ------------------------------------------------------------------
    site_name = (payload.site_name or "Main Plant").strip()
    site_location = (payload.site_location or "").strip() or None

    existing_site = (
        db.query(Site)
        .filter(Site.org_id == client_org.id, Site.name == site_name)
        .first()
    )

    site_created = False
    if existing_site:
        site = existing_site
    else:
        site = Site(name=site_name, location=site_location, org_id=client_org.id)
        db.add(site)
        db.flush()
        site_created = True

    # ------------------------------------------------------------------
    # Step 3: Integration token — always create fresh
    # ------------------------------------------------------------------
    token_name = (payload.token_name or "Primary integration token").strip()
    raw_token = _generate_token()

    db_token = IntegrationToken(
        organization_id=client_org.id,
        name=token_name,
        token_hash=_hash_token(raw_token),
        is_active=True,
    )
    db.add(db_token)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(client_org)
    db.refresh(site)
    db.refresh(db_token)

    # Audit
    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_id,
        title="ESCO onboarding bootstrap completed",
        description=(
            f"client_org_id={client_org.id}; client_org_name={client_org.name}; "
            f"client_org_created={client_org_created}; "
            f"site_id={site.id}; site_name={site.name}; site_created={site_created}; "
            f"token_id={db_token.id}; managing_org_id={managing_org_id}"
        ),
    )

    site_id_str = f"site-{site.id}"

    next_steps = [
        f"Push energy data using your integration token via: POST /api/v1/timeseries/batch",
        f"Use site_id='{site_id_str}' in your timeseries records.",
        f"Invite client org users via: POST /api/v1/manage/client-orgs/{client_org.id}/invite-user",
        f"View portfolio dashboard at: GET /api/v1/manage/portfolio",
        f"Download client report at: GET /api/v1/manage/client-orgs/{client_org.id}/report/pdf",
    ]

    return BootstrapOut(
        managing_org_id=managing_org_id,
        managing_org_name=managing_org.name,
        client_org_id=client_org.id,
        client_org_name=client_org.name,
        client_org_created=client_org_created,
        site=BootstrappedSiteOut(
            id=site.id,
            name=site.name,
            location=site.location,
            site_id=site_id_str,
        ),
        site_created=site_created,
        integration_token=BootstrappedTokenOut(
            id=db_token.id,
            name=db_token.name,
            token=raw_token,
        ),
        next_steps=next_steps,
    )


# ---------------------------------------------------------------------------
# 2. Invite client org user
# ---------------------------------------------------------------------------

@router.post(
    "/client-orgs/{client_org_id}/invite-user",
    response_model=InviteClientUserOut,
    status_code=status.HTTP_201_CREATED,
)
def invite_client_org_user(
    client_org_id: int,
    payload: InviteClientUserIn,
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep()),
) -> InviteClientUserOut:
    """
    Invite a user to join a specific client org.

    The invited user receives a token (which you send via email / your own
    notification system) and signs up via:
      POST /api/v1/org/invites/accept-and-signup

    The user joins the client org directly — they will not have access to
    the managing org or any other client org.

    Roles: "member" (default) or "owner"
    """
    managing_org_id = _get_managing_org_id(org_context)
    actor_id = _actor_user_id(org_context)

    client_org = _get_client_org_or_404(db, client_org_id, managing_org_id)

    # Validate email
    email_raw = (payload.email or "").strip()
    if not email_raw or "@" not in email_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_EMAIL", "message": "Invalid email address."},
        )
    email_norm = normalize_email(email_raw)

    # Validate role
    role = (payload.role or "member").strip().lower()
    if role not in {"member", "owner"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_ROLE", "message": "role must be 'member' or 'owner'."},
        )

    # Check user isn't already in this client org
    existing_user = (
        db.query(User)
        .filter(User.email == email_norm, User.organization_id == client_org_id)
        .first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "USER_ALREADY_IN_ORG",
                "message": f"{email_norm} is already a member of {client_org.name}.",
            },
        )

    now = _now_utc()
    expires_at = now + timedelta(days=payload.expires_in_days)

    # Upsert invite (reuse existing if present for this email + client org)
    existing_invite = (
        db.query(OrgInvite)
        .filter(
            OrgInvite.organization_id == client_org_id,
            OrgInvite.email == email_norm,
        )
        .first()
    )

    raw_token = generate_invite_token()
    token_hash = hash_invite_token(raw_token)

    if existing_invite:
        existing_invite.role = role
        existing_invite.expires_at = expires_at
        existing_invite.is_active = True
        existing_invite.revoked_at = None
        existing_invite.token_hash = token_hash
        existing_invite.created_by_user_id = actor_id
        db.add(existing_invite)
        db.commit()
        db.refresh(existing_invite)
        invite = existing_invite
    else:
        invite = OrgInvite(
            organization_id=client_org_id,
            email=email_norm,
            token_hash=token_hash,
            role=role,
            expires_at=expires_at,
            is_active=True,
            created_by_user_id=actor_id,
        )
        db.add(invite)
        db.commit()
        db.refresh(invite)

    create_org_audit_event(
        db,
        org_id=managing_org_id,
        user_id=actor_id,
        title="Client org user invited",
        description=(
            f"invite_id={invite.id}; email={email_norm}; role={role}; "
            f"client_org_id={client_org_id}; client_org_name={client_org.name}; "
            f"expires_at={expires_at.isoformat()}"
        ),
    )

    return InviteClientUserOut(
        invite_id=invite.id,
        email=email_norm,
        role=role,
        client_org_id=client_org_id,
        client_org_name=client_org.name,
        expires_at=expires_at,
        token=raw_token,
        accept_url_hint="POST /api/v1/org/invites/accept-and-signup with {token, email, password, full_name}",
    )


# ---------------------------------------------------------------------------
# 3. Onboarding status
# ---------------------------------------------------------------------------

@router.get(
    "/onboarding/status",
    response_model=OnboardingStatusOut,
)
def get_onboarding_status(
    db: Session = Depends(get_db),
    org_context: OrgContext = Depends(get_org_context),
    managing_org: Organization = Depends(require_managing_org_dep(check_subscription=False)),
) -> OnboardingStatusOut:
    """
    Onboarding checklist for the managing org.

    Returns the completion status of each onboarding step. Subscription
    check is intentionally bypassed so an ESCO can always check their
    status even during a billing lapse.

    Steps checked:
      1. managing_org_configured   — org_type is "managing"
      2. subscription_active       — subscription_status is active/trialing
      3. first_client_created      — at least one client org exists
      4. first_site_created        — at least one site exists across all client orgs
      5. first_token_created       — at least one integration token exists
      6. first_data_ingested       — at least one timeseries record exists
      7. first_user_invited        — at least one accepted invite in a client org
    """
    managing_org_id = _get_managing_org_id(org_context)
    now = datetime.utcnow()

    # Fetch all client orgs
    client_orgs = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .all()
    )
    client_org_ids = [o.id for o in client_orgs]

    # Step 1: managing org configured
    step1_complete = (getattr(managing_org, "org_type", None) == "managing")

    # Step 2: subscription active
    sub_status = (getattr(managing_org, "subscription_status", None) or "").lower()
    step2_complete = sub_status in ACTIVE_SUBSCRIPTION_STATUSES or not sub_status  # allow empty (dev)
    step2_detail = f"subscription_status={sub_status or 'not set'}"

    # Step 3: first client org
    step3_complete = len(client_org_ids) > 0
    step3_detail = f"{len(client_org_ids)} client org(s)"

    # Step 4: first site
    site_count = 0
    if client_org_ids:
        site_count = db.query(Site).filter(Site.org_id.in_(client_org_ids)).count()
    step4_complete = site_count > 0
    step4_detail = f"{site_count} site(s) across all client orgs"

    # Step 5: first token
    token_count = 0
    if client_org_ids:
        token_count = (
            db.query(IntegrationToken)
            .filter(
                IntegrationToken.organization_id.in_(client_org_ids),
                IntegrationToken.is_active.is_(True),
            )
            .count()
        )
    step5_complete = token_count > 0
    step5_detail = f"{token_count} active integration token(s)"

    # Step 6: first data ingested
    record_count = 0
    if client_org_ids:
        record_count = (
            db.query(TimeseriesRecord)
            .filter(TimeseriesRecord.organization_id.in_(client_org_ids))
            .count()
        )
    step6_complete = record_count > 0
    step6_detail = f"{record_count:,} timeseries record(s) ingested"

    # Step 7: first user invited and accepted
    accepted_invite_count = 0
    if client_org_ids:
        accepted_invite_count = (
            db.query(OrgInvite)
            .filter(
                OrgInvite.organization_id.in_(client_org_ids),
                OrgInvite.accepted_user_id.isnot(None),
            )
            .count()
        )
    step7_complete = accepted_invite_count > 0
    step7_detail = f"{accepted_invite_count} accepted invite(s) in client orgs"

    steps = [
        OnboardingStep(
            key="managing_org_configured",
            label="Managing org configured",
            complete=step1_complete,
            detail="org_type=managing",
        ),
        OnboardingStep(
            key="subscription_active",
            label="Subscription active",
            complete=step2_complete,
            detail=step2_detail,
        ),
        OnboardingStep(
            key="first_client_created",
            label="First client org created",
            complete=step3_complete,
            detail=step3_detail,
        ),
        OnboardingStep(
            key="first_site_created",
            label="First site created",
            complete=step4_complete,
            detail=step4_detail,
        ),
        OnboardingStep(
            key="first_token_created",
            label="First integration token created",
            complete=step5_complete,
            detail=step5_detail,
        ),
        OnboardingStep(
            key="first_data_ingested",
            label="First energy data ingested",
            complete=step6_complete,
            detail=step6_detail,
        ),
        OnboardingStep(
            key="first_user_invited",
            label="First client org user invited",
            complete=step7_complete,
            detail=step7_detail,
        ),
    ]

    all_complete = all(s.complete for s in steps)

    return OnboardingStatusOut(
        managing_org_id=managing_org_id,
        managing_org_name=managing_org.name,
        all_complete=all_complete,
        steps=steps,
        generated_at=now,
    )