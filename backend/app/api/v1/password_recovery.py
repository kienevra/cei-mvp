# backend/app/api/v1/password_recovery.py
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from passlib.context import CryptContext
from pydantic import BaseModel, Field

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import login_rate_limit  # reuse; keeps abuse down
from app.core.email import send_email
from app.db.session import get_db
from app.models import User, PasswordResetToken

router = APIRouter(prefix="/auth/password", tags=["auth"])

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

RESET_TOKEN_PREFIX = "cei_pwd_"
RESET_TOKEN_EXPIRE_MINUTES = 30


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    try:
        return request.client.host if request.client else "unknown"
    except Exception:
        return "unknown"


def _password_ok(pw: str) -> bool:
    pw = pw or ""
    return len(pw) >= 8


class ForgotPasswordIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)


class ForgotPasswordOut(BaseModel):
    detail: str
    # In dev only we can include a debug link to speed iteration
    debug_reset_link: Optional[str] = None


class ResetPasswordIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=512)
    new_password: str = Field(..., min_length=8, max_length=256)


class ResetPasswordOut(BaseModel):
    detail: str


@router.post(
    "/forgot",
    response_model=ForgotPasswordOut,
    dependencies=[Depends(login_rate_limit)],
)
def forgot_password(payload: ForgotPasswordIn, request: Request, db: Session = Depends(get_db)) -> ForgotPasswordOut:
    email = _normalize_email(payload.email)

    # Generic response no matter what -> prevents email enumeration
    generic = "If the email exists, a password reset link has been sent."

    if not email:
        return ForgotPasswordOut(detail=generic)

    user = db.query(User).filter(User.email == email).first()

    # If user not found or disabled, still return generic
    if not user:
        return ForgotPasswordOut(detail=generic)

    # Respect your "is_active" kill-switch
    try:
        if hasattr(user, "is_active") and not bool(int(getattr(user, "is_active", 1))):
            return ForgotPasswordOut(detail=generic)
    except Exception:
        # If weird data, fail closed (don’t leak anything)
        return ForgotPasswordOut(detail=generic)

    raw = RESET_TOKEN_PREFIX + secrets.token_urlsafe(32)
    token_hash = _hash_token(raw)
    now = datetime.utcnow()
    expires = now + timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES)

    prt = PasswordResetToken(
        user_id=user.id,
        email=email,
        token_hash=token_hash,
        expires_at=expires,
        used_at=None,
        request_ip=_client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
    )

    db.add(prt)
    db.commit()

    # Reset link to frontend
    frontend = getattr(settings, "frontend_url", "http://localhost:5173")
    reset_link = f"{frontend.rstrip('/')}/reset-password?token={raw}"

    subject = "Reset your CEI password"
    text = (
        "We received a request to reset your CEI password.\n\n"
        f"Reset link (valid for {RESET_TOKEN_EXPIRE_MINUTES} minutes):\n{reset_link}\n\n"
        "If you did not request this, you can ignore this email."
    )

    send_email(to_email=email, subject=subject, text_body=text)

    # Dev ergonomics: include link only outside prod
    if not settings.is_prod and bool(getattr(settings, "debug", True)):
        return ForgotPasswordOut(detail=generic, debug_reset_link=reset_link)

    return ForgotPasswordOut(detail=generic)


@router.post(
    "/reset",
    response_model=ResetPasswordOut,
    dependencies=[Depends(login_rate_limit)],
)
def reset_password(payload: ResetPasswordIn, db: Session = Depends(get_db)) -> ResetPasswordOut:
    token = (payload.token or "").strip()
    new_pw = payload.new_password or ""

    if not token.startswith(RESET_TOKEN_PREFIX):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "BAD_TOKEN", "message": "Invalid token."})

    if not _password_ok(new_pw):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "WEAK_PASSWORD", "message": "Password must be at least 8 characters."},
        )

    token_hash = _hash_token(token)

    rec = db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == token_hash).first()
    if not rec:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "BAD_TOKEN", "message": "Invalid token."})

    if rec.used_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "TOKEN_USED", "message": "Token already used."})

    now = datetime.utcnow()
    if rec.expires_at is None or rec.expires_at < now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail={"code": "TOKEN_EXPIRED", "message": "Token expired."})

    user = db.query(User).filter(User.id == rec.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "USER_NOT_FOUND", "message": "User not found."})

    # Enforce kill-switch (don’t let disabled users reset)
    try:
        if hasattr(user, "is_active") and not bool(int(getattr(user, "is_active", 1))):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "USER_DISABLED", "message": "User access is disabled."})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "USER_DISABLED", "message": "User access is disabled."})

    # Update password
    user.hashed_password = pwd_context.hash(str(new_pw))

    # Mark token used
    rec.used_at = now

    db.add(user)
    db.add(rec)
    db.commit()

    return ResetPasswordOut(detail="Password updated. You can now sign in.")
