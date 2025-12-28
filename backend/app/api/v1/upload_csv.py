# backend/app/api/v1/upload_csv.py

from typing import List, Set, Optional, Dict, Any, Tuple

import csv
import io
import logging
from datetime import datetime, timezone
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
from app.models import TimeseriesRecord, Site
from app.core.rate_limit import csv_upload_rate_limit
from app.core.request_context import get_request_id

logger = logging.getLogger("cei")

# NOTE: prefix is /upload-csv, and main.py mounts router under /api/v1
# => POST /api/v1/upload-csv/
router = APIRouter(prefix="/upload-csv", tags=["upload"])

# Internal canonical column names we operate on.
# We align with your /timeseries/export header: timestamp_utc, site_id, meter_id, value
REQUIRED_COLUMNS: Set[str] = {"timestamp_utc", "value", "site_id", "meter_id"}
OPTIONAL_COLUMNS: Set[str] = {"unit"}

DEFAULT_UNIT = "kWh"
DEFAULT_METER_ID = "meter-1"

# Common header variants mapped into our canonical schema.
NORMALIZATION_MAP = {
    # time-like -> timestamp_utc
    "time": "timestamp_utc",
    "timestamp": "timestamp_utc",
    "timestamp_utc": "timestamp_utc",
    "ts": "timestamp_utc",
    "date_time": "timestamp_utc",
    "datetime": "timestamp_utc",
    "date": "timestamp_utc",
    "utc_timestamp": "timestamp_utc",
    "utc_time": "timestamp_utc",
    # value-like
    "value": "value",
    "kwh": "value",
    "energy": "value",
    "energy_kwh": "value",
    "consumption": "value",
    "consumption_kwh": "value",
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
    key = col.strip().lower().replace(" ", "_")
    return NORMALIZATION_MAP.get(key, key)


def _build_canonical_header_map(fieldnames: List[str]) -> Dict[str, str]:
    canonical_map: Dict[str, str] = {}
    for orig in fieldnames:
        canonical_map[orig] = _normalize_header_name(orig)
    return canonical_map


def _ensure_required_columns(
    canonical_map: Dict[str, str],
    required: Optional[Set[str]] = None,
) -> None:
    """
    Validate that canonical header set contains all required columns.
    Raises HTTPException with structured schema detail if missing.

    For per-site uploads we relax the need for a site_id column.
    """
    effective_required: Set[str] = required or REQUIRED_COLUMNS
    present = set(canonical_map.values())

    missing = sorted(list(effective_required - present))
    if missing:
        expected_str = ", ".join(sorted(effective_required | OPTIONAL_COLUMNS))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "type": "schema_error",
                "message": (
                    "Your file is missing required columns. "
                    f"Expected at least: {expected_str}."
                ),
                "missing": missing,
                "expected": sorted(list(effective_required | OPTIONAL_COLUMNS)),
                "canonical_time_column": "timestamp_utc",
            },
        )


def _coerce_site_id(value: str) -> str:
    """
    Normalize site ids into canonical 'site-<int>' form where possible.
    If already 'site-26' keep it.
    If numeric '26' convert to 'site-26'.
    """
    v = (value or "").strip()
    if not v:
        return ""
    if v.startswith("site-"):
        return v
    if v.isdigit():
        return f"site-{v}"
    return v


def _parse_site_key(site_key: str) -> Tuple[str, Optional[int]]:
    """
    Return (normalized_site_key, numeric_id_if_present).

    Examples:
      - "site-26" -> ("site-26", 26)
      - "26"      -> ("site-26", 26)
      - "foo"     -> ("foo", None)
    """
    sk = _coerce_site_id(site_key)
    if sk.startswith("site-"):
        tail = sk.split("site-", 1)[1]
        if tail.isdigit():
            return sk, int(tail)
    return sk, None


