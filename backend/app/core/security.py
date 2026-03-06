# backend/app/core/security.py
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import IntegrationToken, Organization, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


# ---------------------------------------------------------------------------
# HTTP error helpers
# ---------------------------------------------------------------------------

def _http_401(detail: str = "Could not validate credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _http_403(detail: str = "Forbidden") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=detail,
    )


# ---------------------------------------------------------------------------
# Token utilities
# ---------------------------------------------------------------------------

def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def decode_jwt(token: str) -> dict:
    """
    Decode JWT using settings.jwt_secret / jwt_algorithm.
    Raises HTTP 401 on any error.
    """
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise _http_401("Invalid or expired token")


# ---------------------------------------------------------------------------
# User active-state helpers
# ---------------------------------------------------------------------------

def _is_user_active(user: Optional[User]) -> bool:
    """
    Enforce org-owner access revocation.
    User.is_active is int 0/1 in this codebase; tolerate bool too.
    Missing field => assume active (back-compat).
    """
    if not user:
        return False
    if not hasattr(user, "is_active"):
        return True
    v = getattr(user, "is_active", 1)
    try:
        return bool(int(v))
    except Exception:
        return bool(v)


def _ensure_user_active(user: User) -> None:
    if not _is_user_active(user):
        # 403 (not 401): credentials are valid but access has been revoked
        raise _http_403(
            detail={
                "code": "USER_DISABLED",
                "message": "User access has been disabled by the organization owner.",
            }
        )


# ---------------------------------------------------------------------------
# OrgContext — Phase 2 extended
# ---------------------------------------------------------------------------

@dataclass
class OrgContext:
    """
    Unified auth context carried by ingestion and management endpoints.

    Phase 1 fields (backward-compatible):
        organization_id       — The EFFECTIVE org for this request.
                                For normal requests: the caller's own org.
                                For delegated requests: the TARGET client org.
        user                  — Authenticated User object (None for integration tokens).
        integration_token_id  — DB id of the IntegrationToken (None for JWT auth).
        auth_type             — "user" | "integration"

    Phase 2 additions:
        managing_org_id       — Set when cross-org delegation is active.
                                The org that is AUTHENTICATED (the managing org).
                                None when no X-CEI-ORG-ID header is present.
        is_delegated          — Convenience flag: True when managing_org_id is set.

    Usage pattern for endpoints:
        - Use `org_context.organization_id` for all data scoping (sites, timeseries,
          alerts, etc.). This always points to the correct target org.
        - Use `org_context.is_delegated` to know if the managing org is acting
          on behalf of a client.
        - Use `org_context.managing_org_id` when you need to identify the
          managing org itself (e.g. audit logs, billing checks).
    """

    organization_id: Optional[int]
    user: Optional[User] = None
    integration_token_id: Optional[int] = None
    auth_type: str = "user"                 # "user" | "integration"

    # Phase 2: cross-org delegation
    managing_org_id: Optional[int] = None  # populated only when X-CEI-ORG-ID is used
    is_delegated: bool = False              # True when managing_org_id is set


# ---------------------------------------------------------------------------
# Cross-org delegation validator (Phase 2)
# ---------------------------------------------------------------------------

def _resolve_delegated_org(
    *,
    db: Session,
    auth_org_id: int,
    target_org_id: int,
) -> Organization:
    """
    Validate that `auth_org_id` is a managing org and that `target_org_id`
    is one of its client orgs.

    Returns the target Organization on success.
    Raises HTTP 403 on any violation.

    Rules:
    1. The authenticated org must have org_type == "managing".
    2. The target org must have managed_by_org_id == auth_org_id.
    3. The target org must exist.

    These two checks together mean:
    - A managing org can only act on orgs it explicitly manages.
    - A standalone or client org cannot use X-CEI-ORG-ID at all.
    - A managing org cannot impersonate another managing org's clients.
    """
    # 1. Load and validate the authenticated (managing) org
    auth_org = db.query(Organization).filter(Organization.id == auth_org_id).first()
    if not auth_org:
        raise _http_403(
            detail={
                "code": "AUTH_ORG_NOT_FOUND",
                "message": "Authenticated organization not found.",
            }
        )

    auth_org_type = getattr(auth_org, "org_type", "standalone") or "standalone"
    if auth_org_type != "managing":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOT_A_MANAGING_ORG",
                "message": (
                    "X-CEI-ORG-ID can only be used by organizations with "
                    "org_type='managing'. Upgrade this org first via "
                    "POST /api/v1/org/upgrade-to-managing."
                ),
            },
        )

    # 2. Load and validate the target (client) org
    target_org = db.query(Organization).filter(Organization.id == target_org_id).first()
    if not target_org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "CLIENT_ORG_NOT_FOUND",
                "message": f"Client organization id={target_org_id} not found.",
            },
        )

    # 3. Confirm ownership — the target must be managed by this managing org
    if getattr(target_org, "managed_by_org_id", None) != auth_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOT_YOUR_CLIENT_ORG",
                "message": (
                    f"Organization id={target_org_id} is not managed by your organization. "
                    "You can only act on behalf of client orgs you manage."
                ),
            },
        )

    return target_org


