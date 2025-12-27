# backend/app/api/v1/auth.py
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    HTTPException,
    Response,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import login_rate_limit, refresh_rate_limit
from app.core.security import get_current_user
from app.models import IntegrationToken  # integration tokens live here (shim)
from app.db.session import get_db
from app.models import Organization, User
from app.api.deps import require_owner, create_org_audit_event

logger = logging.getLogger("cei")

# === JWT / security settings ===
SECRET_KEY = settings.jwt_secret
ALGORITHM = settings.jwt_algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes
REFRESH_TOKEN_EXPIRE_DAYS = settings.refresh_token_expire_days

# Hard guard: never allow the default secret in production-like envs
if settings.is_prod and SECRET_KEY in {"supersecret", "changeme", "secret", "", None}:
    raise RuntimeError(
        "Insecure JWT_SECRET configured in production environment. "
        "Set a strong random secret via the JWT_SECRET env var."
    )

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "cei_refresh_token"
INTEGRATION_TOKEN_PREFIX = "cei_int_"

# NOTE: invite tokens are owned by /api/v1/org/invites (org_invites router).
INVITE_TOKEN_PREFIX = "cei_inv_"  # kept for consistency across the codebase


# === Schemas ===

class UserCreate(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None

    # Support both canonical `organization_id` and legacy `org_id`.
    organization_id: Optional[int] = None
    org_id: Optional[int] = None
    organization_name: Optional[str] = None

    # Optional org-level cost config at signup
    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None


class Token(BaseModel):
    access_token: str
    token_type: str


class OrgSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    plan_key: Optional[str] = None
    subscription_plan_key: Optional[str] = None
    enable_alerts: bool = True
    enable_reports: bool = True
    subscription_status: Optional[str] = None

    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None


class AccountMeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    organization_id: Optional[int] = None

    full_name: Optional[str] = None
    role: Optional[str] = None

    org: Optional[OrgSummaryOut] = None
    organization: Optional[OrgSummaryOut] = None

    subscription_plan_key: Optional[str] = None
    enable_alerts: bool = True
    enable_reports: bool = True
    subscription_status: Optional[str] = None

    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None


class IntegrationTokenCreate(BaseModel):
    name: str = Field(default="Integration token", min_length=1)


class IntegrationTokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None


class IntegrationTokenWithSecret(IntegrationTokenOut):
    token: str


# === Access kill-switch helpers ===

def _is_user_active(user: Optional[User]) -> bool:
    """
    Treat user.is_active as int 0/1 (legacy) but tolerate bool.
    Missing field => assume active (back-compat).
    """
    if not user:
        return False
    if not hasattr(user, "is_active"):
        return True
    v = getattr(user, "is_active", 1)
    try:
        # int 0/1 or bool
        return bool(int(v))
    except Exception:
        return bool(v)


def _ensure_user_active_or_403(user: User) -> None:
    if not _is_user_active(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "USER_DISABLED", "message": "User access has been disabled by the organization owner."},
        )


# === Token helpers ===

