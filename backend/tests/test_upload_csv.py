from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Generator, Optional

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# --- Import app + dependencies we will override ---
from app.main import app
from app.db.session import get_db
from app.core.security import get_current_user

# Models (your upload_csv imports Site from app.models, so we align)
from app.models import Organization, Site

# Base metadata: try common locations (your repo has shifted over time)
try:
    from app.models import Base  # type: ignore
except Exception:  # pragma: no cover
    try:
        from app.db.base import Base  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError(
            "Could not import SQLAlchemy Base. Tried `app.models.Base` and `app.db.base.Base`."
        ) from e


@dataclass
class DummyUser:
    """
    Minimal shape needed by upload_csv.py:
      - organization_id is used
      - (optionally) org_id might exist elsewhere; safe to provide both
    """
    id: int = 1
    email: str = "test@cei.local"
    organization_id: int = 1
    org_id: int = 1
    role: str = "owner"


@pytest.fixture(scope="function")
def db_session() -> Generator:
    """
    In-memory SQLite DB for each test.
    StaticPool keeps the same in-memory DB across connections within a test.
    """
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Create schema for all models
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        # Seed minimal org + sites so upload_csv org scoping works
        org = Organization(name="Test Org")  # other fields can default/null
        db.add(org)
        db.flush()  # ensure org.id is available

        # Create a few sites in this org; ids 1..3 produce site-1..site-3
        s1 = Site(id=1, name="Site 1", location="Test",)  # type: ignore[arg-type]
        s2 = Site(id=2, name="Site 2", location="Test",)  # type: ignore[arg-type]
        s3 = Site(id=3, name="Site 3", location="Test",)  # type: ignore[arg-type]

        # Your Site model has used org_id historically. Some variants use organization_id.
        for s in (s1, s2, s3):
            if hasattr(s, "org_id"):
                setattr(s, "org_id", org.id)
            if hasattr(s, "organization_id"):
                setattr(s, "organization_id", org.id)

        db.add_all([s1, s2, s3])
        db.commit()

        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.fixture(scope="function")
def client(db_session) -> Generator[TestClient, None, None]:
    """
    TestClient wired to the app with dependency overrides:
      - get_db -> in-memory session
      - get_current_user -> DummyUser(org_id=1)
    """
    def _override_get_db():
        yield db_session

    def _override_get_current_user():
        return DummyUser(organization_id=1, org_id=1)

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def _csv_bytes(lines: str) -> bytes:
    return (lines.strip() + "\n").encode("utf-8")


def _ts(hours_ago: int = 1) -> str:
    # upload_csv expects timezone-aware UTC timestamps; Z-format is safest
    dt = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=hours_ago)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _future_ts() -> str:
    return "2099-01-01T00:00:00Z"


def test_upload_csv_happy_path_ingests_one_row(client: TestClient):
    content = _csv_bytes(
        f"""
timestamp,value,unit,site_id,meter_id
{_ts(1)},10.0,kWh,site-1,meter-main-1
"""
    )
    r = client.post(
        "/api/v1/upload-csv/",
        files={"file": ("good.csv", content, "text/csv")},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["rows_received"] == 1
    assert data["rows_ingested"] == 1
    assert data["rows_failed"] == 0
    assert data["rows_skipped_duplicate"] == 0
    assert data["errors"] == []


def test_upload_csv_second_upload_is_duplicate_skipped(client: TestClient):
    content = _csv_bytes(
        f"""
timestamp,value,unit,site_id,meter_id
{_ts(1)},10.0,kWh,site-1,meter-main-1
"""
    )

    r1 = client.post("/api/v1/upload-csv/", files={"file": ("good.csv", content, "text/csv")})
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["rows_ingested"] == 1

    r2 = client.post("/api/v1/upload-csv/", files={"file": ("good.csv", content, "text/csv")})
    assert r2.status_code == 200, r2.text
    d2 = r2.json()
    assert d2["rows_received"] == 1
    assert d2["rows_ingested"] == 0
    # Depending on ingest behavior, it may show skipped_duplicate=1
    assert d2["rows_skipped_duplicate"] >= 1
    # Error list may include DUPLICATE_IDEMPOTENCY_KEY (fine)
    assert isinstance(d2["errors"], list)


def test_upload_csv_future_timestamp_fails(client: TestClient):
    content = _csv_bytes(
        f"""
timestamp,value,unit,site_id,meter_id
{_future_ts()},123.4,kWh,site-1,meter-main-1
"""
    )
    r = client.post("/api/v1/upload-csv/", files={"file": ("bad_future.csv", content, "text/csv")})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["rows_received"] == 1
    assert data["rows_ingested"] == 0
    assert data["rows_failed"] == 1
    assert any("future" in str(e).lower() for e in data["errors"])


def test_upload_csv_site_outside_org_fails(client: TestClient):
    content = _csv_bytes(
        f"""
timestamp,value,unit,site_id,meter_id
{_ts(1)},10.0,kWh,site-9999,meter-main-1
"""
    )
    r = client.post("/api/v1/upload-csv/", files={"file": ("bad_site.csv", content, "text/csv")})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["rows_received"] == 1
    assert data["rows_ingested"] == 0
    assert data["rows_failed"] == 1
    assert any("not in your organization" in str(e).lower() for e in data["errors"])


def test_upload_csv_forced_site_id_allows_missing_site_id_column(client: TestClient):
    # When site_id query param is provided, CSV does not need a site_id column
    content = _csv_bytes(
        f"""
timestamp,value,unit,meter_id
{_ts(1)},7.5,kWh,meter-main-1
"""
    )
    r = client.post(
        "/api/v1/upload-csv/?site_id=site-1",
        files={"file": ("forced_site.csv", content, "text/csv")},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["rows_received"] == 1
    assert data["rows_ingested"] == 1
    assert data["rows_failed"] == 0


def test_upload_csv_missing_required_columns_returns_400(client: TestClient):
    # Missing timestamp/value/meter/site
    content = _csv_bytes(
        """
foo,bar
1,2
"""
    )
    r = client.post("/api/v1/upload-csv/", files={"file": ("bad_schema.csv", content, "text/csv")})
    assert r.status_code == 400, r.text
    detail = r.json()
    # upload_csv raises HTTPException with detail dict
    assert "detail" in detail
    assert detail["detail"].get("type") == "schema_error"


