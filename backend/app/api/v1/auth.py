from datetime import datetime, timedelta
import logging
from typing import Optional, List
from dataclasses import dataclass
import hashlib
import secrets

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Response,
    Cookie,
)
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import User, Organization  # <- NOTE: import Organization
from app.db.models import IntegrationToken  # <- integration tokens live here
from app.core.rate_limit import login_rate_limit, refresh_rate_limit
from app.core.config import settings

logger = logging.getLogger("cei")

# === JWT / security settings ===
# Centralized via app.core.config.Settings
SECRET_KEY = settings.jwt_secret
ALGORITHM = settings.jwt_algorithm  # now driven by config
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes
REFRESH_TOKEN_EXPIRE_DAYS = settings.refresh_token_expire_days

# Hard guard: never allow the default secret in production-like envs
if settings.is_prod and SECRET_KEY in {"supersecret", "changeme", "secret", "", None}:
    # Fail fast at import time so you don't accidentally boot prod with a toy key.
    raise RuntimeError(
        "Insecure JWT_SECRET configured in production environment. "
        "Set a strong random secret via the JWT_SECRET env var."
    )

# Use Argon2 for password hashing (good long-term choice)
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# OAuth2 token endpoint (full path will be /api/v1/auth/login)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Router mounted at /auth but included under /api/v1 in main.py (-> /api/v1/auth/*)
router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "cei_refresh_token"
INTEGRATION_TOKEN_PREFIX = "cei_int_"  # human-visible prefix for integration tokens


# === Schemas ===


