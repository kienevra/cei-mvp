# backend/app/api/v1/account.py

from __future__ import annotations

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.deps import require_owner, create_org_audit_event
from app.core.security import get_current_user  # canonical dependency (no circular import)
from app.models import User, Organization

router = APIRouter(prefix="/account", tags=["account"])


# ----------------------------
# Schemas
# ----------------------------

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


# ----------------------------
# Helpers
# ----------------------------

def _normalize_currency_code(code: Optional[str]) -> Optional[str]:
    if code is None:
        return None
    c = str(code).strip().upper()
    return c or None


def _validate_non_negative(name: str, value: Optional[float]) -> None:
    if value is None:
        return
    try:
        v = float(value)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_NUMBER", "message": f"{name} must be a number."},
        )
    if v < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_NUMBER", "message": f"{name} must be >= 0."},
        )


def _refresh_cookie_name() -> str:
    """
    Keep cookie name aligned with auth.py without importing it (avoid cycles).
    """
    try:
        from app.api.v1 import auth as auth_module  # local import to avoid import-time cycles
        return getattr(auth_module, "REFRESH_COOKIE_NAME", "cei_refresh_token")
    except Exception:
        return "cei_refresh_token"


def _build_account_me_payload(db: Session, current_user: User) -> Dict[str, Any]:
    """
    Minimal AccountMeOut-compatible payload builder.

    We intentionally keep this here to avoid importing read_me from auth.py
    (which tends to create circular imports as the app grows).
    """
    org: Optional[Organization] = None
    org_id = getattr(current_user, "organization_id", None)
    if org_id is not None:
        org = db.query(Organization).filter(Organization.id == org_id).first()

    plan_key = getattr(org, "plan_key", None) if org is not None else None
    subscription_plan_key = (
        getattr(org, "subscription_plan_key", None) if org is not None else None
    ) or plan_key or "cei-starter"

    raw_enable_alerts = getattr(org, "enable_alerts", None) if org is not None else None
    raw_enable_reports = getattr(org, "enable_reports", None) if org is not None else None

    default_enabled = subscription_plan_key in ("cei-starter", "cei-growth")

    enable_alerts = bool(raw_enable_alerts) if raw_enable_alerts is not None else default_enabled
    enable_reports = bool(raw_enable_reports) if raw_enable_reports is not None else default_enabled

    subscription_status = getattr(org, "subscription_status", None) if org is not None else None

    primary_energy_sources = getattr(org, "primary_energy_sources", None) if org is not None else None
    electricity_price_per_kwh = getattr(org, "electricity_price_per_kwh", None) if org is not None else None
    gas_price_per_kwh = getattr(org, "gas_price_per_kwh", None) if org is not None else None
    currency_code = getattr(org, "currency_code", None) if org is not None else None

    org_summary: Optional[Dict[str, Any]] = None
    if org is not None:
        org_summary = {
            "id": org.id,
            "name": org.name,
            "plan_key": plan_key,
            "subscription_plan_key": subscription_plan_key,
            "enable_alerts": enable_alerts,
            "enable_reports": enable_reports,
            "subscription_status": subscription_status,
            "primary_energy_sources": primary_energy_sources,
            "electricity_price_per_kwh": electricity_price_per_kwh,
            "gas_price_per_kwh": gas_price_per_kwh,
            "currency_code": currency_code,
        }

    is_super = bool(getattr(current_user, "is_superuser", 0))
    db_role = getattr(current_user, "role", None)
    role = "admin" if is_super else (db_role or "member")

    # AccountMeOut-compatible dict (auth.py models use orm_mode; we return json-ready dict)
    return {
        "id": current_user.id,
        "email": current_user.email,
        "organization_id": org_id,
        "full_name": getattr(current_user, "full_name", None),
        "role": role,
        "org": org_summary,
        "organization": org_summary,
        "subscription_plan_key": subscription_plan_key,
        "enable_alerts": enable_alerts,
        "enable_reports": enable_reports,
        "subscription_status": subscription_status,
        "primary_energy_sources": primary_energy_sources,
        "electricity_price_per_kwh": electricity_price_per_kwh,
        "gas_price_per_kwh": gas_price_per_kwh,
        "currency_code": currency_code,
    }


# ----------------------------
# Routes
# ----------------------------

@router.get("/me")
def get_account_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Return account + org summary payload (same shape as /auth/me historically).

    We build the payload here (instead of importing auth.read_me) to keep
    auth.py and account.py decoupled and avoid circular imports.
    """
    return _build_account_me_payload(db, current_user)


@router.patch("/org-settings")
def update_org_settings(
    payload: OrgSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Update org-level energy & tariff settings for the current user's org.

    Owner-only. Returns fresh /account/me snapshot so frontend can refresh state.
    """
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_ORG", "message": "User is not associated with an organization."},
        )

    require_owner(current_user, message="Only the organization owner can update organization settings.")

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ORG_NOT_FOUND", "message": "Organization not found."},
        )

    data: Dict[str, Any] = payload.model_dump(exclude_unset=True)
    if not data:
        return _build_account_me_payload(db, current_user)

    # Normalize / validate
    if "currency_code" in data:
        data["currency_code"] = _normalize_currency_code(data.get("currency_code"))

    _validate_non_negative("electricity_price_per_kwh", data.get("electricity_price_per_kwh"))
    _validate_non_negative("gas_price_per_kwh", data.get("gas_price_per_kwh"))

    if "primary_energy_sources" in data and data["primary_energy_sources"] is not None:
        data["primary_energy_sources"] = str(data["primary_energy_sources"]).strip() or None

    # Snapshot old values (only fields being updated)
    before: Dict[str, Any] = {k: getattr(org, k, None) for k in data.keys()}

    # Apply updates
    for field, value in data.items():
        setattr(org, field, value)

    db.add(org)
    db.commit()
    db.refresh(org)

    # Audit trail: who changed what
    after: Dict[str, Any] = {k: getattr(org, k, None) for k in data.keys()}

    changes: List[str] = []
    for k in data.keys():
        if before.get(k) != after.get(k):
            changes.append(f"{k}: {before.get(k)} -> {after.get(k)}")

    if changes:
        create_org_audit_event(
            db,
            org_id=int(org_id),
            user_id=getattr(current_user, "id", None),
            title="Organization settings updated",
            description="; ".join(changes),
        )

    return _build_account_me_payload(db, current_user)


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
            org_id=int(org_id),
            user_id=getattr(current_user, "id", None),
            title="User deleted account",
            description=f"email={getattr(current_user, 'email', None)}",
        )

    # Delete user
    db.delete(current_user)
    db.commit()

    # Cascade delete org if last user
    if org_id:
        remaining = db.query(User).filter(User.organization_id == org_id).count()
        if remaining == 0:
            org = db.query(Organization).filter(Organization.id == org_id).first()
            if org:
                db.delete(org)
                db.commit()

    # Clear refresh cookie
    response.delete_cookie(_refresh_cookie_name(), path="/")
