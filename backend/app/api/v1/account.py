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
    AccountMeOut,  # existing schema from auth.py
)
from app.models import User, Organization, SiteEvent

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

    model_config = {
        "extra": "forbid",
    }


def _require_owner(current_user: User) -> None:
    """
    Owner-only guard for org-level sensitive settings.

    - Allows superusers (legacy) to proceed.
    - Otherwise requires current_user.role == "owner".
    """
    is_super = bool(getattr(current_user, "is_superuser", 0))
    if is_super:
        return

    role = (getattr(current_user, "role", None) or "").strip().lower()
    if role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "FORBIDDEN_OWNER_ONLY",
                "message": "Only the organization owner can update organization settings.",
            },
        )


def _create_org_audit_event(
    db: Session,
    *,
    org_id: int,
    user_id: Optional[int],
    title: str,
    description: Optional[str],
) -> None:
    """
    Write an audit trail entry using SiteEvent (site_id=None) for org-level actions.
    Best-effort: audit failures should not block the main operation.
    """
    try:
        ev = SiteEvent(
            organization_id=org_id,
            site_id=None,
            type="org_event",
            related_alert_id=None,
            title=title,
            body=description,
            created_by_user_id=user_id,
        )
        db.add(ev)
        db.commit()
    except Exception:
        # Don't block the request if audit logging fails.
        db.rollback()


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

    This is PATCH-style:
      - Only the fields present in the request body are updated.
      - Others are left as-is.

    Owner-only. Returns a fresh AccountMeOut payload so the frontend can refresh its view.
    """
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not associated with an organization.",
        )

    _require_owner(current_user)

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

    # Snapshot old values for audit trail (only for fields being updated)
    before: Dict[str, Any] = {k: getattr(org, k, None) for k in data.keys()}

    # Apply updates
    for field, value in data.items():
        setattr(org, field, value)

    db.add(org)
    db.commit()
    db.refresh(org)

    # Audit trail: who changed what, when (org-level event)
    after: Dict[str, Any] = {k: getattr(org, k, None) for k in data.keys()}
    changes = []
    for k in data.keys():
        if before.get(k) != after.get(k):
            changes.append(f"{k}: {before.get(k)} -> {after.get(k)}")

    if changes:
        _create_org_audit_event(
            db,
            org_id=org_id,
            user_id=getattr(current_user, "id", None),
            title="Organization settings updated",
            description="; ".join(changes),
        )

    # Return a fresh account snapshot (same shape as /account/me)
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
        _create_org_audit_event(
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
        remaining = (
            db.query(User)
            .filter(User.organization_id == org_id)
            .count()
        )
        if remaining == 0:
            org = db.query(Organization).filter(Organization.id == org_id).first()
            if org:
                db.delete(org)
                db.commit()

    # Clear refresh cookie
    response.delete_cookie("cei_refresh_token", path="/")