class UserCreate(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None
    # Support both canonical `organization_id` and the legacy `org_id`.
    organization_id: Optional[int] = None
    org_id: Optional[int] = None
    # Optional organization name for self-serve signup
    organization_name: Optional[str] = None


class Token(BaseModel):
    access_token: str
    token_type: str


class UserOut(BaseModel):
    id: int
    email: str
    organization_id: Optional[int]

    class Config:
        orm_mode = True


class OrgSummaryOut(BaseModel):
    id: int
    name: str
    plan_key: Optional[str] = None
    subscription_plan_key: Optional[str] = None
    enable_alerts: bool = True
    enable_reports: bool = True
    subscription_status: Optional[str] = None

    class Config:
        orm_mode = True


class AccountMeOut(BaseModel):
    id: int
    email: str
    organization_id: Optional[int] = None

    full_name: Optional[str] = None
    role: Optional[str] = None

    # Duplicated for front-end convenience
    org: Optional[OrgSummaryOut] = None
    organization: Optional[OrgSummaryOut] = None

    # Plan-level flags mirrored at the top level
    subscription_plan_key: Optional[str] = None
    enable_alerts: bool = True
    enable_reports: bool = True
    subscription_status: Optional[str] = None  # <- top-level mirror

    class Config:
        orm_mode = True


class IntegrationTokenCreate(BaseModel):
    """
    Payload to create a new integration token for the caller's org.
    """
    name: str


class IntegrationTokenOut(BaseModel):
    """
    Metadata for listing integration tokens (no secret).
    """
    id: int
    name: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None

    class Config:
        orm_mode = True


class IntegrationTokenWithSecret(IntegrationTokenOut):
    """
    Response when creating a token: includes the one-time raw token.
    """
    token: str


@dataclass
class OrgContext:
    """
    Represents an org-scoped principal resolved from a Bearer token.

    - auth_type = "user"        -> interactive user JWT
    - auth_type = "integration" -> long-lived integration token
    """
    organization_id: Optional[int]
    user: Optional[User] = None
    integration_token_id: Optional[int] = None
    auth_type: str = "user"


# === Token helpers ===


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    # Mark token type for extra safety
    to_encode.setdefault("type", "access")
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["type"] = "refresh"
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """
    Set HttpOnly refresh token cookie.
    - secure=True automatically in production-like environments.
    """
    max_age = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    secure_flag = settings.is_prod
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=secure_flag,
        samesite="lax",
        max_age=max_age,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/")


def _hash_integration_token(raw: str) -> str:
    """
    Deterministic hash for integration tokens. Only the hash is stored in DB.
    """
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_integration_token_string() -> str:
    """
    Generate a new raw integration token string with a recognizable prefix.
    """
    return INTEGRATION_TOKEN_PREFIX + secrets.token_urlsafe(32)


# === Routes ===


@router.post(
    "/signup",
    response_model=Token,
    # Re-use the login limiter for signup as well (low-volume path)
    dependencies=[Depends(login_rate_limit)],
)
def signup(user: UserCreate, response: Response, db: Session = Depends(get_db)):
    """
    Signup endpoint for self-serve onboarding.

    - If organization_id/org_id is provided, we attach the user to that org (and 400 if it doesn't exist).
    - Otherwise we auto-create an Organization using organization_name or a name derived from email.
    """
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Resolve org id
    # Prefer explicit organization_id, then legacy org_id.
    organization_id = (
        user.organization_id if user.organization_id is not None else user.org_id
    )
    if user.org_id is not None and user.organization_id is None:
        logger.warning(
            "Received deprecated payload field `org_id`; "
            "prefer `organization_id` (will be removed in future)."
        )

    org_obj: Optional[Organization] = None

    if organization_id is not None:
        # Attach to an existing org; error if not found.
        org_obj = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if org_obj is None:
            raise HTTPException(
                status_code=400,
                detail=f"Organization with id={organization_id} not found",
            )
    else:
        # Self-serve path: create or reuse an org based on organization_name or email
        if user.organization_name and user.organization_name.strip():
            org_name = user.organization_name.strip()
        else:
            # Fallback: derive something sensible from email
            email_prefix = user.email.split("@")[0] if "@" in user.email else user.email
            org_name = f"{email_prefix} Org".strip() or "New Organization"

        # Reuse an existing org with that name if it already exists
        org_obj = (
            db.query(Organization)
            .filter(Organization.name == org_name)
            .first()
        )

        if org_obj is None:
            org_obj = Organization(name=org_name)  # only safe ctor arg
            # Best-effort plan defaults, guarded to not break older schemas.
            try:
                org_obj.plan_key = "cei-starter"
            except Exception:
                pass
            try:
                org_obj.subscription_plan_key = "cei-starter"
            except Exception:
                pass
            try:
                org_obj.enable_alerts = True
            except Exception:
                pass
            try:
                org_obj.enable_reports = True
            except Exception:
                pass
            try:
                org_obj.subscription_status = "active"
            except Exception:
                pass

            db.add(org_obj)
            db.flush()  # ensure org_obj.id is available

        organization_id = org_obj.id

    # Hash password
    try:
        password_str = str(user.password)
        hashed_password = pwd_context.hash(password_str)
    except Exception as e:
        logger.exception("Password hashing failed")
        raise HTTPException(status_code=400, detail=f"Password hashing failed: {e}")

    db_user = User(
        email=user.email,
        hashed_password=hashed_password,
        organization_id=organization_id,
    )

    # Best-effort: populate full_name if the column exists
    if user.full_name:
        try:
            db_user.full_name = user.full_name
        except Exception:
            # Column might not exist in older schemas; ignore silently.
            pass

    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    access = create_access_token({"sub": db_user.email})
    refresh = create_refresh_token({"sub": db_user.email})
    _set_refresh_cookie(response, refresh)

    return {"access_token": access, "token_type": "bearer"}


@router.post(
    "/login",
    response_model=Token,
    # Dedicated login limiter (per IP) from app.core.rate_limit
    dependencies=[Depends(login_rate_limit)],
)
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Login expects form-encoded fields: username and password.
    """
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    access = create_access_token({"sub": user.email})
    refresh = create_refresh_token({"sub": user.email})
    _set_refresh_cookie(response, refresh)

    return {"access_token": access, "token_type": "bearer"}


@router.post(
    "/refresh",
    response_model=Token,
    # Protect refresh endpoint from abuse
    dependencies=[Depends(refresh_rate_limit)],
)
def refresh_access_token(
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    """
    Issue a new short-lived access token based on the HttpOnly refresh cookie.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not refresh credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not refresh_token:
        raise credentials_exception

    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        token_type = payload.get("type")
        if token_type != "refresh":
            raise credentials_exception
        email: Optional[str] = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception

    # Rotate refresh token
    new_access = create_access_token({"sub": user.email})
    new_refresh = create_refresh_token({"sub": user.email})
    _set_refresh_cookie(response, new_refresh)

    return {"access_token": new_access, "token_type": "bearer"}


@router.post("/logout")
def logout_api(response: Response, user=Depends(lambda: None)):
    """
    Simple logout endpoint to clear the refresh cookie.
    Frontend should ALSO clear the access token from localStorage.
    """
    _clear_refresh_cookie(response)
    return {"detail": "Logged out."}


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """
    Resolve the current user from the Bearer access token.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        token_type = payload.get("type", "access")
        if token_type != "access":
            raise credentials_exception
        email: Optional[str] = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception

    return user


def get_org_context(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> OrgContext:
    """
    Resolve an org-scoped principal from a Bearer token.

    - First try to treat it as a normal access JWT (user).
    - If that fails, treat it as an integration token and resolve organization_id from IntegrationToken.
    """
    # 1) Try as access JWT (user)
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        token_type = payload.get("type", "access")
        if token_type == "access":
            email: Optional[str] = payload.get("sub")
            if email:
                user = db.query(User).filter(User.email == email).first()
                if user:
                    return OrgContext(
                        organization_id=user.organization_id,
                        user=user,
                        integration_token_id=None,
                        auth_type="user",
                    )
    except JWTError:
        # fall through to integration token path
        pass

    # 2) Try as integration token (opaque string)
    token_hash = _hash_integration_token(token)
    integ = (
        db.query(IntegrationToken)
        .filter(
            IntegrationToken.token_hash == token_hash,
            IntegrationToken.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not integ:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Best-effort last_used_at update; don't let failures break the request
    try:
        integ.last_used_at = datetime.utcnow()
        db.add(integ)
        db.commit()
    except Exception:
        db.rollback()

    return OrgContext(
        organization_id=integ.organization_id,
        user=None,
        integration_token_id=integ.id,
        auth_type="integration",
    )


@router.get("/me", response_model=AccountMeOut)
def read_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Rich account endpoint used by the front-end to drive plan gating.
    Returns:
      - basic user info
      - attached organization summary (plan_key, flags)
      - top-level plan flags (enable_alerts, enable_reports)
    """
    org: Optional[Organization] = None
    if current_user.organization_id is not None:
        org = (
            db.query(Organization)
            .filter(Organization.id == current_user.organization_id)
            .first()
        )

    # Derive plan + flags with sane defaults
    plan_key: Optional[str] = None
    subscription_plan_key: Optional[str] = None
    enable_alerts: bool = True
    enable_reports: bool = True
    subscription_status: Optional[str] = None

    if org is not None:
        plan_key = getattr(org, "plan_key", None)
        subscription_plan_key = getattr(org, "subscription_plan_key", None) or plan_key

        raw_enable_alerts = getattr(org, "enable_alerts", None)
        raw_enable_reports = getattr(org, "enable_reports", None)

        # If DB flags are None, infer from plan (starter/growth = on)
        plan_for_flags = subscription_plan_key or plan_key or "cei-starter"
        default_enabled = plan_for_flags in ("cei-starter", "cei-growth")

        enable_alerts = (
            bool(raw_enable_alerts) if raw_enable_alerts is not None else default_enabled
        )
        enable_reports = (
            bool(raw_enable_reports)
            if raw_enable_reports is not None
            else default_enabled
        )

        subscription_status = getattr(org, "subscription_status", None)
    else:
        # No org attached: default to starter-like behaviour but with no org metadata
        subscription_plan_key = "cei-starter"
        enable_alerts = True
        enable_reports = True

    # Build org summary payload if org exists
    org_summary: Optional[OrgSummaryOut] = None
    if org is not None:
        org_summary = OrgSummaryOut(
            id=org.id,
            name=org.name,
            plan_key=plan_key,
            subscription_plan_key=subscription_plan_key,
            enable_alerts=enable_alerts,
            enable_reports=enable_reports,
            subscription_status=subscription_status,
        )

    # Derive a simple role label for now
    role = "admin" if getattr(current_user, "is_superuser", 0) else "member"

    return AccountMeOut(
        id=current_user.id,
        email=current_user.email,
        organization_id=current_user.organization_id,
        full_name=getattr(current_user, "full_name", None),
        role=role,
        org=org_summary,
        organization=org_summary,
        subscription_plan_key=subscription_plan_key,
        enable_alerts=enable_alerts,
        enable_reports=enable_reports,
        subscription_status=subscription_status,
    )


# === Integration token management endpoints ===


@router.post("/integration-tokens", response_model=IntegrationTokenWithSecret)
def create_integration_token(
    payload: IntegrationTokenCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a new long-lived integration token for the caller's organization.

    - Returns the raw token string ONCE (caller must store it).
    - Stores only a hash server-side.
    """
    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not attached to an organization",
        )

    raw_token = _generate_integration_token_string()
    token_hash = _hash_integration_token(raw_token)

    db_token = IntegrationToken(
        organization_id=current_user.organization_id,
        name=payload.name.strip() if payload.name.strip() else "Integration token",
        token_hash=token_hash,
        is_active=True,
    )

    db.add(db_token)
    db.commit()
    db.refresh(db_token)

    return IntegrationTokenWithSecret(
        id=db_token.id,
        name=db_token.name,
        is_active=db_token.is_active,
        created_at=db_token.created_at,
        last_used_at=db_token.last_used_at,
        token=raw_token,
    )


@router.get("/integration-tokens", response_model=List[IntegrationTokenOut])
def list_integration_tokens(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List integration tokens for the caller's organization (metadata only, no secrets).
    """
    if not current_user.organization_id:
        return []

    tokens = (
        db.query(IntegrationToken)
        .filter(IntegrationToken.organization_id == current_user.organization_id)
        .order_by(IntegrationToken.created_at.desc())
        .all()
    )
    return tokens


@router.delete("/integration-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_integration_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Soft-revoke an integration token (is_active = False).
    """
    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not attached to an organization",
        )

    token = (
        db.query(IntegrationToken)
        .filter(
            IntegrationToken.id == token_id,
            IntegrationToken.organization_id == current_user.organization_id,
        )
        .first()
    )

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration token not found",
        )

    token.is_active = False
    db.add(token)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
