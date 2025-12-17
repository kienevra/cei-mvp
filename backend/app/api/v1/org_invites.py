# backend/app/api/v1/org_invites.py
from datetime import datetime, timedelta
from typing import Optional

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
    _require_owner,
)
from app.services.invites import generate_invite_token, hash_invite_token, normalize_email

router = APIRouter(prefix="/org/invites", tags=["org-invites"])


# ---------- Schemas ----------

class InviteCreateRequest(BaseModel):
    # NOTE: keep as str so dev can use reserved domains like *.local.
    # In prod, we enforce stricter validation in _validate_email_for_env().
    email: str
    role: Optional[str] = "member"         # "member" | "owner"
    expires_in_days: Optional[int] = 7     # default 7 days


class InviteCreateResponse(BaseModel):
    id: int
    email: str
    role: str
    expires_at: datetime
    token: str  # returned ONCE


class InviteAcceptSignupRequest(BaseModel):
    token: str
    email: str
    password: str
    full_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


# ---------- Helpers ----------

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
    return datetime.utcnow()


def _clean_role(role: Optional[str]) -> str:
    r = (role or "member").strip().lower()
    if r not in {"member", "owner"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_ROLE", "message": "role must be 'member' or 'owner'."},
        )
    return r


def _validate_email_for_env(email: str) -> None:
    """
    Dev/Test: allow reserved/special-use domains (e.g. *.local) so you can use local emails.
    Prod: enforce proper email validation.
    """
    e = (email or "").strip()
    if not e or "@" not in e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_EMAIL", "message": "Invalid email address."},
        )

    if settings.is_prod:
        # Strict validation in prod using Pydantic's EmailStr (v2 compatible).
        try:
            from pydantic import EmailStr, TypeAdapter  # pydantic v2
            TypeAdapter(EmailStr).validate_python(e)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "INVITE_BAD_EMAIL", "message": "Invalid email address."},
            )


def _invite_is_already_accepted(inv: OrgInvite) -> bool:
    # Defensive: treat any accepted marker as "already accepted"
    try:
        if getattr(inv, "accepted_user_id", None) is not None:
            return True
    except Exception:
        pass
    try:
        if getattr(inv, "accepted_at", None) is not None:
            return True
    except Exception:
        pass
    # Some flows might only flip is_active; keep that meaning too
    try:
        if not bool(getattr(inv, "is_active", True)):
            return True
    except Exception:
        pass
    return False


# ---------- Routes ----------

@router.post("", response_model=InviteCreateResponse)
def create_invite(
    payload: InviteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Owner-only: create a one-time invite token for a specific email.
    Returns the raw token ONCE.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=400, detail="User is not attached to an organization")

    _require_owner(current_user)

    _validate_email_for_env(payload.email)
    invited_email = normalize_email(payload.email)
    role = _clean_role(payload.role)

    expires_days = payload.expires_in_days if payload.expires_in_days is not None else 7
    try:
        expires_days = int(expires_days)
    except Exception:
        expires_days = 7
    if expires_days < 1 or expires_days > 30:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_EXPIRY", "message": "expires_in_days must be between 1 and 30."},
        )

    # If invite exists for (org,email), rotate token by updating the same row (keeps uq constraint happy)
    existing = (
        db.query(OrgInvite)
        .filter(
            OrgInvite.organization_id == current_user.organization_id,
            OrgInvite.email == invited_email,
        )
        .first()
    )

    raw_token = generate_invite_token()
    token_hash = hash_invite_token(raw_token)
    expires_at = _now_utc() + timedelta(days=expires_days)

    if existing:
        existing.token_hash = token_hash
        existing.role = role
        existing.expires_at = expires_at
        existing.is_active = True
        existing.revoked_at = None
        existing.accepted_at = None
        existing.accepted_user_id = None
        existing.created_by_user_id = current_user.id
        db.add(existing)
        db.commit()
        db.refresh(existing)

        _audit(
            db,
            org_id=current_user.organization_id,
            user_id=current_user.id,
            title="Invite re-issued",
            description=f"email={invited_email}; invite_id={existing.id}; role={role}; expires_at={expires_at.isoformat()}",
        )

        return InviteCreateResponse(
            id=existing.id,
            email=payload.email,
            role=existing.role,
            expires_at=existing.expires_at,
            token=raw_token,
        )

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

    _audit(
        db,
        org_id=current_user.organization_id,
        user_id=current_user.id,
        title="Invite created",
        description=f"email={invited_email}; invite_id={inv.id}; role={role}; expires_at={expires_at.isoformat()}",
    )

    return InviteCreateResponse(
        id=inv.id,
        email=payload.email,
        role=inv.role,
        expires_at=inv.expires_at,
        token=raw_token,
    )


