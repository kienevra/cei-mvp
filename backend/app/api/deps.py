# backend/app/api/deps.py
from __future__ import annotations

from typing import Optional, Set, Any

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import OrgContext, get_current_user, get_org_context
from app.db.session import get_db
from app.models import Organization, Site, SiteEvent, TimeseriesRecord, User


# ---------------------------------------------------------------------------
# Auth / identity helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Role guards
# ---------------------------------------------------------------------------

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


def require_managing_org(
    org_context: OrgContext,
    *,
    message: str = "This action requires a managing organization account.",
) -> Organization:
    """
    Guard for Phase 3 /manage/ endpoints.

    Ensures the AUTHENTICATED org (not the delegated target) has
    org_type == 'managing'.

    Works for both:
    - Direct managing org requests (no X-CEI-ORG-ID)
    - Delegated requests (X-CEI-ORG-ID present) — checks managing_org_id

    Returns the managing Organization object for use in the calling endpoint.

    Usage in a router:
        @router.post("/manage/client-orgs")
        def create_client_org(
            payload: ...,
            db: Session = Depends(get_db),
            org_context: OrgContext = Depends(get_org_context),
        ):
            managing_org = require_managing_org(org_context)
            ...
    """
    # Determine which org_id is the managing one:
    # - In a delegated context: managing_org_id is the authenticated managing org
    # - In a direct context: organization_id is the authenticated org
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

    # We need a DB session to load the org — callers must pass it in
    # or we resolve it via a secondary lookup. Since this is a plain function
    # (not a FastAPI dependency), the caller is responsible for passing db.
    # See require_managing_org_dep below for the FastAPI dependency variant.
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={
            "code": "USE_REQUIRE_MANAGING_ORG_DEP",
            "message": "Use require_managing_org_dep FastAPI dependency instead of calling require_managing_org directly.",
        },
    )


def _check_managing_org(
    db: Session,
    org_context: OrgContext,
    message: str = "This action requires a managing organization account.",
) -> Organization:
    """
    Internal implementation shared by require_managing_org_dep and
    endpoint-level manual checks.

    Validates the authenticated org is a managing org and returns it.
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

    managing_org = db.query(Organization).filter(Organization.id == managing_org_id).first()
    if not managing_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ORG_NOT_FOUND",
                "message": "Authenticated organization not found.",
            },
        )

    org_type = getattr(managing_org, "org_type", "standalone") or "standalone"
    if org_type != "managing":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOT_A_MANAGING_ORG",
                "message": message,
            },
        )

    return managing_org


class require_managing_org_dep:
    """
    FastAPI dependency that validates the authenticated org is a managing org.

    Inject this in any /manage/ endpoint to get the managing Organization
    object back, with full validation already done.

    Example:
        @router.post("/manage/client-orgs")
        def create_client_org(
            payload: ClientOrgCreateIn,
            db: Session = Depends(get_db),
            org_context: OrgContext = Depends(get_org_context),
            managing_org: Organization = Depends(require_managing_org_dep()),
        ):
            ...

    Or inline for endpoints that also need org_context:
        managing_org = require_managing_org_dep.check(db, org_context)
    """

    def __init__(
        self,
        message: str = "This action requires a managing organization account.",
    ):
        self.message = message

    def __call__(
        self,
        db: Session = Depends(get_db),
        org_context: OrgContext = Depends(get_org_context),
    ) -> Organization:
        return _check_managing_org(db, org_context, self.message)

    @staticmethod
    def check(
        db: Session,
        org_context: OrgContext,
        message: str = "This action requires a managing organization account.",
    ) -> Organization:
        """
        Synchronous helper for use inside endpoint bodies where you already
        have db and org_context in scope.
        """
        return _check_managing_org(db, org_context, message)


# ---------------------------------------------------------------------------
# Audit trail (org-level events)
# ---------------------------------------------------------------------------

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

    IMPORTANT: Intentionally non-blocking — if audit logging fails,
    the main operation should still succeed.
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


# ---------------------------------------------------------------------------
# Org scoping for timeseries
# ---------------------------------------------------------------------------

def get_org_allowed_site_ids(
    db: Session,
    org_id: int,
) -> Set[str]:
    """
    Compute the set of timeseries.site_id values that belong to this org.

    Supports both:
    - 'site-{id}' style keys  (canonical CEI format)
    - raw numeric string ids  ('1', '2', ...) for back-compat
    """
    site_rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    allowed: Set[str] = set()
    for (site_id,) in site_rows:
        allowed.add(f"site-{site_id}")
        allowed.add(str(site_id))
    return allowed


def apply_org_scope_to_timeseries_query(
    query: Any,
    db: Session,
    user: Any,
) -> Any:
    """
    Given a SQLAlchemy query on TimeseriesRecord, constrain it to the
    current user's organization (if any).

    Phase 2 note:
        For managing org delegated requests, the caller should pass
        org_context.organization_id (the target client org) rather than
        user.organization_id. The signature accepts any object with an
        organization_id attribute for flexibility.

    Usage in /timeseries endpoints:
        query = db.query(TimeseriesRecord).filter(...)
        query = apply_org_scope_to_timeseries_query(query, db, user)

    Or with org_context for delegated managing org requests:
        query = apply_org_scope_to_timeseries_query(query, db, org_context)
    """
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        # No org concept → single-tenant/dev, no restriction
        return query

    allowed = get_org_allowed_site_ids(db, org_id)
    if not allowed:
        # Force an empty result set
        return query.filter(TimeseriesRecord.site_id == "__no_such_site__")

    return query.filter(TimeseriesRecord.site_id.in_(allowed))