def create_access_token(data: Dict[str, Any]) -> str:
    to_encode = dict(data)
    to_encode.setdefault("type", "access")
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: Dict[str, Any]) -> str:
    to_encode = dict(data)
    to_encode["type"] = "refresh"
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
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


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_integration_token_string() -> str:
    return INTEGRATION_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _normalize_currency_code(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    c = str(code).strip().upper()
    return c or None


# === Compatibility shim for /api/v1/org/invites ===
def _require_owner(user: User) -> None:
    """
    Backward-compatible guard used by org_invites router.

    org_invites.py imports `_require_owner` from here.
    """
    require_owner(user, message="Only the organization owner can manage organization invites.")


# === Routes ===

@router.post(
    "/signup",
    response_model=Token,
    dependencies=[Depends(login_rate_limit)],
)
def signup(user: UserCreate, response: Response, db: Session = Depends(get_db)) -> Token:
    """
    Self-serve signup (no invites).
    Joining an existing org should be done via /api/v1/org/invites/accept-and-signup.
    """
    email_norm = (user.email or "").strip().lower()
    if not email_norm:
        raise HTTPException(status_code=400, detail="Email is required")

    existing_user = db.query(User).filter(User.email == email_norm).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    organization_id = user.organization_id if user.organization_id is not None else user.org_id
    if user.org_id is not None and user.organization_id is None:
        logger.warning("Received deprecated `org_id`; prefer `organization_id`.")

    org_obj: Optional[Organization] = None
    created_new_org = False

    primary_energy_sources = str(user.primary_energy_sources).strip() if user.primary_energy_sources else None
    currency_code = _normalize_currency_code(user.currency_code)

    owner_exists = True

    if organization_id is not None:
        org_obj = db.query(Organization).filter(Organization.id == organization_id).first()
        if org_obj is None:
            raise HTTPException(status_code=400, detail=f"Organization with id={organization_id} not found")

        # Best-effort cost engine config
        try:
            if primary_energy_sources:
                org_obj.primary_energy_sources = primary_energy_sources
        except Exception:
            pass
        try:
            if user.electricity_price_per_kwh is not None:
                org_obj.electricity_price_per_kwh = float(user.electricity_price_per_kwh)
        except Exception:
            pass
        try:
            if user.gas_price_per_kwh is not None:
                org_obj.gas_price_per_kwh = float(user.gas_price_per_kwh)
        except Exception:
            pass
        try:
            if currency_code:
                org_obj.currency_code = currency_code
        except Exception:
            pass

        try:
            owner_exists = (
                db.query(User)
                .filter(User.organization_id == org_obj.id, User.role == "owner")
                .first()
                is not None
            )
        except Exception:
            owner_exists = True

    else:
        if user.organization_name and user.organization_name.strip():
            org_name = user.organization_name.strip()
        else:
            email_prefix = email_norm.split("@")[0] if "@" in email_norm else email_norm
            org_name = f"{email_prefix} Org".strip() or "New Organization"

        existing_org_same_name = db.query(Organization).filter(Organization.name == org_name).first()
        if existing_org_same_name is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "ORG_NAME_TAKEN", "message": "Organization name already exists. Use an invite to join."},
            )

        org_obj = Organization(name=org_name)
        created_new_org = True
        owner_exists = False

        # Best-effort plan defaults
        for k, v in (
            ("plan_key", "cei-starter"),
            ("subscription_plan_key", "cei-starter"),
            ("enable_alerts", True),
            ("enable_reports", True),
            ("subscription_status", "active"),
        ):
            try:
                setattr(org_obj, k, v)
            except Exception:
                pass

        # Seed cost engine config
        try:
            if primary_energy_sources:
                org_obj.primary_energy_sources = primary_energy_sources
        except Exception:
            pass
        try:
            if user.electricity_price_per_kwh is not None:
                org_obj.electricity_price_per_kwh = float(user.electricity_price_per_kwh)
        except Exception:
            pass
        try:
            if user.gas_price_per_kwh is not None:
                org_obj.gas_price_per_kwh = float(user.gas_price_per_kwh)
        except Exception:
            pass
        try:
            if currency_code:
                org_obj.currency_code = currency_code
        except Exception:
            pass

        db.add(org_obj)
        db.flush()
        organization_id = org_obj.id

    # Hash password
    try:
        hashed_password = pwd_context.hash(str(user.password))
    except Exception as e:
        logger.exception("Password hashing failed")
        raise HTTPException(status_code=400, detail=f"Password hashing failed: {e}")

    db_user = User(email=email_norm, hashed_password=hashed_password, organization_id=organization_id)

    if user.full_name:
        try:
            db_user.full_name = user.full_name
        except Exception:
            pass

    # Role assignment
    try:
        if created_new_org or (organization_id is not None and owner_exists is False):
            db_user.role = "owner"
        else:
            db_user.role = "member"
    except Exception:
        pass

    # Ensure active by default (int flag 1/0)
    if hasattr(db_user, "is_active"):
        try:
            db_user.is_active = 1
        except Exception:
            pass

    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    if created_new_org and organization_id is not None:
        create_org_audit_event(
            db,
            org_id=organization_id,
            user_id=getattr(db_user, "id", None),
            title="Organization created",
            description=f"name={getattr(org_obj, 'name', None)}; owner_email={db_user.email}",
        )

    access = create_access_token({"sub": db_user.email})
    refresh = create_refresh_token({"sub": db_user.email})
    _set_refresh_cookie(response, refresh)
    return Token(access_token=access, token_type="bearer")


@router.post(
    "/login",
    response_model=Token,
    dependencies=[Depends(login_rate_limit)],
)
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> Token:
    """
    Canonical login endpoint.
    Expects application/x-www-form-urlencoded with fields: username, password.
    """
    email_norm = (form_data.username or "").strip().lower()
    user = db.query(User).filter(User.email == email_norm).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # ✅ Enforce revoked access at login
    _ensure_user_active_or_403(user)

    access = create_access_token({"sub": user.email})
    refresh = create_refresh_token({"sub": user.email})
    _set_refresh_cookie(response, refresh)
    return Token(access_token=access, token_type="bearer")