def _parse_timestamp_utc(raw: str) -> datetime:
    """
    Parse timestamps robustly and return timezone-aware UTC datetime.
    Accepts:
      - ISO8601 with Z (e.g. 2025-12-26T12:00:00Z)
      - ISO8601 with offset
      - 'YYYY-MM-DD HH:MM:SS' (assumed UTC)
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("Empty timestamp")

    if s.endswith("Z"):
        s = s[:-1] + "+00:00"

    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass

    try:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        pass

    raise ValueError(f"Invalid timestamp format: {raw}")


def _site_org_filter(db: Session, *, org_id: int):
    """
    Build a SQLAlchemy filter that scopes Site rows to an org, without assuming
    the FK field name.

    Supported:
      - Site.organization_id
      - Site.org_id
      - Site.organization relationship (Organization.id)
    """
    if hasattr(Site, "organization_id"):
        return Site.organization_id == org_id  # type: ignore[attr-defined]
    if hasattr(Site, "org_id"):
        return Site.org_id == org_id  # type: ignore[attr-defined]
    if hasattr(Site, "organization"):
        return Site.organization.has(id=org_id)  # type: ignore[attr-defined]
    # If your model is *really* different, fail loudly.
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={
            "type": "site_model_missing_org_scope",
            "message": "Site model has no organization scoping field/relationship (expected organization_id/org_id/organization).",
        },
    )


def _validate_forced_site_belongs_to_org(
    db: Session,
    *,
    forced_site_id: str,
    org_id: int,
) -> None:
    """
    Ensure forced_site_id exists for this org.

    IMPORTANT: Your API uses external key 'site-<id>' and your Site model uses
    numeric primary key `Site.id`. So we validate using Site.id + org scoping.
    """
    normalized, numeric_id = _parse_site_key(forced_site_id)

    if numeric_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "type": "invalid_site_id_format",
                "message": "site_id must look like 'site-<number>' (e.g. site-26).",
                "site_id": forced_site_id,
            },
        )

    site = (
        db.query(Site)
        .filter(Site.id == numeric_id)
        .filter(_site_org_filter(db, org_id=org_id))
        .first()
    )
    if site is None:
        allowed = (
            db.query(Site.id)
            .filter(_site_org_filter(db, org_id=org_id))
            .order_by(Site.id.asc())
            .all()
        )
        allowed_ids = [f"site-{row[0]}" for row in allowed]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "type": "unknown_site_for_org",
                "message": f"site_id '{normalized}' is not a site in your organization.",
                "site_id": normalized,
                "allowed_site_ids": allowed_ids[:50],
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
    # Per-site uploads call:
    #   POST /api/v1/upload-csv/?site_id=site-26
    site_id: Optional[str] = None,
):
    """
    Upload a CSV of timeseries data and ingest into TimeseriesRecord (org-scoped).

    Canonical schema (recommended):
      - timestamp_utc
      - value
      - site_id
      - meter_id
      - unit (optional; defaults to kWh)

    Per-site upload:
      - If `site_id` query param is provided, the CSV does NOT need site_id column.
      - If the CSV does contain site_id in that mode, it is ignored for routing.
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    forced_site_id: Optional[str] = None
    if site_id is not None:
        cleaned = site_id.strip()
        if not cleaned:
            raise HTTPException(
                status_code=400,
                detail="site_id query parameter cannot be empty if provided.",
            )
        forced_site_id = _coerce_site_id(cleaned)

        # Hard validation: forced site must belong to org
        _validate_forced_site_belongs_to_org(
            db, forced_site_id=forced_site_id, org_id=user.organization_id
        )

    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file has no header row")

    canonical_map = _build_canonical_header_map(reader.fieldnames)

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

    org_id = user.organization_id
    source = "csv"

    for row in reader:
        rows_received += 1
        try:
            canonical_row: Dict[str, Any] = {}
            for orig_col, value in row.items():
                canon = canonical_map.get(orig_col)
                if not canon:
                    continue
                canonical_row[canon] = value

            raw_ts = (canonical_row.get("timestamp_utc") or "").strip()
            raw_value = (canonical_row.get("value") or "").strip()
            raw_unit = (canonical_row.get("unit") or "").strip()
            raw_site = (canonical_row.get("site_id") or "").strip()
            raw_meter = (canonical_row.get("meter_id") or "").strip()

            if not raw_ts or not raw_value:
                raise ValueError("timestamp_utc and value are required per row")

            ts = _parse_timestamp_utc(raw_ts)

            try:
                val = Decimal(raw_value)
            except InvalidOperation:
                raise ValueError(f"Invalid numeric value: {raw_value}")

            unit = raw_unit or DEFAULT_UNIT

            if forced_site_id is not None:
                site_id_value = forced_site_id
            else:
                site_id_value = _coerce_site_id(raw_site) or ""
                if not site_id_value:
                    raise ValueError("site_id is required per row for multi-site uploads")

            meter_id_value = raw_meter or DEFAULT_METER_ID

            rec = TimeseriesRecord(
                org_id=org_id,
                site_id=site_id_value,
                meter_id=meter_id_value,
                timestamp=ts,
                value=val,
                unit=unit,
                source=source,
            )
            records.append(rec)

            site_ids.add(site_id_value)
            meter_ids.add(meter_id_value)
            rows_ingested += 1

        except Exception as e:
            rows_failed += 1
            if len(errors) < 20:
                errors.append(f"Row {rows_received}: {e}")
            logger.exception(
                "Failed to ingest CSV row",
                extra={"request_id": get_request_id(), "row": rows_received},
            )

    if records:
        try:
            db.add_all(records)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception(
                "CSV upload commit failed",
                extra={
                    "request_id": get_request_id(),
                    "rows_ingested": rows_ingested,
                    "rows_received": rows_received,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "type": "db_commit_failed",
                    "message": "Failed to commit ingested rows. See server logs for request_id.",
                    "request_id": get_request_id(),
                },
            )

    return CsvUploadResult(
        rows_received=rows_received,
        rows_ingested=rows_ingested,
        rows_failed=rows_failed,
        errors=errors,
        sample_site_ids=sorted(site_ids)[:10],
        sample_meter_ids=sorted(meter_ids)[:10],
    )
