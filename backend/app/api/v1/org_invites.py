# backend/app/api/v1/org_invites.py

from datetime import datetime, timedelta, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import User, OrgInvite, SiteEvent
from app.api.v1.auth import (
    get_current_user,
    create_access_token,
    create_refresh_token,
    _set_refresh_cookie,
)
from app.services.invites import generate_invite_token, hash_invite_token, normalize_email

router = APIRouter(prefix="/org/invites", tags=["org-invites"])


# ---------- Schemas ----------

class InviteCreateRequest(BaseModel):
    email: str
    role: Optional[str] = "member"         # "member" | "owner"
    expires_in_days: Optional[int] = 7     # default 7 days


class InviteCreateResponse(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    expires_at: datetime
    status: Literal["active", "revoked", "expired", "accepted"]
    is_accepted: bool
    is_expired: bool
    can_accept: bool
    token: Optional[str] = None  # returned ONLY when usable (not accepted)


class InviteExtendRequest(BaseModel):
    expires_in_days: Optional[int] = 7
    role: Optional[str] = None


class InviteExtendResponse(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    accepted_user_id: Optional[int] = None
    status: Literal["active", "revoked", "expired", "accepted"]
    is_accepted: bool
    is_expired: bool
    can_accept: bool
    token: Optional[str] = None  # ONLY when not accepted


class InviteAcceptSignupRequest(BaseModel):
    token: str
    email: str
    password: str
    full_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


class InviteListItem(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    accepted_user_id: Optional[int] = None
    revoked_at: Optional[datetime] = None
    created_by_user_id: Optional[int] = None

    # ✅ canonical server-side state so UI does not guess
    status: Literal["active", "revoked", "expired", "accepted"]
    is_accepted: bool
    is_expired: bool
    can_accept: bool
    can_revoke: bool
    can_extend: bool


# ---------- Helpers ----------

def _as_utc_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _audit(
    db: Session,
    *,
    org_id: int,
    user_id: Optional[int],
    title: str,
    description: Optional[str],
) -> None:
    try:
        ev = SiteEvent(
            organization_id=org_id,
            site_id=None,
            type="org_event",
            related_alert_id=None,
            title=title,
            body=description,
            created_by_user_id=user_id,
        )
        db.add(ev)
        db.commit()
    except Exception:
        db.rollback()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _clean_role(role: Optional[str]) -> str:
    r = (role or "member").strip().lower()
    if r not in {"member", "owner"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_ROLE", "message": "role must be 'member' or 'owner'."},
        )
    return r


def _validate_email_for_env(email: str) -> None:
    e = (email or "").strip()
    if not e or "@" not in e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_EMAIL", "message": "Invalid email address."},
        )

    if settings.is_prod:
        try:
            from pydantic import EmailStr, TypeAdapter
            TypeAdapter(EmailStr).validate_python(e)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "INVITE_BAD_EMAIL", "message": "Invalid email address."},
            )


def _require_owner_for_invites(current_user: User) -> None:
    is_super = bool(getattr(current_user, "is_superuser", 0))
    if is_super:
        return

    role = (getattr(current_user, "role", None) or "").strip().lower()
    if role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "FORBIDDEN_OWNER_ONLY",
                "message": "Only the organization owner can manage invites.",
            },
        )


def _invite_is_accepted(inv: OrgInvite) -> bool:
    return bool(getattr(inv, "accepted_user_id", None) is not None or getattr(inv, "accepted_at", None) is not None)


def _coerce_expiry_days(v: Optional[int]) -> int:
    expires_days = v if v is not None else 7
    try:
        expires_days = int(expires_days)
    except Exception:
        expires_days = 7
    if expires_days < 1 or expires_days > 30:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_EXPIRY", "message": "expires_in_days must be between 1 and 30."},
        )
    return expires_days


def _set_user_access_by_user_id(
    db: Session,
    *,
    org_id: int,
    user_id: int,
    enable: bool,
) -> Optional[str]:
    user = (
        db.query(User)
        .filter(User.organization_id == org_id, User.id == user_id)
        .first()
    )
    if not user:
        return None
    return _set_user_access_obj(db, user=user, enable=enable)


def _set_user_access_by_email(
    db: Session,
    *,
    org_id: int,
    email_norm: str,
    enable: bool,
) -> Optional[str]:
    user = (
        db.query(User)
        .filter(User.organization_id == org_id, User.email == email_norm)
        .first()
    )
    if not user:
        return None
    return _set_user_access_obj(db, user=user, enable=enable)


