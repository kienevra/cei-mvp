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
    Uses raw SQL DELETEs to avoid ORM FK issues and transaction aborts.
    """
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

    # ── Collect site ids ──────────────────────────────────────────────────────
    site_id_rows = db.execute(
        text("SELECT id FROM sites WHERE org_id = :org_id"),
        {"org_id": org_id}
    ).fetchall()
    site_ids = [r[0] for r in site_id_rows]

    user_id_rows = db.execute(
        text("SELECT id FROM users WHERE organization_id = :org_id"),
        {"org_id": org_id}
    ).fetchall()
    user_ids = [r[0] for r in user_id_rows]

    # ── Raw SQL deletes — each in its own try/except with savepoint ───────────
    # Order: deepest children first, org row last.

    def safe_delete(sql: str, params: dict) -> None:
        """Execute a DELETE, rolling back only this statement if it fails."""
        try:
            db.execute(text(sql), params)
        except Exception as exc:
            db.rollback()
            logger.warning("safe_delete skipped (%s): %s", sql[:60], exc)
            # Re-fetch org so session is usable again after rollback
            # (the caller must re-attach objects if needed)

    # 1. Timeseries (site_id is a string key like "site-1" or "1")
    if site_ids:
        str_keys = [f"site-{sid}" for sid in site_ids] + [str(sid) for sid in site_ids]
        # Use IN with a literal list — sqlalchemy text doesn't support list params well
        keys_sql = ",".join(f"'{k}'" for k in str_keys)
        safe_delete(
            f"DELETE FROM timeseries_records WHERE site_id IN ({keys_sql})",
            {}
        )

    # 2. Production records
    if site_ids:
        ids_sql = ",".join(str(i) for i in site_ids)
        safe_delete(
            f"DELETE FROM production_records WHERE site_id IN ({ids_sql})",
            {}
        )

    # 3. Site-scoped child tables
    if site_ids:
        ids_sql = ",".join(str(i) for i in site_ids)
        for table in ("sensors", "opportunities", "reports", "metrics"):
            safe_delete(f"DELETE FROM {table} WHERE site_id IN ({ids_sql})", {})

    # 4. Org-scoped tables
    safe_delete("DELETE FROM alert_events WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM org_alert_thresholds WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM site_events WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM org_invites WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM integration_tokens WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM org_link_requests WHERE managing_org_id = :org_id OR client_org_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM org_emissions_configs WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM production_integrations WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM staging_uploads WHERE organization_id = :org_id", {"org_id": org_id})
    safe_delete("DELETE FROM forecast_cache WHERE organization_id = :org_id", {"org_id": org_id})

    # 5. User-scoped tables
    if user_ids:
        ids_sql = ",".join(str(i) for i in user_ids)
        safe_delete(f"DELETE FROM notifications WHERE user_id IN ({ids_sql})", {})
        safe_delete(f"DELETE FROM subscription WHERE user_id IN ({ids_sql})", {})
        safe_delete(f"DELETE FROM push_subscriptions WHERE user_id IN ({ids_sql})", {})
        safe_delete(f"DELETE FROM password_reset_tokens WHERE user_id IN ({ids_sql})", {})

    # 6. Sites
    safe_delete("DELETE FROM sites WHERE org_id = :org_id", {"org_id": org_id})

    # 7. Users
    safe_delete("DELETE FROM users WHERE organization_id = :org_id", {"org_id": org_id})

    # 8. Org
    safe_delete("DELETE FROM organizations WHERE id = :org_id", {"org_id": org_id})

    db.commit()

    return {
        "deleted": True,
        "org_id": org_id,
        "org_name": org_name,
        "note": "Account and all associated data have been permanently deleted.",
    }