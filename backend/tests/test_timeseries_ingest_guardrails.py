# backend/tests/test_timeseries_ingest_guardrails.py
#
# Regression tests for ingestion correctness guardrails.
# Focus: strict validation, org/site scoping, idempotency, and CSV parity.
#
# Assumptions based on your current codebase:
# - app.services.ingest.ingest_timeseries_batch(records, organization_id, source=None, db=None) exists
# - app.services.ingest.validate_batch_record exists (optional, not used directly here)
# - TimeseriesRecord enforces org scoping via organization_id when present
# - get_org_allowed_site_ids(db, organization_id) is used inside ingest_timeseries_batch
#
# These tests are written to be resilient:
# - We monkeypatch get_org_allowed_site_ids to avoid relying on DB seed state
# - We inject a fake SQLAlchemy session object only where feasible
# - If you prefer full DB integration tests, you can swap the FakeSession with a real
#   test Session fixture (recommended long-term).

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set

import pytest

from app.core.errors import TimeseriesIngestErrorCode
from app.services import ingest as ingest_mod


# ----------------------------
# Helpers
# ----------------------------

def _mk_record(
    *,
    site_id: str = "site-1",
    meter_id: str = "meter-main-1",
    value: Any = "123.4",
    unit: str = "kWh",
    timestamp_utc: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    if timestamp_utc is None:
        # default: a valid UTC-aware ISO timestamp
        timestamp_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    r: Dict[str, Any] = {
        "site_id": site_id,
        "meter_id": meter_id,
        "value": value,
        "unit": unit,
        "timestamp_utc": timestamp_utc,
    }
    if idempotency_key is not None:
        r["idempotency_key"] = idempotency_key
    return r


def _extract_codes(result: Dict[str, Any]) -> List[str]:
    errs = result.get("errors") or []
    return [str(e.get("code")) for e in errs if isinstance(e, dict) and e.get("code")]


# ----------------------------
# Minimal fake DB session
# ----------------------------
# We avoid real DB writes here. Instead, we rely on:
# - validate_batch_record for most guardrails (timestamp format, unit, etc.)
# - monkeypatched _idempotency_exists for idempotency behavior
#
# For org/site mismatch tests, ingest_timeseries_batch uses get_org_allowed_site_ids(db, org_id),
# so we just pass a dummy object as db, and monkeypatch get_org_allowed_site_ids.

class _DummySession:
    """
    Minimal stand-in for SQLAlchemy Session when we don't actually write.
    ingest_timeseries_batch will try:
      - db.begin_nested() context manager
      - db.add, db.flush
      - db.commit / db.rollback
      - db.close
    We'll make these no-ops so the function can run without a real DB.
    """

    class _NoopCtx:
        def __enter__(self):  # noqa: D401
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def begin_nested(self):
        return self._NoopCtx()

    def add(self, _obj):  # noqa: D401
        return None

    def flush(self):  # noqa: D401
        return None

    def commit(self):  # noqa: D401
        return None

    def rollback(self):  # noqa: D401
        return None

    def close(self):  # noqa: D401
        return None

    # Used only if idempotency pre-check queries hit the DB; we monkeypatch those paths.
    def query(self, *args, **kwargs):  # pragma: no cover
        raise RuntimeError("DB query not supported in DummySession; monkeypatch _idempotency_exists")


@pytest.fixture()
def dummy_db() -> _DummySession:
    return _DummySession()


@pytest.fixture()
def allow_site_1_only(monkeypatch):
    """
    Force org allowed_site_ids = {'site-1'} for tests that need org/site scoping.
    """
    def _fake_allowed(_db, org_id: int):
        return ["site-1"]

    monkeypatch.setattr(ingest_mod, "get_org_allowed_site_ids", _fake_allowed)
    return {"site-1"}


# ----------------------------
# Tests: batch validator guardrails
# ----------------------------

def test_batch_rejects_naive_timestamp(dummy_db, allow_site_1_only):
    # No timezone info -> should fail INVALID_TIMESTAMP
    ts = datetime.now().replace(microsecond=0).isoformat()  # naive
    rec = _mk_record(site_id="site-1", timestamp_utc=ts)

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    assert result["ingested"] == 0
    assert result["failed"] == 1
    codes = _extract_codes(result)
    assert TimeseriesIngestErrorCode.INVALID_TIMESTAMP.value in codes


def test_batch_rejects_non_numeric_value(dummy_db, allow_site_1_only):
    rec = _mk_record(site_id="site-1", value="not-a-number")

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    assert result["ingested"] == 0
    assert result["failed"] == 1
    codes = _extract_codes(result)
    assert TimeseriesIngestErrorCode.INVALID_VALUE.value in codes


def test_batch_rejects_invalid_unit(dummy_db, allow_site_1_only):
    rec = _mk_record(site_id="site-1", unit="Wh")

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    assert result["ingested"] == 0
    assert result["failed"] == 1
    codes = _extract_codes(result)
    assert TimeseriesIngestErrorCode.INVALID_UNIT.value in codes


def test_batch_rejects_missing_required_fields(dummy_db, allow_site_1_only):
    rec = _mk_record(site_id="site-1")
    rec.pop("meter_id")

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    assert result["ingested"] == 0
    assert result["failed"] == 1
    # Missing meter_id is treated as validation error; code mapping may default.
    codes = _extract_codes(result)
    # Your mapper currently defaults to INTERNAL_ERROR for non timestamp/value/unit issues.
    assert len(codes) == 1


# ----------------------------
# Tests: org/site mismatch
# ----------------------------

def test_batch_rejects_org_site_mismatch(dummy_db, allow_site_1_only):
    # Allowed sites for org are only site-1; attempt site-2 should fail ORG_MISMATCH
    rec = _mk_record(site_id="site-2")

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    assert result["ingested"] == 0
    assert result["failed"] == 1
    codes = _extract_codes(result)
    assert TimeseriesIngestErrorCode.ORG_MISMATCH.value in codes


# ----------------------------
# Tests: idempotency
# ----------------------------

def test_batch_idempotency_skips_duplicate_precheck(dummy_db, allow_site_1_only, monkeypatch):
    """
    If _idempotency_exists returns True, ingest should skip and mark DUPLICATE_IDEMPOTENCY_KEY.
    """
    idem = "test-idem-001"
    rec1 = _mk_record(site_id="site-1", idempotency_key=idem)
    rec2 = _mk_record(site_id="site-1", idempotency_key=idem, value="222.2")

    # First record: precheck False, second: True
    calls = {"n": 0}

    def _fake_exists(_db, *, organization_id, idempotency_key):
        calls["n"] += 1
        return calls["n"] >= 2

    monkeypatch.setattr(ingest_mod, "_idempotency_exists", _fake_exists)

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec1, rec2],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    assert result["ingested"] == 1
    assert result["skipped_duplicate"] == 1
    codes = _extract_codes(result)
    assert TimeseriesIngestErrorCode.DUPLICATE_IDEMPOTENCY_KEY.value in codes


