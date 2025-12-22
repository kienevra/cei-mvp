from __future__ import annotations

from typing import Any, List, Optional, Literal, Dict

from fastapi import APIRouter, Depends, HTTPException, status, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_owner, create_org_audit_event
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import User

router = APIRouter(prefix="/org", tags=["org"])


# ----------------------------
# Schemas
# ----------------------------

class OrgMemberOut(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    role: str
    is_active: Optional[int] = None
    created_at: Optional[Any] = None  # keep permissive; DB type varies

    model_config = {"extra": "ignore"}


class UpdateMemberRoleIn(BaseModel):
    role: Literal["owner", "member"] = Field(..., description="Target role for the user")
    model_config = {"extra": "forbid"}


class UpdateMemberRoleOut(BaseModel):
    id: int
    email: str
    role: str

    model_config = {"extra": "ignore"}


class LeaveOrgOut(BaseModel):
    detached: bool
    user_id: int
    email: str
    previous_org_id: int

    model_config = {"extra": "ignore"}


# ----------------------------
# Helpers
# ----------------------------

def _require_org_context(user: User) -> int:
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_ORG", "message": "User is not associated with an organization."},
        )
    return int(org_id)


def _normalize_role(v: Any) -> str:
    return (str(v).strip().lower() if v is not None else "")


def _count_owners(db: Session, org_id: int) -> int:
    return (
        db.query(User)
        .filter(User.organization_id == org_id, User.role == "owner")
        .count()
    )


def _detach_user_from_org(db: Session, *, user: User) -> None:
    """
    Detach a user from their org. Keeps the account, removes tenancy link.
    """
    user.organization_id = None
    # Avoid "owner without org" weirdness
    user.role = "member"
    db.add(user)


# ----------------------------
# Routes
# ----------------------------

@router.get("/members", response_model=List[OrgMemberOut], status_code=status.HTTP_200_OK)
def list_org_members(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[OrgMemberOut]:
    """
    List members in the current user's org.

    Owner-only (keeps surface area tight; you can relax to member-readable later).
    """
    org_id = _require_org_context(current_user)
    require_owner(current_user, message="Owner-only. Only an org owner can view org members.")

    rows = (
        db.query(User)
        .filter(User.organization_id == org_id)
        .order_by(User.id.asc())
        .all()
    )

    return [
        OrgMemberOut(
            id=u.id,
            email=u.email,
            full_name=getattr(u, "full_name", None),
            role=(getattr(u, "role", None) or "member"),
            is_active=getattr(u, "is_active", None),
            created_at=getattr(u, "created_at", None),
        )
        for u in rows
    ]


@router.patch(
    "/members/{user_id}/role",
    response_model=UpdateMemberRoleOut,
    status_code=status.HTTP_200_OK,
)
def update_org_member_role(
    user_id: int,
    payload: UpdateMemberRoleIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UpdateMemberRoleOut:
    """
    Transfer ownership / change roles inside an org.

    Owner-only.

    Guardrails:
      - Target user must be in same org
      - Cannot demote the last remaining owner
      - Audited via org audit events
    """
    org_id = _require_org_context(current_user)
    require_owner(current_user, message="Owner-only. Only an org owner can change member roles.")

    target = (
        db.query(User)
        .filter(User.id == user_id, User.organization_id == org_id)
        .first()
    )
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "USER_NOT_FOUND", "message": "User not found in this organization."},
        )

    new_role = _normalize_role(payload.role)
    if new_role not in ("owner", "member"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_ROLE", "message": "role must be 'owner' or 'member'."},
        )

    old_role = _normalize_role(getattr(target, "role", None) or "member")
    if old_role == new_role:
        return UpdateMemberRoleOut(id=target.id, email=target.email, role=old_role)

    # Guardrail: prevent demoting the last owner (including self)
    if old_role == "owner" and new_role == "member":
        owner_count = _count_owners(db, org_id)
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "LAST_OWNER_CANNOT_DEMOTE",
                    "message": "You are trying to remove the last org owner. Promote another owner first.",
                },
            )

    # Apply role change
    target.role = new_role
    db.add(target)
    db.commit()
    db.refresh(target)

    # Audit
    create_org_audit_event(
        db,
        org_id=org_id,
        user_id=getattr(current_user, "id", None),
        title="Organization member role updated",
        description=f"user_id={target.id}; email={target.email}; role: {old_role} -> {new_role}",
    )

    return UpdateMemberRoleOut(id=target.id, email=target.email, role=new_role)


@router.delete(
    "/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def detach_org_member(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """
    Detach a user from the org (remove membership but keep account).

    Owner-only.

    Guardrails:
      - Target must be in same org
      - Cannot detach the last remaining owner
    """
    org_id = _require_org_context(current_user)
    require_owner(current_user, message="Owner-only. Only an org owner can detach members.")

    target = (
        db.query(User)
        .filter(User.id == user_id, User.organization_id == org_id)
        .first()
    )
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "USER_NOT_FOUND", "message": "User not found in this organization."},
        )

    target_role = _normalize_role(getattr(target, "role", None) or "member")
    if target_role == "owner":
        owner_count = _count_owners(db, org_id)
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "LAST_OWNER_CANNOT_DETACH",
                    "message": "You are trying to detach the last org owner. Promote another owner first.",
                },
            )

    _detach_user_from_org(db, user=target)
    db.commit()

    create_org_audit_event(
        db,
        org_id=org_id,
        user_id=getattr(current_user, "id", None),
        title="Organization member detached",
        description=f"user_id={target.id}; email={target.email}; previous_role={target_role}",
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/leave",
    response_model=LeaveOrgOut,
    status_code=status.HTTP_200_OK,
)
def leave_org(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LeaveOrgOut:
    """
    Self-detach from your current org (keeps account).

    Guardrail:
      - If you are an owner, you cannot leave if you are the last owner.
    """
    org_id = _require_org_context(current_user)

    my_role = _normalize_role(getattr(current_user, "role", None) or "member")
    if my_role == "owner":
        owner_count = _count_owners(db, org_id)
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "LAST_OWNER_CANNOT_LEAVE",
                    "message": "You are the last org owner. Promote another owner or offboard the org first.",
                },
            )

    prev_org_id = org_id
    email = getattr(current_user, "email", "")
    uid = int(getattr(current_user, "id", 0) or 0)

    _detach_user_from_org(db, user=current_user)
    db.commit()

    create_org_audit_event(
        db,
        org_id=prev_org_id,
        user_id=uid,
        title="Organization member left org",
        description=f"user_id={uid}; email={email}; previous_role={my_role}",
    )

    return LeaveOrgOut(detached=True, user_id=uid, email=email, previous_org_id=prev_org_id)
