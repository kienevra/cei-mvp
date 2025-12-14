from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import User

# IntegrationToken is stored in app.db.models in your codebase (shim)
from app.db.models import IntegrationToken


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _http_401(detail: str = "Could not validate credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def decode_jwt(token: str) -> dict:
    """
    Decode JWT using settings.jwt_secret/jwt_algorithm.
    Raises 401 on any error.
    """
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise _http_401("Invalid or expired token")


@dataclass
class OrgContext:
    """
    Backward-compatible shape (matches what used to live in api/v1/auth.py).
    This lets existing endpoints keep working without refactors.
    """
    organization_id: Optional[int]
    user: Optional[User] = None
    integration_token_id: Optional[int] = None
    auth_type: str = "user"  # "user" | "integration"


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    JWT-only dependency for normal app pages. (NOT integration token)
    """
    payload = decode_jwt(token)

    # Defensive: enforce access token type if present
    token_type = payload.get("type", "access")
    if token_type != "access":
        raise _http_401("Invalid token type")

    email = payload.get("sub")
    if not email:
        raise _http_401("Invalid token payload")

    user = db.query(User).filter(User.email == str(email).strip().lower()).first()
    if not user:
        raise _http_401("User not found")

    return user


def get_org_context(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> OrgContext:
    """
    Unified org context used by ingestion endpoints.
    Supports:
      - User JWT via Authorization: Bearer <jwt>
      - Integration token via Authorization: Bearer <token>
    """
    # 1) Try as access JWT (user)
    try:
        payload = decode_jwt(token)
        token_type = payload.get("type", "access")
        if token_type == "access":
            email = payload.get("sub")
            if email:
                user = db.query(User).filter(User.email == str(email).strip().lower()).first()
                if user:
                    return OrgContext(
                        organization_id=getattr(user, "organization_id", None),
                        user=user,
                        integration_token_id=None,
                        auth_type="user",
                    )
    except HTTPException:
        # Not a JWT (or expired) -> try integration token
        pass

    # 2) Try as integration token (hashed token lookup)
    token_hash = _hash_token(token)
    integ = (
        db.query(IntegrationToken)
        .filter(IntegrationToken.token_hash == token_hash, IntegrationToken.is_active == True)  # noqa: E712
        .first()
    )
    if not integ:
        raise _http_401()

    # Best-effort update last_used_at (do not fail request if this fails)
    try:
        integ.last_used_at = datetime.utcnow()
        db.add(integ)
        db.commit()
    except Exception:
        db.rollback()

    return OrgContext(
        organization_id=getattr(integ, "organization_id", None),
        user=None,
        integration_token_id=getattr(integ, "id", None),
        auth_type="integration",
    )