def test_batch_idempotency_key_normalization_blank_is_ignored(dummy_db, allow_site_1_only):
    """
    A blank idempotency_key should be treated as None -> no duplicate skip path.
    This test mainly asserts the batch doesn't crash and ingests the record.
    """
    rec = _mk_record(site_id="site-1", idempotency_key="   ")

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    # With DummySession and no IntegrityErrors, this will ingest.
    assert result["ingested"] == 1
    assert result["failed"] == 0


# ----------------------------
# Tests: future timestamp (guardrail)
# ----------------------------
# IMPORTANT:
# ingest.py now rejects future timestamps (skew) as an ingestion correctness guardrail.
# This test locks that behavior in. If you ever want a tolerance window, implement it
# in validate_batch_record() and update this test to reflect that threshold.

def test_batch_rejects_future_timestamp(dummy_db, allow_site_1_only):
    future = (datetime.now(timezone.utc) + timedelta(days=365 * 10)).replace(microsecond=0).isoformat()
    rec = _mk_record(site_id="site-1", timestamp_utc=future)

    result = ingest_mod.ingest_timeseries_batch(
        records=[rec],
        organization_id=123,
        source="test",
        db=dummy_db,
    )

    assert result["ingested"] == 0
    assert result["failed"] == 1
    codes = _extract_codes(result)
    assert TimeseriesIngestErrorCode.INVALID_TIMESTAMP.value in codes
