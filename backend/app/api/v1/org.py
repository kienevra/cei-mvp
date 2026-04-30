# backend/app/api/v1/org.py
from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import create_org_audit_event, require_owner, get_current_active_user
from sqlalchemy import func
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Organization, OrgLinkRequest, User
router = APIRouter(prefix="/org", tags=["org"])


# ----------------------------
# Schemas
# ----------------------------

class OrgCreateIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)

    model_config = {"extra": "forbid"}


class OrgOut(BaseModel):
    id: int
    name: str

    model_config = {"extra": "ignore"}


class OrgCreateOut(BaseModel):
    org: OrgOut
    user: Dict[str, Any]  # keep permissive; your /account/me schema may evolve

    model_config = {"extra": "ignore"}


class OrgDetailOut(BaseModel):
    """
    Extended org representation that includes managing-org hierarchy fields.
    Returned by upgrade/downgrade endpoints so the caller sees the full
    updated state without needing a separate GET /auth/me round-trip.
    """
    id: int
    name: str
    org_type: str
    managed_by_org_id: Optional[int] = None
    client_limit: Optional[int] = None

    model_config = {"extra": "ignore"}


class UpgradeToManagingIn(BaseModel):
    """
    Payload for POST /org/upgrade-to-managing.

    client_limit:
        Optional ceiling on how many client orgs this managing org can create.
        Omit (or pass null) for unlimited.  Typically set by plan tier:
            - cei-starter  → 5
            - cei-growth   → 25
            - cei-pro      → null (unlimited)
    """
    client_limit: Optional[int] = Field(
        default=None,
        ge=1,
        description="Max client orgs allowed. Null = unlimited.",
    )

    model_config = {"extra": "forbid"}


class DowngradeToStandaloneIn(BaseModel):
    """
    Payload for POST /org/downgrade-to-standalone.

    confirm:
        Must be True to proceed. Prevents accidental downgrades via
        misconfigured API calls.
    """
    confirm: bool = Field(
        ...,
        description="Must be true to confirm the downgrade.",
    )

    model_config = {"extra": "forbid"}


# ----------------------------
# Internal helpers
# ----------------------------

def _get_org_or_404(db: Session, org_id: int) -> Organization:
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ORG_NOT_FOUND", "message": "Organization not found."},
        )
    return org


def _assert_user_has_org(user: User) -> int:
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "NO_ORG",
                "message": "User is not attached to an organization.",
            },
        )
    return org_id


# ----------------------------
# Routes
# ----------------------------

@router.post("", response_model=OrgCreateOut, status_code=status.HTTP_201_CREATED)
def create_org_and_attach_owner(
    payload: OrgCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrgCreateOut:
    """
    Create a new Organization and attach the current user as its OWNER.

    Guardrails:
    - Caller must NOT already belong to an org (prevents accidental cross-tenant moves).
    - Org name must be unique (Organization.name has unique=True).
    - Caller becomes role='owner' and is_active=1 (if field exists).

    Why this exists:
    - After soft-offboard / member detach, you need a clean on-ramp
      that doesn't require DB hacks.
    """
    # If user already has an org, block. (Use offboard / transfer flow instead.)
    if getattr(current_user, "organization_id", None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ALREADY_IN_ORG",
                "message": "User already belongs to an organization. Leave/offboard before creating a new org.",
            },
        )

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_ORG_NAME", "message": "Organization name is required."},
        )

    org = Organization(name=name)
    db.add(org)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORG_NAME_TAKEN",
                "message": "An organization with this name already exists.",
            },
        )

    db.refresh(org)

    # Attach current user
    current_user.organization_id = org.id

    # Make them owner
    try:
        current_user.role = "owner"
    except Exception:
        pass

    # Ensure active
    if hasattr(current_user, "is_active"):
        try:
            setattr(current_user, "is_active", 1)
        except Exception:
            pass

    db.add(current_user)
    db.commit()
    db.refresh(current_user)

    # Audit (best-effort)
    create_org_audit_event(
        db,
        org_id=org.id,
        user_id=getattr(current_user, "id", None),
        title="Organization created",
        description=f"org_id={org.id}; org_name={org.name}; owner_user_id={current_user.id}; owner_email={current_user.email}",
    )

    return OrgCreateOut(
        org=OrgOut(id=org.id, name=org.name),
        user={
            "id": current_user.id,
            "email": current_user.email,
            "organization_id": current_user.organization_id,
            "role": getattr(current_user, "role", None),
        },
    )


