# backend/app/api/v1/account.py

from __future__ import annotations

from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import (
    get_current_user,
    read_me,
    AccountMeOut,
)
from app.api.deps import require_owner, create_org_audit_event
from app.models import User, Organization

router = APIRouter(prefix="/account", tags=["account"])


class OrgSettingsUpdate(BaseModel):
    """
    Minimal org-level energy & tariff settings.

    All fields are optional and PATCH-style (only provided fields are updated).
    """
    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None

    model_config = {"extra": "forbid"}


@router.get("/me", response_model=AccountMeOut)
def get_account_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AccountMeOut:
    """
    Thin wrapper around auth.read_me to keep all account/org summary
    logic centralized in auth.py.
    """
    return read_me(db=db, current_user=current_user)


@router.patch("/org-settings", response_model=AccountMeOut)
def update_org_settings(
    payload: OrgSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AccountMeOut:
    """
    Update org-level energy & tariff settings for the current user's org.

    PATCH-style:
      - Only provided fields are updated.
      - Others are left as-is.

    Owner-only. Returns a fresh AccountMeOut payload so the frontend can refresh.
    """
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not associated with an organization.",
        )

    require_owner(current_user, message="Only the organization owner can update organization settings.")

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found.",
        )

    data: Dict[str, Any] = payload.model_dump(exclude_unset=True)
    if not data:
        # No-op PATCH. Still return a fresh snapshot.
        return read_me(db=db, current_user=current_user)

    # Snapshot old values (only for fields being updated)
    before: Dict[str, Any] = {k: getattr(org, k, None) for k in data.keys()}

    # Apply updates
    for field, value in data.items():
        setattr(org, field, value)

    db.add(org)
    db.commit()
    db.refresh(org)

    # Audit trail: who changed what, when
    after: Dict[str, Any] = {k: getattr(org, k, None) for k in data.keys()}
    changes = []
    for k in data.keys():
        if before.get(k) != after.get(k):
            changes.append(f"{k}: {before.get(k)} -> {after.get(k)}")

    if changes:
        create_org_audit_event(
            db,
            org_id=org_id,
            user_id=getattr(current_user, "id", None),
            title="Organization settings updated",
            description="; ".join(changes),
        )

    return read_me(db=db, current_user=current_user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account_me(
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Delete the current user, optionally cascade deleting an empty org,
    and clear the refresh cookie.
    """
    org_id = getattr(current_user, "organization_id", None)

    # Best-effort audit (before deleting user)
    if org_id:
        create_org_audit_event(
            db,
            org_id=org_id,
            user_id=getattr(current_user, "id", None),
            title="User deleted account",
            description=f"User {getattr(current_user, 'email', None)} deleted their account.",
        )

    # Delete the user
    db.delete(current_user)
    db.commit()

    # If this was the last user in the org, delete the org as well
    if org_id:
        remaining = db.query(User).filter(User.organization_id == org_id).count()
        if remaining == 0:
            org = db.query(Organization).filter(Organization.id == org_id).first()
            if org:
                db.delete(org)
                db.commit()

    # Clear refresh cookie
    response.delete_cookie("cei_refresh_token", path="/")