@router.post(
    "/refresh",
    response_model=Token,
    dependencies=[Depends(refresh_rate_limit)],
)
def refresh_access_token(
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> Token:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not refresh credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not refresh_token:
        raise credentials_exception

    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise credentials_exception
        email: Optional[str] = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception

    # ✅ Enforce revoked access at refresh
    _ensure_user_active_or_403(user)

    new_access = create_access_token({"sub": user.email})
    new_refresh = create_refresh_token({"sub": user.email})
    _set_refresh_cookie(response, new_refresh)
    return Token(access_token=new_access, token_type="bearer")


@router.post("/logout")
def logout_api(response: Response) -> dict:
    _clear_refresh_cookie(response)
    return {"detail": "Logged out."}


@router.get("/me", response_model=AccountMeOut)
def read_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AccountMeOut:
    # ✅ Enforce revoked access for active sessions
    _ensure_user_active_or_403(current_user)

    org: Optional[Organization] = None
    if current_user.organization_id is not None:
        org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()

    plan_key: Optional[str] = None
    subscription_plan_key: Optional[str] = None
    enable_alerts: bool = True
    enable_reports: bool = True
    subscription_status: Optional[str] = None

    primary_energy_sources: Optional[str] = None
    electricity_price_per_kwh: Optional[float] = None
    gas_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None

    if org is not None:
        plan_key = getattr(org, "plan_key", None)
        subscription_plan_key = getattr(org, "subscription_plan_key", None) or plan_key

        raw_enable_alerts = getattr(org, "enable_alerts", None)
        raw_enable_reports = getattr(org, "enable_reports", None)

        plan_for_flags = subscription_plan_key or plan_key or "cei-starter"
        default_enabled = plan_for_flags in ("cei-starter", "cei-growth")

        enable_alerts = bool(raw_enable_alerts) if raw_enable_alerts is not None else default_enabled
        enable_reports = bool(raw_enable_reports) if raw_enable_reports is not None else default_enabled

        subscription_status = getattr(org, "subscription_status", None)

        primary_energy_sources = getattr(org, "primary_energy_sources", None)
        electricity_price_per_kwh = getattr(org, "electricity_price_per_kwh", None)
        gas_price_per_kwh = getattr(org, "gas_price_per_kwh", None)
        currency_code = getattr(org, "currency_code", None)
    else:
        subscription_plan_key = "cei-starter"
        enable_alerts = True
        enable_reports = True

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
            primary_energy_sources=primary_energy_sources,
            electricity_price_per_kwh=electricity_price_per_kwh,
            gas_price_per_kwh=gas_price_per_kwh,
            currency_code=currency_code,
        )

    is_super = bool(getattr(current_user, "is_superuser", 0))
    db_role = getattr(current_user, "role", None)
    role = "admin" if is_super else (db_role or "member")

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
        primary_energy_sources=primary_energy_sources,
        electricity_price_per_kwh=electricity_price_per_kwh,
        gas_price_per_kwh=gas_price_per_kwh,
        currency_code=currency_code,
    )


# === Integration token management endpoints ===

@router.post("/integration-tokens", response_model=IntegrationTokenWithSecret)
def create_integration_token(
    payload: IntegrationTokenCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IntegrationTokenWithSecret:
    # ✅ Enforce revoked access
    _ensure_user_active_or_403(current_user)

    if not current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not attached to an organization")

    require_owner(current_user, message="Only the organization owner can manage integration tokens.")

    raw_token = _generate_integration_token_string()
    token_hash = _hash_token(raw_token)
    name = (payload.name or "").strip() or "Integration token"

    db_token = IntegrationToken(
        organization_id=current_user.organization_id,
        name=name,
        token_hash=token_hash,
        is_active=True,
    )

    db.add(db_token)
    db.commit()
    db.refresh(db_token)

    create_org_audit_event(
        db,
        org_id=current_user.organization_id,
        user_id=getattr(current_user, "id", None),
        title="Integration token created",
        description=f"name={db_token.name}; token_id={db_token.id}",
    )

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
) -> List[IntegrationTokenOut]:
    # ✅ Enforce revoked access
    _ensure_user_active_or_403(current_user)

    if not current_user.organization_id:
        return []

    require_owner(current_user, message="Only the organization owner can manage integration tokens.")

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
) -> Response:
    # ✅ Enforce revoked access
    _ensure_user_active_or_403(current_user)

    if not current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not attached to an organization")

    require_owner(current_user, message="Only the organization owner can manage integration tokens.")

    token = (
        db.query(IntegrationToken)
        .filter(
            IntegrationToken.id == token_id,
            IntegrationToken.organization_id == current_user.organization_id,
        )
        .first()
    )
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration token not found")

    if not bool(getattr(token, "is_active", True)):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    token.is_active = False
    db.add(token)
    db.commit()

    create_org_audit_event(
        db,
        org_id=current_user.organization_id,
        user_id=getattr(current_user, "id", None),
        title="Integration token revoked",
        description=f"name={getattr(token, 'name', None)}; token_id={token_id}",
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)