@router.post(
    "/upgrade-to-managing",
    response_model=OrgDetailOut,
    status_code=status.HTTP_200_OK,
)
def upgrade_to_managing(
    payload: UpgradeToManagingIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrgDetailOut:
    """
    Upgrade the current user's organization to a MANAGING org (ESCO/consultant).

    A managing org can:
    - Create and delete client organizations
    - Create and delete sites within client organizations
    - Set integration tokens scoped to client orgs
    - Set ghost pricing for client org energy sources
    - Push timeseries data on behalf of client orgs
    - View portfolio analytics across all client orgs
    - Manage users, integrations, and alerts for client orgs
    - Generate per-client reports

    Guardrails:
    - Caller must be the org OWNER.
    - Org must currently be "standalone" (idempotent if already "managing").
    - A "client" org cannot be upgraded to "managing" directly — it must be
      detached from its managing org first (future: offboard flow).
    - client_limit is optional; null means unlimited.
    """
    org_id = _assert_user_has_org(current_user)
    require_owner(current_user)

    org = _get_org_or_404(db, org_id)

    current_type = getattr(org, "org_type", "standalone") or "standalone"

    # Idempotent: already managing → just update client_limit if provided
    if current_type == "managing":
        if payload.client_limit is not None:
            org.client_limit = payload.client_limit
            db.add(org)
            db.commit()
            db.refresh(org)
            create_org_audit_event(
                db,
                org_id=org.id,
                user_id=getattr(current_user, "id", None),
                title="Managing org client_limit updated",
                description=f"org_id={org.id}; new_client_limit={payload.client_limit}",
            )
        return OrgDetailOut(
            id=org.id,
            name=org.name,
            org_type=org.org_type,
            managed_by_org_id=org.managed_by_org_id,
            client_limit=org.client_limit,
        )

    # Block: client orgs cannot be directly upgraded
    if current_type == "client":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORG_IS_CLIENT",
                "message": (
                    "This organization is currently managed by another org. "
                    "It must be detached before it can be upgraded to a managing org."
                ),
            },
        )

    # Upgrade: standalone → managing
    org.org_type = "managing"
    org.client_limit = payload.client_limit  # None = unlimited

    db.add(org)
    db.commit()
    db.refresh(org)

    create_org_audit_event(
        db,
        org_id=org.id,
        user_id=getattr(current_user, "id", None),
        title="Organization upgraded to managing",
        description=(
            f"org_id={org.id}; org_name={org.name}; "
            f"client_limit={payload.client_limit}; "
            f"upgraded_by={current_user.email}"
        ),
    )

    return OrgDetailOut(
        id=org.id,
        name=org.name,
        org_type=org.org_type,
        managed_by_org_id=org.managed_by_org_id,
        client_limit=org.client_limit,
    )


@router.post(
    "/downgrade-to-standalone",
    response_model=OrgDetailOut,
    status_code=status.HTTP_200_OK,
)
def downgrade_to_standalone(
    payload: DowngradeToStandaloneIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrgDetailOut:
    """
    Downgrade a managing org back to standalone.

    Safety guardrails:
    - Caller must be the org OWNER.
    - payload.confirm must be True.
    - If the managing org still has active client orgs attached, the downgrade
      is BLOCKED. All client orgs must be offboarded or detached first.
      This prevents orphaned client orgs with no managing parent.
    - Idempotent: already standalone → no-op, returns current state.
    """
    if not payload.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "CONFIRM_REQUIRED",
                "message": "Set confirm=true to proceed with the downgrade.",
            },
        )

    org_id = _assert_user_has_org(current_user)
    require_owner(current_user)

    org = _get_org_or_404(db, org_id)

    current_type = getattr(org, "org_type", "standalone") or "standalone"

    # Idempotent: already standalone → no-op
    if current_type == "standalone":
        return OrgDetailOut(
            id=org.id,
            name=org.name,
            org_type=org.org_type,
            managed_by_org_id=org.managed_by_org_id,
            client_limit=org.client_limit,
        )

    # Block downgrade if active client orgs are still attached
    client_count = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == org.id)
        .count()
    )
    if client_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "HAS_CLIENT_ORGS",
                "message": (
                    f"This managing org still has {client_count} client org(s) attached. "
                    "Offboard or detach all client orgs before downgrading."
                ),
            },
        )

    # Downgrade: managing → standalone
    org.org_type = "standalone"
    org.client_limit = None

    db.add(org)
    db.commit()
    db.refresh(org)

    create_org_audit_event(
        db,
        org_id=org.id,
        user_id=getattr(current_user, "id", None),
        title="Organization downgraded to standalone",
        description=(
            f"org_id={org.id}; org_name={org.name}; "
            f"downgraded_by={current_user.email}"
        ),
    )

    return OrgDetailOut(
        id=org.id,
        name=org.name,
        org_type=org.org_type,
        managed_by_org_id=org.managed_by_org_id,
        client_limit=org.client_limit,
    )

