# backend/app/api/v1/org_leave.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Set

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import create_org_audit_event
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import (
    Organization, User, Site, TimeseriesRecord,
    SiteEvent, AlertEvent, IntegrationToken, OrgInvite, Subscription,
)

router = APIRouter(prefix="/org", tags=["org"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _require_org_context(user: User) -> int:
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_ORG", "message": "User is not associated with an organization."},
        )
    return int(org_id)


@router.post(
    "/leave",
    status_code=status.HTTP_200_OK,
)
def leave_organization(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Detach ONLY the current user from their organization.

    Rules:
      - If user is NOT in an org -> 400 NO_ORG
      - If user is the LAST OWNER in the org -> 409 LAST_OWNER_CANNOT_LEAVE
      - Otherwise:
          * set current_user.organization_id = None
          * set current_user.role = "member" (neutral default)
          * commit
          * return detached payload
    """
    org_id = _require_org_context(current_user)

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        # Extremely defensive: if org row is gone but user still points to it
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ORG_NOT_FOUND", "message": "Organization not found."},
        )

    role = (getattr(current_user, "role", None) or "").strip().lower()

    # If the user is an owner, ensure there is at least one other owner remaining
    if role == "owner":
        owner_count = (
            db.query(User)
            .filter(
                User.organization_id == org_id,
                User.role == "owner",
                User.is_active == True,
            )
            .count()
        )
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "LAST_OWNER_CANNOT_LEAVE",
                    "message": "You are the last org owner. Promote another owner or offboard the org first.",
                },
            )

    prev_org_id = org_id
    now = _now_utc()

    # Audit first (best effort)
    actor = f"user_id={getattr(current_user,'id',None)}; email={getattr(current_user,'email',None)}"
    create_org_audit_event(
        db,
        org_id=prev_org_id,
        user_id=getattr(current_user, "id", None),
        title="Organization leave",
        description=f"User detached self from org; actor={actor}; role={role}; at={now.isoformat()}",
    )

    # Detach the current user only
    current_user.organization_id = None
    current_user.role = "member"
    db.add(current_user)
    db.commit()

    return {
        "detached": True,
        "user_id": getattr(current_user, "id", None),
        "email": getattr(current_user, "email", None),
        "previous_org_id": prev_org_id,
    }

# ── APPEND THIS TO THE BOTTOM OF backend/app/api/v1/org_leave.py ─────────────
#
# Also add these imports at the top of org_leave.py if not already present:
#
#   from app.models import Organization, User, Site, TimeseriesRecord, SiteEvent, AlertEvent, IntegrationToken, OrgInvite, Subscription
#   from typing import Any, Dict, Set, List   ← List and Set needed
#
# The existing imports already have Organization, User, Dict, Any — add the rest.
# ---------------------------------------------------------------------------

@router.delete(
    "/account",
    status_code=status.HTTP_200_OK,
)
def delete_own_account(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Self-service account + org deletion for the last owner.
    Uses ORM queries with savepoints to safely skip missing tables.
    """
    from app.models import (
        Site, TimeseriesRecord, SiteEvent, AlertEvent,
        IntegrationToken, OrgInvite, Subscription,
        OrgLinkRequest, OrgAlertThreshold, ProductionRecord,
        ProductionIntegration, OrgEmissionsConfig, Opportunity,
        Report, Metric, StagingUpload, Sensor, Notification,
        PushSubscription, PasswordResetToken,
    )
    from sqlalchemy import text

    org_id = _require_org_context(current_user)

    role = (getattr(current_user, "role", None) or "").strip().lower()
    if role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "OWNER_ONLY",
                "message": "Only an org owner can delete the organization account.",
            },
        )

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ORG_NOT_FOUND", "message": "Organization not found."},
        )

    org_name = org.name

    # ── Collect ids ───────────────────────────────────────────────────────────
    site_rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    site_ids = [r[0] for r in site_rows]
    site_keys = set()
    for sid in site_ids:
        site_keys.add(f"site-{sid}")
        site_keys.add(str(sid))

    user_rows = db.query(User).filter(User.organization_id == org_id).all()
    user_ids = [r[0] for r in user_rows]

    def safe_orm_delete(query_fn):
        """Run a delete query using a savepoint so failures don't abort the transaction."""
        try:
            db.execute(text("SAVEPOINT sp_del"))
            query_fn()
            db.execute(text("RELEASE SAVEPOINT sp_del"))
        except Exception as exc:
            db.execute(text("ROLLBACK TO SAVEPOINT sp_del"))
            logger.warning("safe_orm_delete skipped: %s", str(exc)[:120])

    # ── Delete in FK-safe order ───────────────────────────────────────────────

    # 1. Timeseries (string site_id, no FK)
    if site_keys:
        safe_orm_delete(lambda: db.query(TimeseriesRecord).filter(
            TimeseriesRecord.site_id.in_(site_keys)
        ).delete(synchronize_session=False))

    # 2. Production records
    if site_ids:
        safe_orm_delete(lambda: db.query(ProductionRecord).filter(
            ProductionRecord.site_id.in_(site_ids)
        ).delete(synchronize_session=False))

    # 3. Site-scoped child tables
    if site_ids:
        for Model in (Sensor, Opportunity, Report, Metric):
            safe_orm_delete(lambda M=Model: db.query(M).filter(
                M.site_id.in_(site_ids)
            ).delete(synchronize_session=False))

    # 4. Alert events + thresholds
    safe_orm_delete(lambda: db.query(AlertEvent).filter(
        AlertEvent.organization_id == org_id
    ).delete(synchronize_session=False))

    safe_orm_delete(lambda: db.query(OrgAlertThreshold).filter(
        OrgAlertThreshold.organization_id == org_id
    ).delete(synchronize_session=False))

    # 5. Site events
    safe_orm_delete(lambda: db.query(SiteEvent).filter(
        SiteEvent.organization_id == org_id
    ).delete(synchronize_session=False))

    # 6. Invites + tokens
    safe_orm_delete(lambda: db.query(OrgInvite).filter(
        OrgInvite.organization_id == org_id
    ).delete(synchronize_session=False))

    safe_orm_delete(lambda: db.query(IntegrationToken).filter(
        IntegrationToken.organization_id == org_id
    ).delete(synchronize_session=False))

    # 7. Org link requests (both sides)
    safe_orm_delete(lambda: db.query(OrgLinkRequest).filter(
        (OrgLinkRequest.managing_org_id == org_id) |
        (OrgLinkRequest.client_org_id == org_id)
    ).delete(synchronize_session=False))

    # 8. Emissions config
    safe_orm_delete(lambda: db.query(OrgEmissionsConfig).filter(
        OrgEmissionsConfig.organization_id == org_id
    ).delete(synchronize_session=False))

    # 9. Production integrations
    safe_orm_delete(lambda: db.query(ProductionIntegration).filter(
        ProductionIntegration.organization_id == org_id
    ).delete(synchronize_session=False))

    # 10. Staging uploads
    safe_orm_delete(lambda: db.query(StagingUpload).filter(
        StagingUpload.organization_id == org_id
    ).delete(synchronize_session=False))

    # 11. Forecast cache
    safe_orm_delete(lambda: db.execute(
        text("DELETE FROM forecast_cache WHERE organization_id = :org_id"),
        {"org_id": org_id}
    ))

    # 12. User-scoped tables
    if user_ids:
        safe_orm_delete(lambda: db.query(Notification).filter(
            Notification.user_id.in_(user_ids)
        ).delete(synchronize_session=False))

        safe_orm_delete(lambda: db.query(PushSubscription).filter(
            PushSubscription.user_id.in_(user_ids)
        ).delete(synchronize_session=False))

        safe_orm_delete(lambda: db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id.in_(user_ids)
        ).delete(synchronize_session=False))

        safe_orm_delete(lambda: db.query(Subscription).filter(
            Subscription.user_id.in_(user_ids)
        ).delete(synchronize_session=False))

    # 13. Sites
    safe_orm_delete(lambda: db.query(Site).filter(
        Site.org_id == org_id
    ).delete(synchronize_session=False))

    # 14. Users
    safe_orm_delete(lambda: db.query(User).filter(
        User.organization_id == org_id
    ).delete(synchronize_session=False))

    # 15. Org — direct delete (must succeed)
    db.delete(org)
    db.commit()

    return {
        "deleted": True,
        "org_id": org_id,
        "org_name": org_name,
        "note": "Account and all associated data have been permanently deleted.",
    }