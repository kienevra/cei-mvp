# backend/app/api/v1/account.py
from typing import Optional

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import User  # Organization logic lives inside auth.read_me
from app.api.v1.auth import (
    get_current_user,
    AccountMeOut,
    read_me as auth_read_me,
    _clear_refresh_cookie,
)

router = APIRouter(prefix="/account", tags=["account"])


@router.get("/me", response_model=AccountMeOut)
def read_account_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AccountMeOut:
    """
    Thin wrapper around auth.read_me so the frontend can call /account/me.

    This keeps a single source of truth for account/org/plan logic in
    app.api.v1.auth.read_me, while exposing a cleaner /account namespace.
    """
    return auth_read_me(current_user=current_user, db=db)


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_account_me(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """
    Hard-delete the current user account for this environment.

    Notes:
      - This is intended for dev/sandbox use. In a real SaaS you would
        typically soft-delete and/or enforce stricter org-level policies.
      - Also clears the HttpOnly refresh cookie so the browser session
        is invalidated.
    """
    # Delete the user row
    db.delete(current_user)
    db.commit()

    # Clear refresh cookie so the browser session is fully logged out
    _clear_refresh_cookie(response)

    # 204 No Content – frontend shouldn't expect a body
    return Response(status_code=status.HTTP_204_NO_CONTENT)
