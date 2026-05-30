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

    The last owner cannot simply "leave" (that would orphan the org),
    so this endpoint lets them delete everything cleanly:

      - All timeseries records for org sites
      - All alert events + site events
      - All org invites + integration tokens
      - All sites (FK cascade handles child rows)
      - All users in the org (including the caller)
      - The org record itself

    Rules:
      - User must be attached to an org (400 NO_ORG if not)
      - User must be role=owner (403 if not)
      - Non-last-owners should use POST /org/leave instead
        (this endpoint works for any owner but is intended for the last one)
    """
    from app.models import (
        Site, TimeseriesRecord, SiteEvent, AlertEvent,
        IntegrationToken, OrgInvite, Subscription,
    )
    from typing import Set

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

    # ── Collect site keys for timeseries deletion (no FK) ────────────────────
    site_rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    site_keys: Set[str] = set()
    for (sid,) in site_rows:
        site_keys.add(f"site-{sid}")
        site_keys.add(str(sid))

    user_rows = db.query(User).filter(User.organization_id == org_id).all()
    user_ids = [u.id for u in user_rows]

    # ── Audit before destruction ──────────────────────────────────────────────
    create_org_audit_event(
        db,
        org_id=org_id,
        user_id=getattr(current_user, "id", None),
        title="Account self-deletion initiated",
        description=(
            f"email={current_user.email}; org={org.name}; "
            f"users={len(user_ids)}; sites={len(site_rows)}"
        ),
    )

    # ── Delete in safe order ──────────────────────────────────────────────────

    # 1. Timeseries (no FK, key-based)
    if site_keys:
        db.query(TimeseriesRecord).filter(
            TimeseriesRecord.site_id.in_(site_keys)
        ).delete(synchronize_session=False)

    # 2. Event streams
    db.query(AlertEvent).filter(
        AlertEvent.organization_id == org_id
    ).delete(synchronize_session=False)

    db.query(SiteEvent).filter(
        SiteEvent.organization_id == org_id
    ).delete(synchronize_session=False)

    # 3. Invites + tokens
    db.query(OrgInvite).filter(
        OrgInvite.organization_id == org_id
    ).delete(synchronize_session=False)

    db.query(IntegrationToken).filter(
        IntegrationToken.organization_id == org_id
    ).delete(synchronize_session=False)

    # 4. Subscriptions (user_id keyed)
    if user_ids:
        db.query(Subscription).filter(
            Subscription.user_id.in_(user_ids)
        ).delete(synchronize_session=False)

    # 5. Sites (FK cascade handles child rows)
    db.query(Site).filter(Site.org_id == org_id).delete(synchronize_session=False)

    # 6. Users
    db.query(User).filter(
        User.organization_id == org_id
    ).delete(synchronize_session=False)

    # 7. Org
    db.delete(org)
    db.commit()

    return {
        "deleted": True,
        "org_id": org_id,
        "org_name": org.name,
        "note": "Account and all associated data have been permanently deleted.",
    }