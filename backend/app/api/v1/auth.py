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
    Request,
    Response,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
import re

def _validate_password_strength(password: str) -> None:
    """
    Enforce password policy:
    - Minimum 8 characters
    - At least one uppercase letter
    - At least one digit
    - At least one special character
    Raises HTTPException 422 if policy is not met.
    """
    errors = []
    if len(password) < 8:
        errors.append("at least 8 characters")
    if not re.search(r"[A-Z]", password):
        errors.append("at least one uppercase letter")
    if not re.search(r"\d", password):
        errors.append("at least one digit (0-9)")
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?`~]", password):
        errors.append("at least one special character (!@#$%^&*...)")
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must contain: {', '.join(errors)}.",
        )
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import login_rate_limit, refresh_rate_limit
from app.core.security import get_current_user
from app.models import IntegrationToken
from app.db.session import get_db
from app.models import Organization, User
from app.api.deps import require_owner, create_org_audit_event

logger = logging.getLogger("cei")

# === JWT / security settings ===
SECRET_KEY = settings.jwt_secret
ALGORITHM = settings.jwt_algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes
REFRESH_TOKEN_EXPIRE_DAYS = settings.refresh_token_expire_days

if settings.is_prod and SECRET_KEY in {"supersecret", "changeme", "secret", "", None}:
    raise RuntimeError(
        "Insecure JWT_SECRET configured in production environment. "
        "Set a strong random secret via the JWT_SECRET env var."
    )

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "cei_refresh_token"
INTEGRATION_TOKEN_PREFIX = "cei_int_"
INVITE_TOKEN_PREFIX = "cei_inv_"

# Phase 5: valid roles in the system
# "owner"   — org creator / full admin
# "member"  — standard org member (default)
# "manager" — managing org user who can administer client orgs
#             but cannot perform destructive actions (delete org, revoke tokens)
VALID_ROLES = {"owner", "member", "manager"}


# === Schemas ===




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

    # Phase 1: managing org hierarchy fields
    org_type: Optional[str] = None
    managed_by_org_id: Optional[int] = None
    client_limit: Optional[int] = None

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

    # Phase 5: "owner" | "member" | "manager"
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


class DelegatedTokenCreate(BaseModel):
    """Create an integration token pre-scoped to a client org."""
    name: str = Field(default="Delegated integration token", min_length=1)
    target_org_id: int = Field(..., description="Client org ID this token will act on behalf of")


# Phase 5: schema for role assignment endpoint
class AssignRoleIn(BaseModel):
    user_id: int
    role: str = Field(..., description="'owner' | 'member' | 'manager'")

    model_config = {"extra": "forbid"}


# === Access kill-switch helpers ===

def _is_user_active(user: Optional[User]) -> bool:
    if not user:
        return False
    if not hasattr(user, "is_active"):
        return True
    v = getattr(user, "is_active", 1)
    try:
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

    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=max_age,
        path="/",
        domain=".carbonefficiencyintel.com",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        path="/",
        domain=".carbonefficiencyintel.com",
        samesite="none",
        secure=True,
    )


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_integration_token_string() -> str:
    return INTEGRATION_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _normalize_currency_code(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    c = str(code).strip().upper()
    return c or None


def _normalize_user_role(*, user: User) -> str:
    """
    Canonical roles for CEI SaaS: owner / member / manager (Phase 5).

    - Returns the DB role if it's a known valid role.
    - If missing/unknown, defaults to "member".
    - If legacy superuser is set but role missing, defaults to "owner".
    """
    db_role = getattr(user, "role", None)
    if isinstance(db_role, str):
        r = db_role.strip().lower()
        if r in VALID_ROLES:
            return r

    is_super = bool(getattr(user, "is_superuser", 0) or 0)
    if is_super:
        return "owner"

    return "member"


# === Compatibility shim for /api/v1/org/invites ===
def _require_owner(user: User) -> None:
    require_owner(user, message="Only the organization owner can manage organization invites.")

# ---------------------------------------------------------------------------
# Signup
# ---------------------------------------------------------------------------



class UserCreate(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None
    organization_name: Optional[str] = None
    org_type: Optional[str] = None  # "managing" or "standalone"
    ui_lang: Optional[str] = None   # "it" or "en" from CEI UI toggle
    terms_accepted: Optional[bool] = None  # must be True to register
    aggregate_data_consent: Optional[bool] = None  # optional GDPR consent for anonymised benchmarking
    partner_name: Optional[str] = None  # commercialista studio name for co-branded PDFs


@router.post("/signup", response_model=Token, dependencies=[Depends(login_rate_limit)])
def signup(user: UserCreate, response: Response, request: Request, db: Session = Depends(get_db)) -> Token:
    """Self-serve signup. Creates org + owner user."""
    email_norm = (user.email or "").strip().lower()
    if not email_norm:
        raise HTTPException(status_code=400, detail="Email is required")
    if db.query(User).filter(User.email == email_norm).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    org_name = (user.organization_name or "").strip()
    if not org_name:
        org_name = email_norm.split("@")[0] + " Org"

    if db.query(Organization).filter(Organization.name == org_name).first():
        raise HTTPException(
            status_code=409,
            detail={"code": "ORG_NAME_TAKEN", "message": "Organization name already exists."},
        )

    from datetime import datetime, timezone, timedelta
    org = Organization(name=org_name)
    org.org_type = "managing" if user.org_type == "managing" else "standalone"
    if user.partner_name and user.partner_name.strip():
        org.partner_name = user.partner_name.strip()
    org.trial_ends_at = datetime.now(timezone.utc) + timedelta(days=30)
    for k, v in [("plan_key", "cei-starter"), ("subscription_plan_key", "cei-starter"),
                 ("enable_alerts", True), ("enable_reports", True), ("subscription_status", "active")]:
        try:
            setattr(org, k, v)
        except Exception:
            pass
    db.add(org)
    db.flush()

    _validate_password_strength(str(user.password))
    hashed_password = pwd_context.hash(str(user.password))
    from datetime import datetime, timezone
    if not user.terms_accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "TERMS_NOT_ACCEPTED", "message": "You must accept the Terms of Service and Privacy Policy to register."},
        )
    db_user = User(email=email_norm, hashed_password=hashed_password,
                   organization_id=org.id)
    db_user.terms_accepted_at = datetime.now(timezone.utc)
    if user.aggregate_data_consent:
        try:
            db_user.aggregate_data_consent = True
            db_user.aggregate_data_consent_at = datetime.now(timezone.utc)
        except Exception:
            pass
    try:
        db_user.role = "owner"
    except Exception:
        pass
    if user.full_name:
        try:
            db_user.full_name = user.full_name
        except Exception:
            pass
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    create_org_audit_event(db, org_id=org.id, user_id=getattr(db_user, "id", None),
                           title="Organization created", description=f"name={org.name}; owner={email_norm}")

    try:
        from app.services.digest_email import send_welcome_email
        # UI language takes priority over browser Accept-Language header
        accept_lang = request.headers.get("accept-language")
        if user.ui_lang and user.ui_lang.strip().lower() in ("it", "en"):
            accept_lang = user.ui_lang.strip().lower()
        send_welcome_email(
            to_email=email_norm,
            org_name=org.name,
            org_type=getattr(org, "org_type", None) or (user.org_type if hasattr(user, "org_type") else "standalone"),
            accept_language=accept_lang,
            full_name=getattr(db_user, "full_name", None),
        )
    except Exception:
        logger.exception("send_welcome_email failed for %s", email_norm)

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
    email_norm = (form_data.username or "").strip().lower()
    user = db.query(User).filter(User.email == email_norm).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
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
            # Phase 1: hierarchy fields now surfaced in /auth/me
            org_type=getattr(org, "org_type", "standalone"),
            managed_by_org_id=getattr(org, "managed_by_org_id", None),
            client_limit=getattr(org, "client_limit", None),
            primary_energy_sources=primary_energy_sources,
            electricity_price_per_kwh=electricity_price_per_kwh,
            gas_price_per_kwh=gas_price_per_kwh,
            currency_code=currency_code,
        )

    # Phase 5: canonical roles include "manager"
    role = _normalize_user_role(user=current_user)

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


# === Integration token management ===

@router.post("/integration-tokens", response_model=IntegrationTokenWithSecret)
def create_integration_token(
    payload: IntegrationTokenCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IntegrationTokenWithSecret:
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
    _ensure_user_active_or_403(current_user)

    if not current_user.organization_id:
        return []

    require_owner(current_user, message="Only the organization owner can manage integration tokens.")

    return (
        db.query(IntegrationToken)
        .filter(IntegrationToken.organization_id == current_user.organization_id)
        .order_by(IntegrationToken.created_at.desc())
        .all()
    )


@router.post("/integration-tokens/delegated", response_model=IntegrationTokenWithSecret)
def create_delegated_integration_token(
    payload: DelegatedTokenCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IntegrationTokenWithSecret:
    """
    Create an integration token pre-scoped to a client org.

    Only managing org owners can call this. The token automatically scopes
    all requests to target_org_id without needing X-CEI-ORG-ID on every call.

    Rules:
    - Caller must be owner of a managing org.
    - target_org_id must be a client org managed by the caller's org.
    """
    _ensure_user_active_or_403(current_user)

    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not attached to an organization.",
        )

    require_owner(current_user, message="Only the organization owner can create delegated tokens.")

    # Caller's org must be managing type
    caller_org = db.query(Organization).filter(
        Organization.id == current_user.organization_id
    ).first()
    if not caller_org or getattr(caller_org, "org_type", "standalone") != "managing":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOT_A_MANAGING_ORG",
                "message": "Delegated tokens can only be created by managing organizations.",
            },
        )

    # Target org must exist and be managed by caller's org
    target_org = db.query(Organization).filter(
        Organization.id == payload.target_org_id
    ).first()
    if not target_org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "CLIENT_ORG_NOT_FOUND",
                "message": f"Organization id={payload.target_org_id} not found.",
            },
        )
    if getattr(target_org, "managed_by_org_id", None) != current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOT_YOUR_CLIENT_ORG",
                "message": f"Organization id={payload.target_org_id} is not managed by your organization.",
            },
        )

    raw_token = _generate_integration_token_string()
    token_hash = _hash_token(raw_token)
    name = (payload.name or "").strip() or "Delegated integration token"

    db_token = IntegrationToken(
        organization_id=current_user.organization_id,
        name=name,
        token_hash=token_hash,
        is_active=True,
    )
    # Store target_org_id if column exists (added by migration e61d34e92155)
    try:
        db_token.target_org_id = payload.target_org_id
    except Exception:
        pass

    db.add(db_token)
    db.commit()
    db.refresh(db_token)

    create_org_audit_event(
        db,
        org_id=current_user.organization_id,
        user_id=getattr(current_user, "id", None),
        title="Delegated integration token created",
        description=(
            f"name={db_token.name}; token_id={db_token.id}; "
            f"target_org_id={payload.target_org_id}; target_org_name={target_org.name}"
        ),
    )

    return IntegrationTokenWithSecret(
        id=db_token.id,
        name=db_token.name,
        is_active=db_token.is_active,
        created_at=db_token.created_at,
        last_used_at=db_token.last_used_at,
        token=raw_token,
    )


@router.delete("/integration-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_integration_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
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


# === Phase 5: Role assignment ===

@router.patch(
    "/users/{user_id}/role",
    status_code=status.HTTP_200_OK,
)
def assign_user_role(
    user_id: int,
    payload: AssignRoleIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """
    Assign a role to a user in the same organization.

    Phase 5 adds the "manager" role for managing org users.

    Valid roles: "owner" | "member" | "manager"

    Rules:
    - Caller must be the org owner.
    - Target user must be in the same organization.
    - An org must always have at least one owner — cannot demote the
      last owner to member/manager.
    - Only managing orgs can assign the "manager" role.
    """
    _ensure_user_active_or_403(current_user)
    require_owner(current_user, message="Only the organization owner can assign roles.")

    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_ORG", "message": "You are not attached to an organization."},
        )

    new_role = (payload.role or "").strip().lower()
    if new_role not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "INVALID_ROLE",
                "message": f"Invalid role '{new_role}'. Valid roles: {sorted(VALID_ROLES)}",
            },
        )

    # Validate "manager" can only be assigned in a managing org
    if new_role == "manager":
        org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
        org_type = getattr(org, "org_type", "standalone") or "standalone"
        if org_type != "managing":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "NOT_A_MANAGING_ORG",
                    "message": (
                        "The 'manager' role can only be assigned in a managing organization. "
                        "Upgrade your org to managing first via POST /api/v1/org/upgrade-to-managing."
                    ),
                },
            )

    target_user = db.query(User).filter(
        User.id == user_id,
        User.organization_id == current_user.organization_id,
    ).first()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "USER_NOT_FOUND", "message": f"User id={user_id} not found in your organization."},
        )

    # Prevent demoting the last owner
    if target_user.role == "owner" and new_role != "owner":
        owner_count = (
            db.query(User)
            .filter(
                User.organization_id == current_user.organization_id,
                User.role == "owner",
            )
            .count()
        )
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "LAST_OWNER",
                    "message": (
                        "Cannot demote the last owner. "
                        "Assign another user as owner first."
                    ),
                },
            )

    old_role = target_user.role
    target_user.role = new_role
    db.add(target_user)
    db.commit()
    db.refresh(target_user)

    create_org_audit_event(
        db,
        org_id=current_user.organization_id,
        user_id=getattr(current_user, "id", None),
        title="User role changed",
        description=(
            f"target_user_id={target_user.id}; target_email={target_user.email}; "
            f"old_role={old_role}; new_role={new_role}; "
            f"changed_by={current_user.email}"
        ),
    )

    return {
        "user_id": target_user.id,
        "email": target_user.email,
        "role": target_user.role,
        "organization_id": target_user.organization_id,
    }

# ---------------------------------------------------------------------------
# Accept partner invite ? factory self-onboarding
# ---------------------------------------------------------------------------

class AcceptInviteIn(BaseModel):
    org_name:  str
    email:     str
    password:  str
    full_name: Optional[str] = None


@router.post(
    "/auth/accept-invite/{token}",
    summary="Factory signup via partner invite link",
    status_code=status.HTTP_201_CREATED,
)
def accept_partner_invite(
    token: str,
    payload: AcceptInviteIn,
    response: Response,
    db: Session = Depends(get_db),
):
    import hashlib as _hl
    from datetime import timezone
    from app.models import PartnerInvite

    # 1. Validate token
    token_hash = _hl.sha256(token.encode()).hexdigest()
    inv = db.query(PartnerInvite).filter(
        PartnerInvite.token_hash == token_hash,
    ).first()

    if not inv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "INVITE_NOT_FOUND", "message": "Invite link is invalid."},
        )
    if inv.revoked_at:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_REVOKED", "message": "This invite link has been revoked."},
        )
    if inv.used_at:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_USED", "message": "This invite link has already been used."},
        )
    if datetime.now(timezone.utc) >= inv.expires_at:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "INVITE_EXPIRED", "message": "This invite link has expired. Ask your energy manager for a new one."},
        )

    # 2. Check email not already registered
    email_norm = (payload.email or "").strip().lower()
    if db.query(User).filter(User.email == email_norm).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_TAKEN", "message": "An account with this email already exists."},
        )

    # 3. Create factory org linked to managing org
    factory_org = Organization(
        name              = payload.org_name.strip(),
        org_type          = "client",
        managed_by_org_id = inv.managing_org_id,
    )
    db.add(factory_org)
    db.flush()  # get factory_org.id before creating user

    # 4. Create owner user
    hashed_pw = get_password_hash(payload.password)
    user = User(
        email           = email_norm,
        full_name       = (payload.full_name or "").strip() or None,
        hashed_password = hashed_pw,
        organization_id = factory_org.id,
        role            = "owner",
        is_active       = 1,
    )
    db.add(user)
    db.flush()

    # 5. Mark invite used
    inv.used_at        = datetime.now(timezone.utc)
    inv.used_by_org_id = factory_org.id
    db.add(inv)
    db.commit()
    db.refresh(user)

    # 6. Issue JWT and return (same as normal signup)
    access_token  = create_access_token({"sub": user.email, "type": "access"})
    refresh_token = create_refresh_token({"sub": user.email, "type": "refresh"})
    _set_refresh_cookie(response, refresh_token)

    return {
        "access_token": access_token,
        "token_type":   "bearer",
        "user": {
            "id":              user.id,
            "email":           user.email,
            "full_name":       user.full_name,
            "role":            user.role,
            "organization_id": user.organization_id,
            "org_name":        factory_org.name,
            "org_type":        factory_org.org_type,
            "managed_by_org_id": factory_org.managed_by_org_id,
        },
    }


# ---------------------------------------------------------------------------
# Partner invite info — public endpoint to preview invite before signup
# ---------------------------------------------------------------------------

@router.get(
    "/auth/invite-info/{token}",
    summary="Preview partner invite details before accepting",
)
def get_partner_invite_info(
    token: str,
    db: Session = Depends(get_db),
):
    import hashlib as _hl
    from datetime import timezone
    from app.models import PartnerInvite, Organization

    token_hash = _hl.sha256(token.encode()).hexdigest()
    inv = db.query(PartnerInvite).filter(
        PartnerInvite.token_hash == token_hash,
    ).first()

    if not inv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "INVITE_NOT_FOUND", "message": "Invite link is invalid."},
        )

    managing_org = db.query(Organization).filter(
        Organization.id == inv.managing_org_id
    ).first()

    partner_name = (
        getattr(managing_org, 'partner_name', None)
        or getattr(managing_org, 'name', None)
        or 'Your energy consultant'
    )

    return {
        "status":        inv.status,
        "factory_name":  inv.factory_name,
        "factory_email": inv.factory_email,
        "partner_name":  partner_name,
        "expires_at":    inv.expires_at.isoformat() if inv.expires_at else None,
    }
