# backend/app/api/v1/org.py
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import create_org_audit_event
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Organization, User

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
