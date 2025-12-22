# backend/app/api/v1/org_leave.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import create_org_audit_event
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Organization, User

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
                User.is_active == 1,
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
