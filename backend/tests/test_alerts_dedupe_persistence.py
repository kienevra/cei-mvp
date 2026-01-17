# backend/tests/test_alerts_dedupe_persistence.py
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from app.models import Organization, User, Site, TimeseriesRecord, AlertEvent, SiteEvent


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _find_test_auth_paths() -> Tuple[Optional[str], Optional[str]]:
    """
    Try to discover the test-only signup/login paths from the mounted FastAPI routes.
    We look for paths that contain both "auth" and "test" and end in "signup" or "login".
    """
    signup_path = None
    login_path = None

    for r in app.router.routes:
        path = getattr(r, "path", "") or ""
        if "/api/v1/" not in path:
            continue
        p = path.lower()
        if "auth" not in p:
            continue

        # Try typical naming variants
        if "test" in p and p.endswith("/signup"):
            signup_path = path
        if "test" in p and p.endswith("/login"):
            login_path = path

        # Some projects name these differently: /auth/signup-test, /auth/login-test, etc.
        if signup_path is None and ("test" in p or "tests" in p) and p.endswith("signup"):
            signup_path = path
        if login_path is None and ("test" in p or "tests" in p) and p.endswith("login"):
            login_path = path

    return signup_path, login_path


def _ensure_user_and_token(client: TestClient, email: str, password: str) -> str:
    """
    Robust token getter:
    1) If test-only routes are mounted, use them.
    2) Else, create user directly in DB and mint a JWT using the same primitives as prod.

    This keeps the test self-contained and avoids brittle assumptions about seed users.
    """
    signup_path, login_path = _find_test_auth_paths()

    # --- Path A: use test-only endpoints if present ---
    if signup_path and login_path:
        r = client.post(signup_path, json={"email": email, "password": password})
        if r.status_code not in (200, 201, 400):
            raise AssertionError(f"Unexpected test-signup status {r.status_code}: {r.text}")

        r = client.post(login_path, json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data, data
        return data["access_token"]

    # --- Path B: mint a token ourselves (no route dependency) ---
    # We mint a JWT in the same shape your get_current_user expects:
    #   {"sub": "<user_email>", "type": "access", "exp": ...}
    from jose import jwt  # type: ignore
    from app.core.config import get_settings  # type: ignore

    settings = get_settings()

    db = SessionLocal()
    try:
        # Create org (must be unique across repeated pytest runs)
        org = Organization(
            name=f"Test Org {uuid4().hex[:10]}",
            enable_alerts=True,
            subscription_plan_key="cei-growth",
            subscription_status="active",
        )
        db.add(org)
        db.flush()

        # Create user (we do NOT need a real password hash because we never log in)
        user = User(
            email=email,
            hashed_password="pytest_dummy_hash",
            is_active=1,
            role="owner",
            organization_id=org.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        exp = datetime.now(timezone.utc) + timedelta(
            minutes=int(getattr(settings, "access_token_expire_minutes", 30))
        )
        payload = {"sub": user.email, "type": "access", "exp": exp}

        token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        assert isinstance(token, str) and token
        return token
    finally:
        db.close()


def _site_org_fk_attr() -> str:
    """
    The Site model's FK to Organization has historically been named either:
      - organization_id
      - org_id
    Pick the one that exists so this test doesn't drift when models evolve.
    """
    if hasattr(Site, "organization_id"):
        return "organization_id"
    if hasattr(Site, "org_id"):
        return "org_id"
    raise AssertionError("Site model has no org FK attribute (expected organization_id or org_id)")


def test_alerts_endpoint_does_not_spam_history_or_timeline():
    """
    Regression test: calling /alerts repeatedly must NOT spam:
      - alert_events (history)
      - site_events (timeline)

    Self-contained:
      - creates org/site/timeseries directly in test DB
      - obtains token via test auth routes if present, otherwise mints JWT directly

    Important behavior:
      - The FIRST call to /alerts may legitimately persist 0..N alert events depending on rules triggered.
      - Repeated calls must NOT keep persisting duplicates (dedupe must hold).
    """
    client = TestClient(app)

    email = f"alerts_dedupe_{uuid4().hex[:10]}@test.local"
    password = "TestPassword123!"

    token = _ensure_user_and_token(client, email, password)
    headers = {"Authorization": f"Bearer {token}"}

    now = _utcnow()
    window_hours = 24
    window_start = now - timedelta(hours=window_hours)

    site_fk = _site_org_fk_attr()

    # Seed site + timeseries so alerts actually produce persisted events (once)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None, "Test user missing after token creation"
        org_id = getattr(user, "organization_id", None)
        assert org_id is not None, "User has no organization_id"

        # Create/find a Site that belongs to THIS org (avoid collisions with demo/seed data)
        site = db.query(Site).filter(getattr(Site, site_fk) == org_id).first()
        if site is None:
            site = Site(name="Test Site (alerts dedupe)")
            setattr(site, site_fk, org_id)
            db.add(site)
            db.flush()  # ensures site.id assigned

        site_key = f"site-{site.id}"

        # Seed hourly points for this site_key
        ts0 = window_start.replace(minute=0, second=0, microsecond=0)
        rows = []
        for i in range(window_hours):
            t = ts0 + timedelta(hours=i)
            hour = t.hour
            is_night = hour in {0, 1, 2, 3, 4, 5, 22, 23}
            val = 10.0 if is_night else 15.0  # night/day ~0.67 (should trigger warning)
            rows.append(
                TimeseriesRecord(
                    organization_id=org_id,
                    site_id=site_key,
                    meter_id="m-1",
                    timestamp=t,
                    value=val,
                    unit="kwh",
                    source="pytest",
                    idempotency_key=f"pytest_{uuid4().hex}_{i}",
                )
            )

        db.add_all(rows)
        db.commit()

        before_ae = (
            db.query(AlertEvent)
            .filter(AlertEvent.organization_id == org_id, AlertEvent.site_id == site_key)
            .count()
        )
        before_se = (
            db.query(SiteEvent)
            .filter(
                SiteEvent.organization_id == org_id,
                SiteEvent.site_id == site_key,
                SiteEvent.type == "alert_triggered",
            )
            .count()
        )
    finally:
        db.close()

    # First call: allowed to persist 0..N events depending on rules triggered
    r = client.get(
        f"/api/v1/alerts?window_hours={window_hours}&site_id={site_key}",
        headers=headers,
    )
    assert r.status_code == 200, r.text

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        org_id = user.organization_id
        assert org_id is not None

        baseline_ae = (
            db.query(AlertEvent)
            .filter(AlertEvent.organization_id == org_id, AlertEvent.site_id == site_key)
            .count()
        )
        baseline_se = (
            db.query(SiteEvent)
            .filter(
                SiteEvent.organization_id == org_id,
                SiteEvent.site_id == site_key,
                SiteEvent.type == "alert_triggered",
            )
            .count()
        )
    finally:
        db.close()

    # Sanity: first call can add multiple distinct alerts; it must not REMOVE anything.
    assert baseline_ae >= before_ae, f"AlertEvent count went backwards: {before_ae} -> {baseline_ae}"
    assert baseline_se >= before_se, f"SiteEvent count went backwards: {before_se} -> {baseline_se}"

    # Spam /alerts (must not add more events due to dedupe)
    for _ in range(30):
        r = client.get(
            f"/api/v1/alerts?window_hours={window_hours}&site_id={site_key}",
            headers=headers,
        )
        assert r.status_code == 200, r.text

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        org_id = user.organization_id
        assert org_id is not None

        after_ae = (
            db.query(AlertEvent)
            .filter(AlertEvent.organization_id == org_id, AlertEvent.site_id == site_key)
            .count()
        )
        after_se = (
            db.query(SiteEvent)
            .filter(
                SiteEvent.organization_id == org_id,
                SiteEvent.site_id == site_key,
                SiteEvent.type == "alert_triggered",
            )
            .count()
        )
    finally:
        db.close()

    assert after_ae == baseline_ae, f"AlertEvent spam detected: {baseline_ae} -> {after_ae}"
    assert after_se == baseline_se, f"SiteEvent spam detected: {baseline_se} -> {after_se}"