# ---------------------------------------------------------------------------
# Core auth dependencies
# ---------------------------------------------------------------------------

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    JWT-only dependency for normal app endpoints.
    Does NOT handle integration tokens — use get_org_context for those.
    """
    payload = decode_jwt(token)

    # Enforce access token type
    token_type = payload.get("type", "access")
    if token_type != "access":
        raise _http_401("Invalid token type")

    email = payload.get("sub")
    if not email:
        raise _http_401("Invalid token payload")

    user = db.query(User).filter(User.email == str(email).strip().lower()).first()
    if not user:
        raise _http_401("User not found")

    # Global enforcement: revoked users cannot hit any protected endpoint
    _ensure_user_active(user)

    return user


def get_org_context(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    x_cei_org_id: Optional[int] = Header(
        default=None,
        alias="X-CEI-ORG-ID",
        description=(
            "Optional. Managing org users pass the target client org ID here "
            "to act on behalf of that client org. Requires the authenticated "
            "org to have org_type='managing' and to own the target org."
        ),
    ),
) -> OrgContext:
    """
    Unified org context for ingestion and management endpoints.

    Supports three auth paths:

    1. User JWT (normal login):
       Authorization: Bearer <jwt>
       → OrgContext(organization_id=user.organization_id, auth_type="user")

    2. Integration token:
       Authorization: Bearer cei_int_<token>
       → OrgContext(organization_id=token.organization_id, auth_type="integration")

    3. Managing org delegation (Phase 2):
       Authorization: Bearer <jwt_or_integration_token>
       X-CEI-ORG-ID: <client_org_id>
       → OrgContext(
             organization_id=<client_org_id>,      # effective target
             managing_org_id=<managing_org_id>,    # authenticated org
             is_delegated=True,
             auth_type="user" | "integration",
         )
       Requires:
         - Authenticated org has org_type="managing"
         - Target org has managed_by_org_id == authenticated org id
    """
    token = (token or "").strip()

    # ------------------------------------------------------------------
    # Path 1: Try as JWT (user auth)
    # ------------------------------------------------------------------
    auth_org_id: Optional[int] = None
    resolved_user: Optional[User] = None
    resolved_token_id: Optional[int] = None
    resolved_auth_type: str = "user"

    jwt_resolved = False
    try:
        payload = decode_jwt(token)
        token_type = payload.get("type", "access")
        if token_type == "access":
            email = payload.get("sub")
            if email:
                user = (
                    db.query(User)
                    .filter(User.email == str(email).strip().lower())
                    .first()
                )
                if user:
                    _ensure_user_active(user)
                    auth_org_id = getattr(user, "organization_id", None)
                    resolved_user = user
                    resolved_auth_type = "user"
                    jwt_resolved = True
    except HTTPException:
        # Not a valid JWT → fall through to integration token path
        pass

    # ------------------------------------------------------------------
    # Path 2: Try as integration token
    # ------------------------------------------------------------------
    if not jwt_resolved:
        token_hash = _hash_token(token)
        integ = (
            db.query(IntegrationToken)
            .filter(
                IntegrationToken.token_hash == token_hash,
                IntegrationToken.is_active.is_(True),
            )
            .first()
        )
        if not integ:
            raise _http_401()

        # Best-effort last_used_at update
        try:
            integ.last_used_at = datetime.utcnow()
            db.add(integ)
            db.commit()
        except Exception:
            db.rollback()

        auth_org_id = getattr(integ, "organization_id", None)
        resolved_token_id = getattr(integ, "id", None)
        resolved_auth_type = "integration"

    # ------------------------------------------------------------------
    # Path 3: Cross-org delegation via X-CEI-ORG-ID (Phase 2)
    # ------------------------------------------------------------------
    if x_cei_org_id is not None:
        if auth_org_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "NO_ORG_FOR_DELEGATION",
                    "message": (
                        "Cannot use X-CEI-ORG-ID: authenticated user or token "
                        "is not attached to any organization."
                    ),
                },
            )

        # Validate: auth org must be managing, target must be its client
        _resolve_delegated_org(
            db=db,
            auth_org_id=auth_org_id,
            target_org_id=x_cei_org_id,
        )

        return OrgContext(
            organization_id=x_cei_org_id,       # effective target: the client org
            user=resolved_user,
            integration_token_id=resolved_token_id,
            auth_type=resolved_auth_type,
            managing_org_id=auth_org_id,         # the authenticated managing org
            is_delegated=True,
        )

    # ------------------------------------------------------------------
    # No delegation: standard single-org context (fully backward-compatible)
    # ------------------------------------------------------------------
    return OrgContext(
        organization_id=auth_org_id,
        user=resolved_user,
        integration_token_id=resolved_token_id,
        auth_type=resolved_auth_type,
        managing_org_id=None,
        is_delegated=False,
    )