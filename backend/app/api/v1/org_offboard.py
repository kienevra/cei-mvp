# backend/app/api/v1/org_offboard.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set, List, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_owner, create_org_audit_event
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import (
    Organization,
    User,
    Site,
    TimeseriesRecord,
    SiteEvent,
    AlertEvent,
    IntegrationToken,
    OrgInvite,
    Subscription,
)

router = APIRouter(prefix="/org", tags=["org"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_superuser(user: User) -> bool:
    return bool(getattr(user, "is_superuser", 0))


def _require_org_context(user: User) -> int:
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_ORG", "message": "User is not associated with an organization."},
        )
    return int(org_id)


def _org_allowed_site_keys(db: Session, org_id: int) -> Set[str]:
    """
    TimeseriesRecord.site_id uses keys like:
      - "site-{id}"
      - or raw numeric string "1"
    We delete both forms for all org sites.
    """
    rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    allowed: Set[str] = set()
    for (sid,) in rows:
        allowed.add(f"site-{sid}")
        allowed.add(str(sid))
    return allowed


def _resolve_target_org_id(current_user: User, org_id: Optional[int]) -> int:
    """
    Resolve which org to offboard.

    - If org_id is provided: use it.
      * Superuser can operate even if detached.
      * Non-superuser must belong to that org (and be owner).
    - If org_id is not provided: require org context from current_user.
    """
    if org_id is not None:
        try:
            return int(org_id)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "INVALID_ORG_ID", "message": "org_id must be an integer."},
            )

    return _require_org_context(current_user)


def _authorize_offboard(current_user: User, target_org_id: int) -> None:
    """
    Authorization model:

    - Superuser: always allowed (admin cleanup).
    - Otherwise: user must belong to the target org and be owner.
    """
    if _is_superuser(current_user):
        return

    user_org_id = getattr(current_user, "organization_id", None)
    if not user_org_id or int(user_org_id) != int(target_org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "FORBIDDEN_CROSS_ORG",
                "message": "You can only offboard your own organization.",
            },
        )

    require_owner(current_user, message="Owner-only. Only an org owner can offboard the organization.")