@router.post("/accept-and-signup", response_model=TokenResponse)
def accept_and_signup(
    payload: InviteAcceptSignupRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Public: accept invite + create user + log them in (sets refresh cookie, returns access token).

    Important: We validate the invite FIRST so replay attempts return INVITE_INACTIVE / INVITE_ALREADY_ACCEPTED
    instead of EMAIL_ALREADY_REGISTERED.
    """
    raw_token = (payload.token or "").strip()
    if not raw_token.startswith("cei_inv_"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVITE_BAD_TOKEN", "message": "Invalid invite token format."},
        )

    _validate_email_for_env(payload.email)
    email_norm = normalize_email(payload.email)
    now = _now_utc()

    # 1) Resolve invite by token (even if inactive; we want correct error codes on replay)
    token_hash = hash_invite_token(raw_token)
    inv = db.query(OrgInvite).filter(OrgInvite.token_hash == token_hash).first()
    if not inv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "INVITE_NOT_FOUND", "message": "Invite not found."},
        )

    # 2) Validate lifecycle BEFORE looking at user existence
    # Email must match the invite
    if normalize_email(getattr(inv, "email", "") or "") != email_norm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INVITE_EMAIL_MISMATCH", "message": "Invite is not valid for this email."},
        )

    # Expiry
    if getattr(inv, "expires_at", None) is not None and inv.expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_EXPIRED", "message": "Invite has expired."},
        )

    # Already accepted / inactive
    if _invite_is_already_accepted(inv):
        # Use a clearer code if it was accepted (optional but useful)
        if getattr(inv, "accepted_user_id", None) is not None or getattr(inv, "accepted_at", None) is not None:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail={"code": "INVITE_ALREADY_ACCEPTED", "message": "Invite has already been accepted."},
            )
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_INACTIVE", "message": "Invite is no longer active."},
        )

    # 3) Now check whether the user already exists
    existing_user = db.query(User).filter(User.email == email_norm).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_ALREADY_REGISTERED", "message": "Email already registered. Please log in."},
        )

    # 4) Create user (reuse the same hashing context from auth.py)
    from app.api.v1.auth import pwd_context  # local import to avoid circular startup issues
    hashed_password = pwd_context.hash(str(payload.password))

    user = User(
        email=email_norm,
        hashed_password=hashed_password,
        organization_id=inv.organization_id,
    )

    # full_name (best-effort, column may or may not exist)
    if payload.full_name:
        try:
            user.full_name = payload.full_name
        except Exception:
            pass

    # Role from invite (best-effort)
    try:
        user.role = (getattr(inv, "role", None) or "member").strip().lower()
    except Exception:
        pass

    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        # Race safety: if another request created the same email in between
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_ALREADY_REGISTERED", "message": "Email already registered. Please log in."},
        )

    db.refresh(user)

    # 5) Mark invite accepted + deactivate
    inv.accepted_at = now
    inv.accepted_user_id = user.id
    inv.is_active = False
    db.add(inv)
    db.commit()

    _audit(
        db,
        org_id=inv.organization_id,
        user_id=user.id,
        title="Invite accepted",
        description=f"email={email_norm}; invite_id={inv.id}; user_id={user.id}",
    )

    # 6) Log them in immediately (same as /auth/login)
    access = create_access_token({"sub": user.email})
    refresh = create_refresh_token({"sub": user.email})
    _set_refresh_cookie(response, refresh)

    return {"access_token": access, "token_type": "bearer"}
