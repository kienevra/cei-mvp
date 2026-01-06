# backend/tests/test_password_recovery_tz_and_frontend_url.py
from __future__ import annotations

import re
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.api.v1 import password_recovery as pwdrec


# --- Helpers ---------------------------------------------------------------

def _hash_token(raw: str) -> str:
    import hashlib
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _extract_reset_link(text: str) -> str:
    m = re.search(r"(https?://[^\s]+)", text)
    assert m, f"Could not find a reset link in email body:\n{text}"
    return m.group(1)


# --- Fixtures --------------------------------------------------------------

@pytest.fixture()
def app_and_db(monkeypatch):
    """
    Standalone FastAPI app + shared in-memory SQLite.

    Important: Using StaticPool makes the in-memory DB persist across sessions,
    which is required because FastAPI will create new sessions per request.
    """
    engine = create_engine(
        "sqlite+pysqlite://",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    # Create tables
    try:
        from app.db.base import Base  # type: ignore
    except Exception:
        from app.models import Base  # type: ignore

    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(pwdrec.router, prefix="/api/v1")

    def _override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    # Override the get_db that the router uses
    app.dependency_overrides[pwdrec.get_db] = _override_get_db

    # Patch send_email so we don't call a real provider
    sent = {"to": None, "subject": None, "text": None, "html": None}

    def _fake_send_email(*, to_email: str, subject: str, text_body: str, html_body=None):
        sent["to"] = to_email
        sent["subject"] = subject
        sent["text"] = text_body
        sent["html"] = html_body

    monkeypatch.setattr(pwdrec, "send_email", _fake_send_email)

    return app, SessionLocal, sent


# --- Tests ----------------------------------------------------------------

def test_forgot_password_uses_frontend_url_in_email_link(app_and_db, monkeypatch):
    app, SessionLocal, sent = app_and_db

    # Force FRONTEND_URL used by the endpoint
    monkeypatch.setattr(settings, "frontend_url", "https://carbonefficiencyintel.com", raising=False)

    from app.models import User

    db = SessionLocal()
    try:
        u = User(email="user@example.com", hashed_password="x", organization_id=None)
        if hasattr(u, "is_active"):
            u.is_active = 1
        db.add(u)
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    r = client.post("/api/v1/auth/password/forgot", json={"email": "user@example.com"})
    assert r.status_code == 200, r.text
    assert sent["to"] == "user@example.com"
    assert sent["subject"] == "Reset your CEI password"
    assert sent["text"] is not None

    link = _extract_reset_link(sent["text"])
    assert link.startswith("https://carbonefficiencyintel.com/reset-password?token="), link


def test_reset_password_accepts_naive_expires_at_and_does_not_500(app_and_db):
    """
    Regression: avoid 'can't compare offset-naive and offset-aware datetimes'.
    We store expires_at as NAIVE in DB and ensure reset still works.
    """
    app, SessionLocal, _sent = app_and_db
    client = TestClient(app)

    from app.models import User, PasswordResetToken

    raw_token = pwdrec.RESET_TOKEN_PREFIX + "testtoken_naive_expires"
    token_hash = _hash_token(raw_token)

    db = SessionLocal()
    try:
        u = User(email="naive@example.com", hashed_password=pwdrec.pwd_context.hash("oldpassword"), organization_id=None)
        if hasattr(u, "is_active"):
            u.is_active = 1
        db.add(u)
        db.commit()
        db.refresh(u)

        naive_expires = datetime.utcnow() + timedelta(minutes=10)  # intentionally naive
        prt = PasswordResetToken(
            user_id=u.id,
            email=u.email,
            token_hash=token_hash,
            expires_at=naive_expires,
            used_at=None,
            request_ip="127.0.0.1",
            user_agent="pytest",
        )
        db.add(prt)
        db.commit()
    finally:
        db.close()

    r = client.post("/api/v1/auth/password/reset", json={"token": raw_token, "new_password": "newpassword123"})
    assert r.status_code == 200, r.text
    assert r.json()["detail"].startswith("Password updated")

    db = SessionLocal()
    try:
        rec = db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == token_hash).first()
        assert rec is not None
        assert rec.used_at is not None
        # SQLite often returns naive datetimes even if inserted as tz-aware.
        # Normalize via the same helper used in the endpoint.
        used = pwdrec._as_aware_utc(rec.used_at)
        assert used is not None
        assert used.tzinfo is not None


        user = db.query(User).filter(User.email == "naive@example.com").first()
        assert user is not None
        assert pwdrec.pwd_context.verify("newpassword123", user.hashed_password)
    finally:
        db.close()


def test_reset_password_rejects_expired_token_even_if_naive(app_and_db):
    app, SessionLocal, _sent = app_and_db
    client = TestClient(app)

    from app.models import User, PasswordResetToken

    raw_token = pwdrec.RESET_TOKEN_PREFIX + "testtoken_expired_naive"
    token_hash = _hash_token(raw_token)

    db = SessionLocal()
    try:
        u = User(email="expired@example.com", hashed_password=pwdrec.pwd_context.hash("oldpassword"), organization_id=None)
        if hasattr(u, "is_active"):
            u.is_active = 1
        db.add(u)
        db.commit()
        db.refresh(u)

        naive_expired = datetime.utcnow() - timedelta(minutes=5)  # intentionally naive expired
        prt = PasswordResetToken(
            user_id=u.id,
            email=u.email,
            token_hash=token_hash,
            expires_at=naive_expired,
            used_at=None,
            request_ip="127.0.0.1",
            user_agent="pytest",
        )
        db.add(prt)
        db.commit()
    finally:
        db.close()

    r = client.post("/api/v1/auth/password/reset", json={"token": raw_token, "new_password": "newpassword123"})
    assert r.status_code == 410, r.text
    j = r.json()
    assert j["detail"]["code"] == "TOKEN_EXPIRED"