@router.delete(
    "/offboard",
    status_code=status.HTTP_200_OK,
)
def offboard_organization(
    mode: Literal["soft", "nuke"] = "soft",
    org_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Owner-only org offboarding.

    Supports admin/superuser cleanup by specifying org_id.

    mode="soft":
      - Revoke invites
      - Deactivate integration tokens
      - Detach all users from org (including owner)
      - Clear org billing/Stripe fields + plan flags (optional cleanup)
      - Keep Organization row

    mode="nuke":
      - Delete org + org-scoped objects:
          * sites (FK cascade should handle sensors/opportunities/reports)
          * org invites
          * integration tokens
          * site_events / alert_events
          * subscriptions (via org users)
          * timeseries rows for org sites (TimeseriesRecord has no FK)
          * users in org
          * organization row

    Returns a summary payload so the caller can confirm impact.
    """
    target_org_id = _resolve_target_org_id(current_user, org_id)
    _authorize_offboard(current_user, target_org_id)

    org = db.query(Organization).filter(Organization.id == target_org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ORG_NOT_FOUND", "message": "Organization not found."},
        )

    # Snapshot counts up front
    user_rows: List[User] = db.query(User).filter(User.organization_id == target_org_id).all()
    user_ids = [u.id for u in user_rows]
    site_count = db.query(Site).filter(Site.org_id == target_org_id).count()
    invite_count = db.query(OrgInvite).filter(OrgInvite.organization_id == target_org_id).count()
    token_count = db.query(IntegrationToken).filter(IntegrationToken.organization_id == target_org_id).count()
    site_event_count = db.query(SiteEvent).filter(SiteEvent.organization_id == target_org_id).count()
    alert_event_count = db.query(AlertEvent).filter(AlertEvent.organization_id == target_org_id).count()

    # Timeseries is key-based; compute allowed keys for this org
    allowed_site_keys = _org_allowed_site_keys(db, target_org_id)
    ts_count = 0
    if allowed_site_keys:
        ts_count = (
            db.query(TimeseriesRecord)
            .filter(TimeseriesRecord.site_id.in_(allowed_site_keys))
            .count()
        )

    actor = f"user_id={getattr(current_user,'id',None)}; email={getattr(current_user,'email',None)}; super={int(_is_superuser(current_user))}"

    # Best-effort audit event BEFORE doing destructive operations
    create_org_audit_event(
        db,
        org_id=target_org_id,
        user_id=getattr(current_user, "id", None),
        title="Organization offboard started",
        description=f"mode={mode}; actor={actor}; users={len(user_ids)}; sites={site_count}; timeseries={ts_count}; invites={invite_count}; tokens={token_count}",
    )

    if mode == "soft":
        now = _now_utc()

        # Revoke invites (soft revoke)
        db.query(OrgInvite).filter(OrgInvite.organization_id == target_org_id).update(
            {"is_active": False, "revoked_at": now},
            synchronize_session=False,
        )

        # Deactivate integration tokens
        db.query(IntegrationToken).filter(IntegrationToken.organization_id == target_org_id).update(
            {"is_active": False},
            synchronize_session=False,
        )

        # Detach users from org
        for u in user_rows:
            u.organization_id = None
            u.role = "member"
            db.add(u)

        # Clear org billing fields (optional, but aligns with “company is out”)
        org.subscription_plan_key = None
        org.subscription_status = None
        org.plan_key = None
        org.enable_alerts = False
        org.enable_reports = False
        org.stripe_customer_id = None
        org.stripe_subscription_id = None
        org.stripe_status = None
        org.billing_email = None
        db.add(org)

        db.commit()

        create_org_audit_event(
            db,
            org_id=target_org_id,
            user_id=getattr(current_user, "id", None),
            title="Organization offboard completed",
            description=f"mode=soft; actor={actor}; invites revoked; tokens deactivated; users detached; billing cleared",
        )

        return {
            "mode": "soft",
            "org_id": target_org_id,
            "org_name": getattr(org, "name", None),
            "detached_user_count": len(user_ids),
            "revoked_invite_count": invite_count,
            "deactivated_token_count": token_count,
            "note": "Org record retained. Users are detached and can be re-used for another org.",
        }

    if mode == "nuke":
        # 1) Delete timeseries rows for org sites (manual; no FK)
        if allowed_site_keys:
            db.query(TimeseriesRecord).filter(TimeseriesRecord.site_id.in_(allowed_site_keys)).delete(
                synchronize_session=False
            )

        # 2) Delete org-level event streams
        db.query(AlertEvent).filter(AlertEvent.organization_id == target_org_id).delete(synchronize_session=False)
        db.query(SiteEvent).filter(SiteEvent.organization_id == target_org_id).delete(synchronize_session=False)

        # 3) Delete org invites + integration tokens
        db.query(OrgInvite).filter(OrgInvite.organization_id == target_org_id).delete(synchronize_session=False)
        db.query(IntegrationToken).filter(IntegrationToken.organization_id == target_org_id).delete(synchronize_session=False)

        # 4) Delete subscriptions for org users (Subscription is user_id keyed)
        if user_ids:
            db.query(Subscription).filter(Subscription.user_id.in_(user_ids)).delete(synchronize_session=False)

        # 5) Delete sites (FK cascade should handle child rows)
        db.query(Site).filter(Site.org_id == target_org_id).delete(synchronize_session=False)

        # 6) Delete users in org
        db.query(User).filter(User.organization_id == target_org_id).delete(synchronize_session=False)

        # 7) Delete org record
        db.delete(org)

        db.commit()

        return {
            "mode": "nuke",
            "org_id": target_org_id,
            "org_name": getattr(org, "name", None),
            "deleted": {
                "users": len(user_ids),
                "sites": site_count,
                "timeseries": ts_count,
                "invites": invite_count,
                "integration_tokens": token_count,
                "site_events": site_event_count,
                "alert_events": alert_event_count,
            },
            "note": "Org and org-scoped data removed.",
        }

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": "INVALID_MODE", "message": "mode must be 'soft' or 'nuke'."},
    )