def _set_user_access_obj(db: Session, *, user: User, enable: bool) -> Optional[str]:
    now = _now_utc()

    if hasattr(user, "is_active"):
        try:
            setattr(user, "is_active", 1 if enable else 0)
            db.add(user)
            return f"user.is_active={1 if enable else 0}"
        except Exception:
            db.rollback()

    if hasattr(user, "disabled_at"):
        try:
            setattr(user, "disabled_at", None if enable else now)
            db.add(user)
            return f"user.disabled_at={'null' if enable else 'now'}"
        except Exception:
            db.rollback()

    return "user.toggle_unsupported"


def _compute_invite_state(inv: OrgInvite, now: datetime) -> dict:
    """
    Canonical state computation so UI never guesses.
    """
    revoked_at = _as_utc_aware(getattr(inv, "revoked_at", None))
    expires_at = _as_utc_aware(getattr(inv, "expires_at", None))
    accepted = _invite_is_accepted(inv)

    expired = False
    if expires_at is not None and expires_at < now:
        expired = True

    # Stored flag, but we harden it with timestamps.
    stored_active = bool(getattr(inv, "is_active", True))

    if revoked_at is not None:
        status_key = "revoked"
        is_active = False
    elif expired:
        status_key = "expired"
        is_active = False
    elif accepted:
        # Accepted invite is a membership artifact; it can still be "active"
        # but it is NOT accept-able anymore.
        status_key = "accepted"
        is_active = bool(stored_active)
    else:
        status_key = "active" if stored_active else "revoked"
        is_active = True if stored_active else False

    can_accept = (status_key == "active") and (not accepted) and (not expired) and (revoked_at is None)
    can_revoke = (status_key == "active")
    can_extend = True  # owner can always extend/reactivate

    return {
        "status": status_key,
        "is_active": is_active,
        "is_accepted": accepted,
        "is_expired": expired,
        "can_accept": can_accept,
        "can_revoke": can_revoke,
        "can_extend": can_extend,
    }


# ---------- Routes ----------

