# backend/app/api/v1/upload_csv.py
from typing import List, Set, Optional

import csv
import io
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import TimeseriesRecord
from app.core.rate_limit import csv_upload_rate_limit

logger = logging.getLogger("cei")

# NOTE: prefix is /upload-csv, and main.py mounts router under /api/v1
# => POST /api/v1/upload-csv/
router = APIRouter(prefix="/upload-csv", tags=["upload"])

# Core semantic columns CEI expects for the *generic* upload.
REQUIRED_COLUMNS: Set[str] = {"timestamp", "value", "unit", "site_id", "meter_id"}

# Common header variants that should map to our internal schema
NORMALIZATION_MAP = {
    # time-like
    "time": "timestamp",
    "timestamp": "timestamp",
    "ts": "timestamp",
    "date_time": "timestamp",
    "datetime": "timestamp",
    "date": "timestamp",
    # value-like
    "value": "value",
    "kwh": "value",
    "energy": "value",
    "energy_kwh": "value",
    "consumption": "value",
    # unit-like
    "unit": "unit",
    "units": "unit",
    "energy_unit": "unit",
    # site-like
    "site": "site_id",
    "site_id": "site_id",
    "site_name": "site_id",
    "plant": "site_id",
    # meter-like
    "meter": "meter_id",
    "meter_id": "meter_id",
    "meter_name": "meter_id",
    "tag": "meter_id",
    "point": "meter_id",
}


class CsvUploadResult(BaseModel):
    rows_received: int
    rows_ingested: int
    rows_failed: int
    errors: List[str] = []
    sample_site_ids: List[str] = []
    sample_meter_ids: List[str] = []


def _normalize_header_name(col: str) -> str:
    """
    Normalize a raw CSV header into CEI's internal schema namespace.
    """
    key = col.strip().lower().replace(" ", "_")
    return NORMALIZATION_MAP.get(key, key)


def _build_canonical_header_map(fieldnames: List[str]) -> dict:
    """
    Build a mapping from original header -> canonical header name.
    """
    canonical_map: dict = {}
    for orig in fieldnames:
        canonical = _normalize_header_name(orig)
        canonical_map[orig] = canonical
    return canonical_map


def _ensure_required_columns(canonical_map: dict, required: Optional[Set[str]] = None):
    """
    Validate that the canonical header set contains all required columns.
    Raises HTTPException with structured detail if any are missing.

    `required` defaults to REQUIRED_COLUMNS, but for per-site uploads we can
    relax this (e.g. not require a site_id column if it's forced via query).
    """
    effective_required: Set[str] = required or REQUIRED_COLUMNS
    present = set(canonical_map.values())
    missing = sorted(list(effective_required - present))
    if missing:
        expected_str = ", ".join(sorted(effective_required))
        # Structured schema error; frontend CSVUpload.tsx knows how to render this.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "type": "schema_error",
                "message": (
                    "Your file is missing required columns. "
                    f"Expected at least: {expected_str}."
                ),
                "missing": missing,
            },
        )


