# backend/tests/test_unit_case_insensitive.py

from datetime import datetime, timezone

import pytest

from app.services.ingest import (
    CANONICAL_UNIT_KWH,
    normalize_unit,
    validate_record,
    validate_batch_record,
)


def test_normalize_unit_is_case_insensitive_and_canonicalizes():
    assert normalize_unit("kWh") == CANONICAL_UNIT_KWH
    assert normalize_unit("kwh") == CANONICAL_UNIT_KWH
    assert normalize_unit("KWH") == CANONICAL_UNIT_KWH
    assert normalize_unit("  kWh  ") == CANONICAL_UNIT_KWH


def test_normalize_unit_rejects_non_kwh_units():
    with pytest.raises(ValueError) as e:
        normalize_unit("MWh")
    assert "unit must be 'kWh'" in str(e.value)


def test_legacy_validator_accepts_case_insensitive_unit():
    # validate_record() is used by legacy staging job paths.
    r = {
        "site_id": "site-1",
        "meter_id": "main",
        "timestamp_utc": "2026-01-02T00:00:00Z",
        "value": "1.23",
        "unit": "kwh",  # lower-case should be accepted
    }
    ok, errs = validate_record(r)
    assert ok is True
    assert errs == []


def test_batch_validator_accepts_case_insensitive_unit():
    # validate_batch_record() is used by /timeseries/batch schema validation.
    r = {
        "site_id": "site-1",
        "meter_id": "main",
        "timestamp_utc": "2026-01-02T01:00:00Z",
        "value": 2.34,
        "unit": "KWH",  # upper-case should be accepted
        "idempotency_key": "case-test|site-1|main|2026-01-02T01:00:00Z",
    }
    ok, errs = validate_batch_record(r)
    assert ok is True
    assert errs == []


def test_batch_validator_rejects_wrong_unit():
    r = {
        "site_id": "site-1",
        "meter_id": "main",
        "timestamp_utc": "2026-01-02T02:00:00Z",
        "value": 3.21,
        "unit": "MWh",
        "idempotency_key": "bad-unit|site-1|main|2026-01-02T02:00:00Z",
    }
    ok, errs = validate_batch_record(r)
    assert ok is False
    assert any("unit must be 'kWh'" in e for e in errs)
