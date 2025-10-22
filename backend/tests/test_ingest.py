import pytest
import tempfile
import os
import json
from app.services.ingest import validate_record, save_raw_timeseries

VALID_RECORD = {
    "site_id": "site-1",
    "meter_id": "meter-1",
    "timestamp": "2025-01-01T12:00:00Z",
    "value": 100.0,
    "unit": "kWh"
}

@pytest.mark.parametrize("record,expected_valid,expected_errors", [
    (VALID_RECORD, True, []),
    ({**VALID_RECORD, "site_id": None}, False, ["Missing field: site_id"]),
    ({**VALID_RECORD, "timestamp": None}, False, ["Missing field: timestamp"]),
    ({**VALID_RECORD, "value": -10}, False, []),  # negative value, but only numeric check in validate_record
    ({**VALID_RECORD, "unit": "MWh"}, False, ["Unit must be 'kWh'"]),
])
def test_validate_record(record, expected_valid, expected_errors):
    valid, errors = validate_record(record)
    assert valid == expected_valid
    for err in expected_errors:
        assert err in errors

def test_save_raw_timeseries_writes_file(monkeypatch):
    # Use a temp file for staging
    with tempfile.TemporaryDirectory() as tmpdir:
        staging_file = os.path.join(tmpdir, "timeseries_staging.json")
        monkeypatch.setattr("app.services.ingest.STAGING_FILE", staging_file)
        job_id = "job-123"
        payload = [VALID_RECORD]
        save_raw_timeseries(job_id, payload)
        # Check file written
        with open(staging_file, "r") as f:
            lines = f.readlines()
            assert len(lines) == 1
            entry = json.loads(lines[0])
            assert entry["job_id"] == job_id
            assert entry["records"] == payload