@router.post(
    "/",
    response_model=CsvUploadResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(csv_upload_rate_limit)],
)
async def upload_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
    # Optional query param to force all rows into a specific site.
    # For per-site uploads the frontend will call:
    #   POST /api/v1/upload-csv/?site_id=site-7
    # and the CSV does *not* need a site_id column.
    site_id: Optional[str] = None,
):
    """
    Upload a CSV of timeseries data and ingest into TimeseriesRecord.

    Expected semantic columns (header row) for the generic, multi-site upload:
      - timestamp  (ISO8601 or 'YYYY-MM-DD HH:MM:SS')
      - value      (numeric)
      - unit       (e.g. kWh)
      - site_id    (string; used for per-site analytics)
      - meter_id   (string; used for grouping/filtering)

    Column *order* does not matter. Header names are normalized, and common
    aliases such as "time", "kWh", "site", "meter", etc. are mapped into the
    internal schema. Extra columns are ignored.

    Per-site upload:
      - If the optional query param `site_id` is provided (e.g. `site-7`),
        all rows in the CSV will be forced to that site_id.
      - In that mode the CSV does *not* need a site_id column; if it exists,
        it is ignored for routing and only used as a fallback if the param is
        empty/whitespace (which should not happen in normal usage).
    """

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    # Normalize / validate the forced site_id if present
    forced_site_id: Optional[str] = None
    if site_id is not None:
        cleaned = site_id.strip()
        if not cleaned:
            raise HTTPException(
                status_code=400,
                detail="site_id query parameter cannot be empty if provided.",
            )
        # We treat this as the final TimeseriesRecord.site_id, e.g. "site-7"
        forced_site_id = cleaned

    # Decode bytes -> text
    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file has no header row")

    # Normalize headers into CEI's internal schema
    raw_fieldnames = reader.fieldnames
    canonical_map = _build_canonical_header_map(raw_fieldnames)

    # For per-site upload, relax required set: site_id column becomes optional.
    if forced_site_id is not None:
        required = REQUIRED_COLUMNS - {"site_id"}
    else:
        required = REQUIRED_COLUMNS
    _ensure_required_columns(canonical_map, required=required)

    rows_received = 0
    rows_ingested = 0
    rows_failed = 0
    errors: List[str] = []
    site_ids: Set[str] = set()
    meter_ids: Set[str] = set()
    records: List[TimeseriesRecord] = []

    for row in reader:
        rows_received += 1
        try:
            # Build a canonical row dict using normalized header names
            canonical_row: dict = {}
            for orig_col, value in row.items():
                canon = canonical_map.get(orig_col)
                if not canon:
                    continue
                canonical_row[canon] = value

            raw_ts = (canonical_row.get("timestamp") or "").strip()
            raw_value = (canonical_row.get("value") or "").strip()
            raw_unit = (canonical_row.get("unit") or "").strip()
            raw_site = (canonical_row.get("site_id") or "").strip()
            raw_meter = (canonical_row.get("meter_id") or "").strip()

            if not raw_ts or not raw_value or not raw_unit:
                raise ValueError("timestamp, value, and unit are required per row")

            # Parse timestamp
            ts = _parse_timestamp(raw_ts)

            # Parse numeric value
            try:
                val = Decimal(raw_value)
            except InvalidOperation:
                raise ValueError(f"Invalid numeric value: {raw_value}")

            # Resolve site_id:
            # - If a forced site_id is provided via query, that wins.
            # - Otherwise, fall back to per-row site_id or "default".
            if forced_site_id is not None:
                site_id_value = forced_site_id
            else:
                site_id_value = raw_site or "default"

            meter_id_value = raw_meter or "default"

            rec = TimeseriesRecord(
                site_id=site_id_value,
                meter_id=meter_id_value,
                timestamp=ts,
                value=val,
                unit=raw_unit,
            )
            records.append(rec)

            site_ids.add(site_id_value)
            meter_ids.add(meter_id_value)
            rows_ingested += 1

        except Exception as e:
            rows_failed += 1
            # Cap error messages to avoid massive responses on big files
            if len(errors) < 20:
                errors.append(f"Row {rows_received}: {e}")
            logger.exception("Failed to ingest CSV row %s", rows_received)

    # Persist in one transaction
    if records:
        db.add_all(records)
        db.commit()

    return CsvUploadResult(
        rows_received=rows_received,
        rows_ingested=rows_ingested,
        rows_failed=rows_failed,
        errors=errors,
        sample_site_ids=sorted(site_ids)[:10],
        sample_meter_ids=sorted(meter_ids)[:10],
    )


def _parse_timestamp(raw: str) -> datetime:
    """
    Try a couple of sane timestamp formats for MVP.
    """
    raw = raw.strip()
    # Try ISO first
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass

    # Try 'YYYY-MM-DD HH:MM:SS'
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        pass

    raise ValueError(f"Invalid timestamp format: {raw}")
