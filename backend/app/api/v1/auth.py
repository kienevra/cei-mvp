# backend/app/api/v1/auth.py
from datetime import datetime, timedelta
import logging
import os
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Response,
    Cookie,
)
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import User
from app.core.rate_limit import rate_limit

logger = logging.getLogger("cei")

# === JWT / security settings ===
SECRET_KEY = os.environ.get("JWT_SECRET", "supersecret")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# Use Argon2 for password hashing (good long-term choice)
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# OAuth2 token endpoint (full path will be /api/v1/auth/login)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Router mounted at /auth but included under /api/v1 in main.py (-> /api/v1/auth/*)
router = APIRouter(prefix="/auth", tags=["auth"])


# === Schemas ===

class UserCreate(BaseModel):
  email: str
  password: str
  # Support both canonical `organization_id` and the legacy `org_id`.
  organization_id: Optional[int] = None
  org_id: Optional[int] = None


class Token(BaseModel):
  access_token: str
  token_type: str


class UserOut(BaseModel):
  id: int
  email: str
  organization_id: Optional[int]

  class Config:
      orm_mode = True


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
  NOTE: secure=False for local dev; set True in production over HTTPS.
  """
  max_age = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
  response.set_cookie(
      key="cei_refresh_token",
      value=refresh_token,
      httponly=True,
      secure=False,  # TODO: flip to True on HTTPS in production
      samesite="lax",
      max_age=max_age,
      path="/",
  )


def _clear_refresh_cookie(response: Response) -> None:
  response.delete_cookie("cei_refresh_token", path="/")


# === Routes ===


@router.post(
    "/signup",
    response_model=Token,
    dependencies=[Depends(rate_limit("signup", limit=5, window_seconds=3600))],
)
def signup(user: UserCreate, response: Response, db: Session = Depends(get_db)):
  """
  Signup endpoint.
  Accepts either `organization_id` (preferred) or legacy `org_id`.
  """
  existing_user = db.query(User).filter(User.email == user.email).first()
  if existing_user:
      raise HTTPException(status_code=400, detail="Email already registered")

  # Resolve org id
  organization_id = user.organization_id if user.organization_id is not None else user.org_id
  if user.org_id is not None and user.organization_id is None:
      logger.warning(
          "Received deprecated payload field `org_id`; "
          "prefer `organization_id` (will be removed in future)."
      )

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
    dependencies=[Depends(rate_limit("login", limit=5, window_seconds=60))],
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


@router.post("/refresh", response_model=Token)
def refresh_access_token(
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None, alias="cei_refresh_token"),
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


@router.get("/me", response_model=UserOut)
def read_me(current_user: User = Depends(get_current_user)):
  """
  Basic identity endpoint. Handy for debugging auth.
  """
  return current_user
