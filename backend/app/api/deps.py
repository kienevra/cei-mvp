from __future__ import annotations

from typing import Optional, Set, Any

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user  # ✅ moved out of api/v1/auth.py
from app.db.session import get_db
from app.models import User, Organization, Site, TimeseriesRecord, SiteEvent


# ----------------------------
# Auth / identity helpers
# ----------------------------

def get_current_active_user(
    user: User = Depends(get_current_user),
) -> User:
    """
    Wrapper around core.security.get_current_user.

    Future: enforce is_active here if desired.
    """
    return user


def get_current_org(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
) -> Optional[Organization]:
    """
    Resolve the Organization for the current user, if any.
    """
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        return None

    return db.query(Organization).filter(Organization.id == org_id).first()


# ----------------------------
# Roles & permissions (Step 4)
# ----------------------------

def require_owner(
    current_user: User,
    *,
    message: str = "Only the organization owner can perform this action.",
) -> None:
    """
    Owner-only guard.

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
            detail={"code": "FORBIDDEN_OWNER_ONLY", "message": message},
        )


# ----------------------------
# Audit trail (org-level events)
# ----------------------------

def create_org_audit_event(
    db: Session,
    *,
    org_id: int,
    user_id: Optional[int],
    title: str,
    description: Optional[str] = None,
) -> None:
    """
    Best-effort audit trail using SiteEvent with site_id=None.

    IMPORTANT: This is intentionally non-blocking:
    if audit logging fails, the main operation should still succeed.
    """
    try:
        ev = SiteEvent(
            organization_id=org_id,
            site_id=None,
            type="org_event",
            related_alert_id=None,
            title=title,
            body=description,
            created_by_user_id=user_id if user_id else None,
        )
        db.add(ev)
        db.commit()
    except Exception:
        db.rollback()


# ----------------------------
# Org scoping for timeseries
# ----------------------------

def get_org_allowed_site_ids(
    db: Session,
    org_id: int,
) -> Set[str]:
    """
    Compute the set of timeseries.site_id values that belong to this org.

    We support both:
    - 'site-{id}' style keys
    - raw numeric string ids ('1', '2', ...)
    """
    site_rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    allowed: Set[str] = set()
    for (site_id,) in site_rows:
        allowed.add(f"site-{site_id}")
        allowed.add(str(site_id))
    return allowed


def apply_org_scope_to_timeseries_query(
    query,
    db: Session,
    user: Any,
):
    """
    Given a SQLAlchemy query on TimeseriesRecord, constrain it to the
    current user's organization (if any).

    Usage in /timeseries endpoints:
        query = db.query(TimeseriesRecord).filter(...)
        query = apply_org_scope_to_timeseries_query(query, db, user)
    """
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        # No org concept -> single-tenant/dev, no restriction
        return query

    allowed = get_org_allowed_site_ids(db, org_id)
    if not allowed:
        # Force an empty result set
        return query.filter(TimeseriesRecord.site_id == "__no_such_site__")

    return query.filter(TimeseriesRecord.site_id.in_(allowed))
