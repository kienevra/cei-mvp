# backend/app/api/deps.py
"""
Shared API dependencies for CEI.

This module introduces a simple multi-tenant context and role scaffolding
on top of your existing get_current_user() dependency.

We deliberately:
- Do NOT change auth/token logic here.
- Derive organization_id and role from the current user as best we can.
- Default to "owner" role and use the user's own id as org_id if nothing
  more specific exists (so your current single-tenant flows keep working).
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel

from app.api.v1.auth import get_current_user


class CurrentContext(BaseModel):
    """
    Per-request multi-tenant context.

    This is the backbone for:
    - scoping all queries by organization_id
    - enforcing role-based access (owner/admin/analyst/viewer)
    """

    user_id: int
    organization_id: int
    role: Literal["owner", "admin", "analyst", "viewer"]


def _infer_org_id(user) -> int:
    """
    Best-effort inference of organization_id from the User model.

    We try a few common attributes. If nothing is present, we fall back to
    using the user's own id as a pseudo-org, which preserves behavior for
    your current single-tenant setup.
    """
    # Try the obvious ones first
    for attr in ("organization_id", "org_id", "tenant_id"):
        value = getattr(user, attr, None)
        if isinstance(value, int):
            return value

    # Fallback: treat each user as their own org (single-tenant mode)
    if hasattr(user, "id") and isinstance(user.id, int):
        return user.id

    # Extremely defensive fallback
    raise RuntimeError("Unable to infer organization_id from current user")


def _infer_role(user) -> str:
    """
    Best-effort inference of the user's role inside the organization.

    If there's no explicit role field, we treat the user as an 'owner'
    so they are not accidentally blocked from anything after this change.
    """
    raw_role: Optional[str] = getattr(user, "role", None) or getattr(
        user, "org_role", None
    )

    if not raw_role:
        return "owner"

    normalized = str(raw_role).strip().lower()
    if normalized in {"owner", "admin", "analyst", "viewer"}:
        return normalized

    # Unknown custom role? Treat as analyst by default.
    return "analyst"


def get_current_context(user=Depends(get_current_user)) -> CurrentContext:
    """
    Main dependency to use in new multi-tenant aware endpoints.

    Example:

        @router.get("/something")
        def list_something(
            ctx: CurrentContext = Depends(get_current_context),
            db: Session = Depends(get_db),
        ):
            q = db.query(Model).filter(Model.organization_id == ctx.organization_id)
            ...
    """
    org_id = _infer_org_id(user)
    role = _infer_role(user)

    return CurrentContext(
        user_id=int(getattr(user, "id")),
        organization_id=org_id,
        role=role,  # type: ignore[arg-type]
    )


def require_role(
    ctx: CurrentContext,
    allowed: set[str],
) -> None:
    """
    Lightweight role check.

    Call this at the top of endpoints that should be restricted:

        def some_admin_endpoint(
            ctx: CurrentContext = Depends(get_current_context),
        ):
            require_role(ctx, {"owner", "admin"})
            ...

    If the user doesn't have a permitted role, this will raise HTTP 403.
    """
    if ctx.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions for this operation.",
        )


def require_billing_access(ctx: CurrentContext) -> None:
    """
    Convenience helper specifically for billing/plan endpoints.

    Currently: only 'owner' and 'admin' can see/change billing.
    """
    require_role(ctx, {"owner", "admin"})