@router.post("", response_model=InviteCreateResponse)
def create_invite(
    payload: InviteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User is not attached to an organization")

    _require_owner_for_invites(current_user)

    email_raw = (payload.email or "").strip()
    if not email_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_EMAIL", "message": "Email is required to create an invite."},
        )

    _validate_email_for_env(email_raw)
    invited_email = normalize_email(email_raw)
    role = _clean_role(payload.role)

    expires_days = _coerce_expiry_days(payload.expires_in_days)
    expires_at = _now_utc() + timedelta(days=expires_days)

    existing = (
        db.query(OrgInvite)
        .filter(
            OrgInvite.organization_id == current_user.organization_id,
            OrgInvite.email == invited_email,
        )
        .first()
    )

    now = _now_utc()

    if existing:
        accepted = _invite_is_accepted(existing)

        existing.role = role
        existing.expires_at = expires_at
        existing.created_by_user_id = current_user.id

        # Always "reactivate" record for management purposes
        existing.is_active = True
        existing.revoked_at = None

        raw_token: Optional[str] = None

        if not accepted:
            # Only generate token if it can be used to accept
            raw_token = generate_invite_token()
            existing.token_hash = hash_invite_token(raw_token)

        db.add(existing)
        db.commit()
        db.refresh(existing)

        state = _compute_invite_state(existing, now)

        _audit(
            db,
            org_id=current_user.organization_id,
            user_id=current_user.id,
            title="Invite created/re-issued",
            description=(
                f"email={invited_email}; invite_id={existing.id}; role={role}; "
                f"expires_at={expires_at.isoformat()}; token_returned={'yes' if raw_token else 'no'}"
            ),
        )

        return InviteCreateResponse(
            id=existing.id,
            email=email_raw,
            role=existing.role,
            is_active=state["is_active"],
            expires_at=_as_utc_aware(existing.expires_at) or existing.expires_at,
            status=state["status"],
            is_accepted=state["is_accepted"],
            is_expired=state["is_expired"],
            can_accept=state["can_accept"],
            token=raw_token,
        )

    raw_token = generate_invite_token()
    token_hash = hash_invite_token(raw_token)

    inv = OrgInvite(
        organization_id=current_user.organization_id,
        email=invited_email,
        token_hash=token_hash,
        role=role,
        expires_at=expires_at,
        is_active=True,
        created_by_user_id=current_user.id,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    state = _compute_invite_state(inv, now)

    _audit(
        db,
        org_id=current_user.organization_id,
        user_id=current_user.id,
        title="Invite created",
        description=f"email={invited_email}; invite_id={inv.id}; role={role}; expires_at={expires_at.isoformat()}",
    )

    return InviteCreateResponse(
        id=inv.id,
        email=email_raw,
        role=inv.role,
        is_active=state["is_active"],
        expires_at=_as_utc_aware(inv.expires_at) or inv.expires_at,
        status=state["status"],
        is_accepted=state["is_accepted"],
        is_expired=state["is_expired"],
        can_accept=state["can_accept"],
        token=raw_token,
    )


@router.get("", response_model=list[InviteListItem])
def list_invites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User is not attached to an organization")

    _require_owner_for_invites(current_user)

    now = _now_utc()

    invites = (
        db.query(OrgInvite)
        .filter(OrgInvite.organization_id == current_user.organization_id)
        .order_by(OrgInvite.created_at.desc())
        .all()
    )

    out: list[InviteListItem] = []
    for inv in invites:
        state = _compute_invite_state(inv, now)

        out.append(
            InviteListItem(
                id=inv.id,
                email=getattr(inv, "email", None) or "",
                role=getattr(inv, "role", None) or "member",
                is_active=state["is_active"],
                created_at=_as_utc_aware(getattr(inv, "created_at", None)),
                expires_at=_as_utc_aware(getattr(inv, "expires_at", None)),
                accepted_at=_as_utc_aware(getattr(inv, "accepted_at", None)),
                accepted_user_id=getattr(inv, "accepted_user_id", None),
                revoked_at=_as_utc_aware(getattr(inv, "revoked_at", None)),
                created_by_user_id=getattr(inv, "created_by_user_id", None),

                status=state["status"],
                is_accepted=state["is_accepted"],
                is_expired=state["is_expired"],
                can_accept=state["can_accept"],
                can_revoke=state["can_revoke"],
                can_extend=state["can_extend"],
            )
        )

    return out


@router.delete("/{invite_id}", status_code=204)
def revoke_invite(
    invite_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User is not attached to an organization")

    _require_owner_for_invites(current_user)

    inv = (
        db.query(OrgInvite)
        .filter(
            OrgInvite.id == invite_id,
            OrgInvite.organization_id == current_user.organization_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "INVITE_NOT_FOUND", "message": "Invite not found."},
        )

    now = _now_utc()

    inv.is_active = False
    inv.revoked_at = now
    db.add(inv)

    email_norm = normalize_email(getattr(inv, "email", "") or "")
    accepted_user_id = getattr(inv, "accepted_user_id", None)

    disabled_detail: Optional[str] = None
    if accepted_user_id is not None:
        disabled_detail = _set_user_access_by_user_id(
            db, org_id=current_user.organization_id, user_id=int(accepted_user_id), enable=False
        )

    if disabled_detail is None:
        disabled_detail = _set_user_access_by_email(
            db, org_id=current_user.organization_id, email_norm=email_norm, enable=False
        )

    db.commit()

    _audit(
        db,
        org_id=current_user.organization_id,
        user_id=current_user.id,
        title="Invite revoked",
        description=f"invite_id={inv.id}; email={email_norm}; invite=revoked; user_action={disabled_detail or 'none'}",
    )

    return Response(status_code=204)


@router.post("/{invite_id}/extend", response_model=InviteExtendResponse)
def extend_invite(
    invite_id: int,
    payload: InviteExtendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User is not attached to an organization")

    _require_owner_for_invites(current_user)

    inv = (
        db.query(OrgInvite)
        .filter(
            OrgInvite.id == invite_id,
            OrgInvite.organization_id == current_user.organization_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "INVITE_NOT_FOUND", "message": "Invite not found."},
        )

    expires_days = _coerce_expiry_days(payload.expires_in_days)
    now = _now_utc()
    new_expires_at = now + timedelta(days=expires_days)

    if payload.role is not None:
        inv.role = _clean_role(payload.role)

    # Reactivate management state
    inv.is_active = True
    inv.revoked_at = None
    inv.expires_at = new_expires_at
    inv.created_by_user_id = current_user.id

    accepted = _invite_is_accepted(inv)

    raw_token: Optional[str] = None
    if not accepted:
        # Only mint a token if invite can still be accepted
        raw_token = generate_invite_token()
        inv.token_hash = hash_invite_token(raw_token)

    email_norm = normalize_email(getattr(inv, "email", "") or "")
    accepted_user_id = getattr(inv, "accepted_user_id", None)

    enabled_detail: Optional[str] = None
    if accepted_user_id is not None:
        enabled_detail = _set_user_access_by_user_id(
            db, org_id=current_user.organization_id, user_id=int(accepted_user_id), enable=True
        )

    if enabled_detail is None:
        enabled_detail = _set_user_access_by_email(
            db, org_id=current_user.organization_id, email_norm=email_norm, enable=True
        )

    db.add(inv)
    db.commit()
    db.refresh(inv)

    state = _compute_invite_state(inv, now)

    _audit(
        db,
        org_id=current_user.organization_id,
        user_id=current_user.id,
        title="Invite extended/reactivated",
        description=(
            f"invite_id={inv.id}; email={email_norm}; expires_at={_as_utc_aware(inv.expires_at).isoformat() if inv.expires_at else 'none'}; "
            f"user_action={enabled_detail or 'none'}; token_returned={'yes' if raw_token else 'no'}"
        ),
    )

    return InviteExtendResponse(
        id=inv.id,
        email=getattr(inv, "email", "") or "",
        role=getattr(inv, "role", None) or "member",
        is_active=state["is_active"],
        expires_at=_as_utc_aware(getattr(inv, "expires_at", None)),
        revoked_at=_as_utc_aware(getattr(inv, "revoked_at", None)),
        accepted_at=_as_utc_aware(getattr(inv, "accepted_at", None)),
        accepted_user_id=getattr(inv, "accepted_user_id", None),

        status=state["status"],
        is_accepted=state["is_accepted"],
        is_expired=state["is_expired"],
        can_accept=state["can_accept"],

        token=raw_token,
    )


@router.post("/accept-and-signup", response_model=TokenResponse)
def accept_and_signup(
    payload: InviteAcceptSignupRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    raw_token = (payload.token or "").strip()
    if not raw_token.startswith("cei_inv_"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_TOKEN", "message": "Invalid invite token format."},
        )

    _validate_email_for_env(payload.email)
    email_norm = normalize_email(payload.email)
    now = _now_utc()

    token_hash = hash_invite_token(raw_token)
    inv = db.query(OrgInvite).filter(OrgInvite.token_hash == token_hash).first()
    if not inv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "INVITE_NOT_FOUND", "message": "Invite not found."},
        )

    if normalize_email(getattr(inv, "email", "") or "") != email_norm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INVITE_EMAIL_MISMATCH", "message": "Invite is not valid for this email."},
        )

    expires_at = _as_utc_aware(getattr(inv, "expires_at", None))
    if expires_at is not None and expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_EXPIRED", "message": "Invite has expired."},
        )

    if _invite_is_accepted(inv):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_ALREADY_ACCEPTED", "message": "Invite has already been accepted."},
        )

    if not bool(getattr(inv, "is_active", True)) or getattr(inv, "revoked_at", None) is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_INACTIVE", "message": "Invite is no longer active."},
        )

    existing_user = db.query(User).filter(User.email == email_norm).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_ALREADY_REGISTERED", "message": "Email already registered. Please log in."},
        )

    from app.api.v1.auth import pwd_context
    hashed_password = pwd_context.hash(str(payload.password))

    user = User(
        email=email_norm,
        hashed_password=hashed_password,
        organization_id=inv.organization_id,
    )

    if payload.full_name:
        try:
            user.full_name = payload.full_name
        except Exception:
            pass

    try:
        user.role = (getattr(inv, "role", None) or "member").strip().lower()
    except Exception:
        pass

    if hasattr(user, "is_active"):
        try:
            setattr(user, "is_active", 1)
        except Exception:
            pass

    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_ALREADY_REGISTERED", "message": "Email already registered. Please log in."},
        )

    db.refresh(user)

    inv.accepted_at = now
    inv.accepted_user_id = user.id
    inv.is_active = True
    inv.revoked_at = None
    db.add(inv)
    db.commit()

    _audit(
        db,
        org_id=inv.organization_id,
        user_id=user.id,
        title="Invite accepted",
        description=f"email={email_norm}; invite_id={inv.id}; user_id={user.id}",
    )

    access = create_access_token({"sub": user.email})
    refresh = create_refresh_token({"sub": user.email})
    _set_refresh_cookie(response, refresh)

    return {"access_token": access, "token_type": "bearer"}
