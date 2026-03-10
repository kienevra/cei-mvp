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

# Roles that are allowed to perform managing-org operations.
# Phase 5: "manager" is a managing-org user who can create/read/update
# client orgs and their resources but cannot perform destructive actions.
MANAGING_ROLES = {"owner", "manager"}

# Subscription statuses that allow active use of the managing org features.
ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing"}


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


def require_manager_role(
    current_user: User,
    *,
    message: str = "Only organization owners or managers can perform this action.",
) -> None:
    """
    Phase 5: Owner-or-manager guard for managing org operations.

    Allows:
    - superusers (legacy back-compat)
    - role == "owner"
    - role == "manager"  ← new Phase 5 role

    Blocks:
    - role == "member" (regular org member, no management rights)

    Use this guard on all /manage/ read + write endpoints.
    Use require_owner for destructive actions (delete client org, revoke token).
    """
    is_super = bool(getattr(current_user, "is_superuser", 0))
    if is_super:
        return

    role = (getattr(current_user, "role", None) or "").strip().lower()
    if role not in MANAGING_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "FORBIDDEN_MANAGER_ONLY",
                "message": message,
            },
        )


# ---------------------------------------------------------------------------
# Managing org subscription enforcement (Phase 5)
# ---------------------------------------------------------------------------

def _check_managing_org_subscription(org: Organization) -> None:
    """
    Enforce that a managing org has an active subscription before allowing
    any /manage/ operations.

    Raises HTTP 402 if the subscription is not active/trialing.

    Subscription status values:
        "active"    → allowed
        "trialing"  → allowed (grace period / pilot)
        "past_due"  → blocked (payment overdue)
        "canceled"  → blocked
        "unpaid"    → blocked
        None        → allowed (legacy / no billing configured)
    """
    sub_status = (getattr(org, "subscription_status", None) or "").strip().lower()

    # No billing configured → allow (legacy orgs, dev environments)
    if not sub_status:
        return

    if sub_status not in ACTIVE_SUBSCRIPTION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "SUBSCRIPTION_INACTIVE",
                "message": (
                    f"Your managing organization's subscription is '{sub_status}'. "
                    "An active or trialing subscription is required to manage client organizations. "
                    "Please update your billing details."
                ),
            },
        )


# ---------------------------------------------------------------------------
# Managing org dependency (Phase 2 + Phase 5 hardened)
# ---------------------------------------------------------------------------

def _check_managing_org(
    db: Session,
    org_context: OrgContext,
    message: str = "This action requires a managing organization account.",
    *,
    check_subscription: bool = True,
    require_role: Optional[str] = None,  # None = no user role check (integration token path)
) -> Organization:
    """
    Internal implementation for require_managing_org_dep.

    Phase 2: Validates org_type == "managing".
    Phase 5: Also enforces subscription status and optional user role.
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

    # Validate org_type
    org_type = getattr(managing_org, "org_type", "standalone") or "standalone"
    if org_type != "managing":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOT_A_MANAGING_ORG",
                "message": message,
            },
        )

    # Phase 5: Subscription enforcement
    if check_subscription:
        _check_managing_org_subscription(managing_org)

    # Phase 5: User role enforcement (skipped for integration token auth)
    if require_role and org_context.auth_type == "user" and org_context.user:
        user = org_context.user
        is_super = bool(getattr(user, "is_superuser", 0))
        if not is_super:
            role = (getattr(user, "role", None) or "").strip().lower()
            if require_role == "manager_or_owner":
                if role not in MANAGING_ROLES:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail={
                            "code": "FORBIDDEN_MANAGER_ONLY",
                            "message": (
                                "Only organization owners or managers can perform this action. "
                                "Ask your org owner to assign you the 'manager' role."
                            ),
                        },
                    )
            elif require_role == "owner":
                if role != "owner":
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail={
                            "code": "FORBIDDEN_OWNER_ONLY",
                            "message": "Only the organization owner can perform this action.",
                        },
                    )

    return managing_org


class require_managing_org_dep:
    """
    FastAPI dependency that validates the authenticated org is a managing org.

    Phase 5 hardened:
    - Checks org_type == "managing"
    - Checks subscription_status is active/trialing (402 if not)
    - Checks user role if auth_type == "user" (integration tokens bypass role check)

    Parameters:
        message          Custom 403 message.
        check_subscription   Default True. Set False for read-only health checks
                              that should work even if subscription lapses.
        require_role     "manager_or_owner" (default) | "owner" | None
                         Controls which user roles can use this endpoint.

    Usage — standard (owner or manager allowed):
        managing_org: Organization = Depends(require_managing_org_dep())

    Usage — destructive (owner only):
        managing_org: Organization = Depends(require_managing_org_dep(require_role="owner"))

    Usage — inline check:
        managing_org = require_managing_org_dep.check(db, org_context)
    """

    def __init__(
        self,
        message: str = "This action requires a managing organization account.",
        check_subscription: bool = True,
        require_role: Optional[str] = "manager_or_owner",
    ):
        self.message = message
        self.check_subscription = check_subscription
        self.require_role = require_role

    def __call__(
        self,
        db: Session = Depends(get_db),
        org_context: OrgContext = Depends(get_org_context),
    ) -> Organization:
        return _check_managing_org(
            db,
            org_context,
            self.message,
            check_subscription=self.check_subscription,
            require_role=self.require_role,
        )

    @staticmethod
    def check(
        db: Session,
        org_context: OrgContext,
        message: str = "This action requires a managing organization account.",
        check_subscription: bool = True,
        require_role: Optional[str] = "manager_or_owner",
    ) -> Organization:
        """
        Synchronous helper for use inside endpoint bodies where you already
        have db and org_context in scope.
        """
        return _check_managing_org(
            db,
            org_context,
            message,
            check_subscription=check_subscription,
            require_role=require_role,
        )


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
        For managing org delegated requests, pass org_context instead of user
        so organization_id resolves to the target client org automatically.

    Usage:
        query = db.query(TimeseriesRecord).filter(...)
        query = apply_org_scope_to_timeseries_query(query, db, user)

    Or with org_context for delegated requests:
        query = apply_org_scope_to_timeseries_query(query, db, org_context)
    """
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        return query

    allowed = get_org_allowed_site_ids(db, org_id)
    if not allowed:
        return query.filter(TimeseriesRecord.site_id == "__no_such_site__")

    return query.filter(TimeseriesRecord.site_id.in_(allowed))