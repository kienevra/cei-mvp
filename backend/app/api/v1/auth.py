# backend/app/api/v1/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import JWTError, jwt
from pydantic import BaseModel
from typing import Optional
from app.db.session import get_db
from app.models import User
import os
import logging
from datetime import datetime, timedelta

logger = logging.getLogger("cei")

SECRET_KEY = os.environ.get("JWT_SECRET", "supersecret")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# Use Argon2 for password hashing (good long-term choice)
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# OAuth2 token endpoint (final full path will be /api/v1/auth/login when router is included under /api/v1)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Router mounted at /auth but included under /api/v1 in main.py (-> /api/v1/auth/*)
router = APIRouter(prefix="/auth", tags=["auth"])


class UserCreate(BaseModel):
    email: str
    password: str
    # Support both canonical `organization_id` and the legacy `org_id` for quick compatibility.
    # Quick-fix B: accept the legacy name and map it server-side.
    organization_id: Optional[int] = None
    org_id: Optional[int] = None


class Token(BaseModel):
    access_token: str
    token_type: str


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


@router.post("/signup", response_model=Token)
def signup(user: UserCreate, db: Session = Depends(get_db)):
    """
    Signup endpoint.
    Quick-fix B behavior:
      - Accepts either `organization_id` (preferred) or `org_id` (legacy).
      - If `org_id` is provided, it will be used but logged as deprecated usage.
    """
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Resolve organization id accepting both names (prefer canonical)
    organization_id = user.organization_id if user.organization_id is not None else user.org_id
    if user.org_id is not None and user.organization_id is None:
        # Log deprecation usage so integrators can be warned (no PII)
        logger.warning("Received deprecated payload field `org_id`; prefer `organization_id` (will be removed in future).")

    # Hash password (ensure it's string)
    try:
        password_str = str(user.password)
        hashed_password = pwd_context.hash(password_str)
    except Exception as e:
        logger.exception("Password hashing failed")
        raise HTTPException(status_code=400, detail=f"Password hashing failed: {e}")

    db_user = User(
        email=user.email,
        hashed_password=hashed_password,
        # If your User model uses a different column name adjust accordingly.
        organization_id=organization_id,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    token = create_access_token({"sub": db_user.email})
    return {"access_token": token, "token_type": "bearer"}


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Login expects form-encoded fields: username and password.
    Example (curl):
      curl -X POST "https://<host>/api/v1/auth/login" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=test@example.com&password=MyS3cret!"
    """
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token({"sub": user.email})
    return {"access_token": token, "token_type": "bearer"}


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: Optional[str] = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception

    return user