# ── Schemas (reuse or duplicate from manage.py as needed) ──
 
class OrgLinkRequestOut(BaseModel):
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
 
 
class OrgInitiateLinkIn(BaseModel):
    """Org owner initiates — provide the consultant firm's owner email."""
    consultant_email: EmailStr
    message: Optional[str] = None
 
 
# ── Org-owner-side endpoints ──
 
@router.post(
    "/link-requests",
    response_model=OrgLinkRequestOut,
    status_code=201,
    summary="Org owner initiates a request to be managed by a consultant",
)
def org_initiate_link_request(
    payload: OrgInitiateLinkIn,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    A standalone org owner requests to be linked to a managing (ESCO/consultant) org.
    The consultant must accept before the link is applied.
    """
    org_id = _assert_user_has_org(current_user)
    my_org = db.get(Organization, org_id)
 
    if my_org.org_type != "standalone":
        raise HTTPException(
            status_code=400,
            detail="Your organization is already linked to a consultant or is a managing org itself.",
        )
 
    # Find the consultant by email
    from app.models import User as UserModel
    consultant_user = db.query(UserModel).filter(
        func.lower(UserModel.email) == payload.consultant_email.lower(),
        UserModel.is_active == 1,
    ).first()
 
    if not consultant_user or not consultant_user.organization_id:
        raise HTTPException(status_code=404, detail="No active account found with that email address.")
 
    consultant_org = db.get(Organization, consultant_user.organization_id)
    if not consultant_org or consultant_org.org_type != "managing":
        raise HTTPException(
            status_code=400,
            detail="That account does not belong to a registered energy consultant firm.",
        )
 
    if consultant_org.id == org_id:
        raise HTTPException(status_code=400, detail="Cannot link to your own organization.")
 
    # Check for existing pending request
    # Block if there's already a pending request
    existing_pending = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.managing_org_id == consultant_org.id,
        OrgLinkRequest.client_org_id == org_id,
        OrgLinkRequest.status == "pending",
    ).first()
    if existing_pending:
        raise HTTPException(
            status_code=409,
            detail="A pending link request already exists with this consultant.",
        )

    # Delete any old non-pending records for this pair to allow re-linking
    old_reqs = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.managing_org_id == consultant_org.id,
        OrgLinkRequest.client_org_id == org_id,
    ).all()
    for r in old_reqs:
        db.delete(r)
    db.flush()
 
    req = OrgLinkRequest(
        managing_org_id=consultant_org.id,
        client_org_id=org_id,
        initiated_by="org_owner",
        status="pending",
        token=OrgLinkRequest.generate_token(),
        message=payload.message,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
 
    return OrgLinkRequestOut(
        id=req.id,
        managing_org_id=req.managing_org_id,
        managing_org_name=consultant_org.name,
        client_org_id=req.client_org_id,
        client_org_name=my_org.name,
        initiated_by=req.initiated_by,
        status=req.status,
        message=req.message,
        created_at=req.created_at,
    )
 
 
@router.get(
    "/link-requests",
    response_model=List[OrgLinkRequestOut],
    summary="Org owner lists all link requests (sent + incoming from consultants)",
)
def org_list_link_requests(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    org_id = _assert_user_has_org(current_user)
    reqs = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.client_org_id == org_id,
    ).order_by(OrgLinkRequest.created_at.desc()).all()
 
    result = []
    for req in reqs:
        managing_org = db.get(Organization, req.managing_org_id)
        client_org   = db.get(Organization, req.client_org_id)
        result.append(OrgLinkRequestOut(
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
    response_model=OrgLinkRequestOut,
    summary="Org owner accepts a consultant-initiated link request",
)
def org_accept_link_request(
    request_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    org_id = _assert_user_has_org(current_user)
 
    # Only owner can accept
    if getattr(current_user, "role", None) not in ("owner",):
        raise HTTPException(status_code=403, detail="Only the org owner can accept link requests.")
 
    req = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.id == request_id,
        OrgLinkRequest.client_org_id == org_id,
        OrgLinkRequest.initiated_by == "consultant",
        OrgLinkRequest.status == "pending",
    ).first()
 
    if not req:
        raise HTTPException(status_code=404, detail="Link request not found or not actionable.")
 
    # Apply the link
    client_org = db.get(Organization, org_id)
    client_org.managed_by_org_id = req.managing_org_id
    client_org.org_type = "client"
    req.status = "accepted"
    req.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(req)
 
    managing_org = db.get(Organization, req.managing_org_id)
    return OrgLinkRequestOut(
        id=req.id,
        managing_org_id=req.managing_org_id,
        managing_org_name=managing_org.name if managing_org else "—",
        client_org_id=req.client_org_id,
        client_org_name=client_org.name,
        initiated_by=req.initiated_by,
        status=req.status,
        message=req.message,
        created_at=req.created_at,
    )
 
 
@router.post(
    "/link-requests/{request_id}/reject",
    response_model=OrgLinkRequestOut,
    summary="Org owner rejects a consultant-initiated link request",
)
def org_reject_link_request(
    request_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    org_id = _assert_user_has_org(current_user)
    req = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.id == request_id,
        OrgLinkRequest.client_org_id == org_id,
        OrgLinkRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Link request not found.")
    req.status = "rejected"
    req.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(req)
    managing_org = db.get(Organization, req.managing_org_id)
    client_org   = db.get(Organization, req.client_org_id)
    return OrgLinkRequestOut(
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
 
 
@router.delete(
    "/link-requests/{request_id}",
    status_code=204,
    summary="Org owner cancels a link request they sent",
)
def org_cancel_link_request(
    request_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    org_id = _assert_user_has_org(current_user)
    req = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.id == request_id,
        OrgLinkRequest.client_org_id == org_id,
        OrgLinkRequest.initiated_by == "org_owner",
        OrgLinkRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Link request not found.")
    req.status = "cancelled"
    req.updated_at = datetime.utcnow()
    db.commit()


@router.post(
    "/unlink-from-consultant",
    response_model=OrgDetailOut,
    status_code=status.HTTP_200_OK,
)
def unlink_from_consultant(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrgDetailOut:
    """
    Client org owner unlinks their org from the managing consultant.
    Flips org_type back to 'standalone' and clears managed_by_org_id.
    Owner-only — destructive change to org relationship.
    """
    require_owner(current_user)
    org_id = _assert_user_has_org(current_user)
    org = _get_org_or_404(db, org_id)

    if getattr(org, "org_type", None) != "client":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "NOT_A_CLIENT_ORG",
                "message": "This organization is not currently linked to a consultant.",
            },
        )

    managing_org_id = getattr(org, "managed_by_org_id", None)

    org.org_type = "standalone"
    org.managed_by_org_id = None
    db.add(org)

    # Remove the accepted link request so the pair can be re-linked in future
    # Remove all link requests for this pair so it can be re-linked in future
    old_reqs = db.query(OrgLinkRequest).filter(
        OrgLinkRequest.client_org_id == org_id,
    ).all()
    for old_req in old_reqs:
        db.delete(old_req)

    db.commit()
    db.refresh(org)

    create_org_audit_event(
        db,
        org_id=org.id,
        user_id=getattr(current_user, "id", None),
        title="Org unlinked from consultant",
        description=(
            f"org_id={org.id}; org_name={org.name}; "
            f"previous_managing_org_id={managing_org_id}; "
            f"unlinked_by={current_user.email}"
        ),
    )

    return OrgDetailOut(
        id=org.id,
        name=org.name,
        org_type=org.org_type,
        managed_by_org_id=org.managed_by_org_id,
        client_limit=org.client_limit,
    )