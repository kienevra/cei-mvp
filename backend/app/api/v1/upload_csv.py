# backend/app/api/v1/upload_csv.py

from __future__ import annotations

from typing import List, Set, Optional, Dict, Any, Tuple

import csv
import io
import logging
import inspect
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Site
from app.core.rate_limit import csv_upload_rate_limit
from app.core.request_context import get_request_id

# Single source of truth for ingestion guardrails (parity with /timeseries/batch)
from app.services.ingest import (
    ingest_timeseries_batch,
    CANONICAL_UNIT_KWH,
    normalize_unit,
    _parse_timestamp_utc,
    _validate_timestamp_guardrails,
    _parse_value_kwh,
)

logger = logging.getLogger("cei")

# NOTE: prefix is /upload-csv, and main.py mounts router under /api/v1
# We explicitly support BOTH:
#   POST /api/v1/upload-csv
#   POST /api/v1/upload-csv/
# to avoid 307 redirects that can break some multipart clients.
router = APIRouter(prefix="/upload-csv", tags=["upload"])

# -----------------------------------------------------------------------------
# CSV schema normalization
# -----------------------------------------------------------------------------
# Internal canonical column names we operate on.
# We align with your /timeseries/export header: timestamp_utc, site_id, meter_id, value
REQUIRED_COLUMNS: Set[str] = {"timestamp_utc", "value", "site_id", "meter_id"}
OPTIONAL_COLUMNS: Set[str] = {"unit"}

DEFAULT_UNIT = CANONICAL_UNIT_KWH
DEFAULT_METER_ID = "meter-1"

# Cap error verbosity so the API response stays sane
MAX_ERROR_LINES = 20

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
    rows_skipped_duplicate: int = 0
    errors: List[str] = Field(default_factory=list)
    sample_site_ids: List[str] = Field(default_factory=list)
    sample_meter_ids: List[str] = Field(default_factory=list)


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
    effective_required: Set[str] = required or REQUIRED_COLUMNS
    present = set(canonical_map.values())

    missing = sorted(list(effective_required - present))
    if missing:
        expected = sorted(list(effective_required | OPTIONAL_COLUMNS))
        expected_str = ", ".join(expected)
        received_headers = sorted(list(canonical_map.keys()))
        canonical_headers = sorted(list(set(canonical_map.values())))

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                # ✅ This is the "better product" contract your tests want.
                "type": "schema_error",
                "message": (
                    "Your file is missing required columns. "
                    f"Expected at least: {expected_str}."
                ),
                "missing": missing,
                "expected": expected,
                # Extra operator/debug context (additive, non-breaking)
                "received_headers": received_headers[:200],
                "canonicalized_headers": canonical_headers[:200],
                "canonical_time_column": "timestamp_utc",
            },
        )


def _coerce_site_id(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    if v.startswith("site-"):
        return v
    if v.isdigit():
        return f"site-{v}"
    return v


def _parse_site_key(site_key: str) -> Tuple[str, Optional[int]]:
    sk = _coerce_site_id(site_key)
    if sk.startswith("site-"):
        tail = sk.split("site-", 1)[1]
        if tail.isdigit():
            return sk, int(tail)
    return sk, None


def _site_org_filter(db: Session, *, org_id: int):
    """
    Your Site model uses `org_id` (not organization_id).
    Keep this tolerant anyway.
    """
    if hasattr(Site, "organization_id"):
        return Site.organization_id == org_id  # type: ignore[attr-defined]
    if hasattr(Site, "org_id"):
        return Site.org_id == org_id  # type: ignore[attr-defined]
    if hasattr(Site, "organization"):
        return Site.organization.has(id=org_id)  # type: ignore[attr-defined]
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={
            "type": "site_model_missing_org_scope",
            "message": "Site model has no organization scoping field/relationship (expected organization_id/org_id/organization).",
        },
    )


def _get_allowed_site_ids_for_org(db: Session, *, org_id: int) -> Set[str]:
    """
    Returns the allowed site_id keys in timeseries form: {"site-1","site-2",...}
    """
    rows = (
        db.query(Site.id)
        .filter(_site_org_filter(db, org_id=org_id))
        .order_by(Site.id.asc())
        .all()
    )
    return {f"site-{row[0]}" for row in rows}


def _validate_forced_site_belongs_to_org(
    db: Session,
    *,
    forced_site_id: str,
    org_id: int,
) -> None:
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


def _build_csv_idempotency_key(*, org_id: int, site_id: str, meter_id: str, ts: datetime) -> str:
    ts_norm = ts.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    key = f"csv:{org_id}:{site_id}:{meter_id}:{ts_norm}"
    return key[:128]


def _to_utc_z_iso(ts: datetime) -> str:
    """
    Enforce strict, unambiguous UTC timestamp string for ingest.py:
      - timezone-aware
      - microsecond=0
      - format ends with 'Z'
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    ts = ts.astimezone(timezone.utc).replace(microsecond=0)
    return ts.isoformat().replace("+00:00", "Z")


def _parse_timestamp_utc_csv(raw: str) -> datetime:
    """
    CSV is allowed to be more permissive than /timeseries/batch:

    Accept:
      - 2025-12-29 11:00:00            (assume UTC)
      - 2025-12-29T11:00:00            (assume UTC)
      - 2025-12-29T11:00:00Z           (strict UTC)
      - 2025-12-29T11:00:00+00:00      (strict offset)
      - 2025-12-29T12:00:00+01:00      (offset; normalized to UTC)

    Return:
      timezone-aware UTC datetime, microsecond=0
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("Empty timestamp")

    # If it includes Z or an explicit offset, defer to ingest.py strict parser.
    has_z = s.endswith("Z")
    has_offset = ("+" in s[10:] or "-" in s[10:]) and ("T" in s or " " in s)  # heuristic
    if has_z or has_offset:
        return _parse_timestamp_utc(s)

    # Try ISO without tz -> assume UTC
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).replace(microsecond=0)
    except Exception:
        pass

    # Try legacy "YYYY-MM-DD HH:MM:SS" -> assume UTC
    try:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc).replace(microsecond=0)
    except Exception:
        pass

    raise ValueError(f"Invalid timestamp format: {raw}")


def _call_ingest_timeseries_batch(
    *,
    db: Session,
    org_id: int,
    records: List[Dict[str, Any]],
    source: str,
    request_id: str,
) -> Dict[str, Any]:
    """
    Calls app.services.ingest.ingest_timeseries_batch, but tolerates minor signature drift
    by only passing args the function actually accepts.

    Expected output (typical):
      {"ingested": int, "skipped_duplicate": int, "failed": int, "errors": [..]}
    """
    sig = inspect.signature(ingest_timeseries_batch)
    kwargs: Dict[str, Any] = {}

    candidates = {
        "db": db,
        "session": db,
        "org_id": org_id,
        "organization_id": org_id,
        "records": records,
        "source": source,
        "request_id": request_id,
        "rid": request_id,
    }

    for name in sig.parameters.keys():
        if name in candidates:
            kwargs[name] = candidates[name]

    result = ingest_timeseries_batch(**kwargs)

    if isinstance(result, dict):
        return result

    out: Dict[str, Any] = {}
    for k in ("ingested", "skipped_duplicate", "failed", "errors"):
        if hasattr(result, k):
            out[k] = getattr(result, k)
    return out


def _is_duplicate_ingest_error(e: Any) -> bool:
    """
    Product decision:
    - DUPLICATE_IDEMPOTENCY_KEY is not an "error" for CSV re-uploads.
    - We still report it via rows_skipped_duplicate.
    - So: filter it out of errors[] to keep UX clean.
    """
    try:
        if isinstance(e, dict):
            return (e.get("code") or "") == "DUPLICATE_IDEMPOTENCY_KEY"
        if isinstance(e, str):
            return "DUPLICATE_IDEMPOTENCY_KEY" in e
    except Exception:
        return False
    return False


@router.post(
    "",  # ✅ supports POST /api/v1/upload-csv (no trailing slash) with NO redirect
    response_model=CsvUploadResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(csv_upload_rate_limit)],
)
@router.post(
    "/",  # supports POST /api/v1/upload-csv/
    response_model=CsvUploadResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(csv_upload_rate_limit)],
)
async def upload_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
    site_id: Optional[str] = None,
):
    # ✅ Make this structured (non-breaking) so clients can distinguish file issues.
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail={
                "type": "file_type_error",
                "message": "Only .csv files are supported.",
                "filename": file.filename,
                "allowed_extensions": [".csv"],
            },
        )

    forced_site_id: Optional[str] = None
    if site_id is not None:
        cleaned = site_id.strip()
        if not cleaned:
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "invalid_query_param",
                    "message": "site_id query parameter cannot be empty if provided.",
                    "param": "site_id",
                },
            )
        forced_site_id = _coerce_site_id(cleaned)
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
        # ✅ Treat as schema_error (fits your test philosophy + FE robustness)
        effective_required = (REQUIRED_COLUMNS - {"site_id"}) if forced_site_id else REQUIRED_COLUMNS
        raise HTTPException(
            status_code=400,
            detail={
                "type": "schema_error",
                "message": "CSV file has no header row.",
                "missing": sorted(list(effective_required)),
                "expected": sorted(list(effective_required | OPTIONAL_COLUMNS)),
            },
        )

    canonical_map = _build_canonical_header_map(reader.fieldnames)

    required = (REQUIRED_COLUMNS - {"site_id"}) if (forced_site_id is not None) else REQUIRED_COLUMNS
    _ensure_required_columns(canonical_map, required=required)

    rows_received = 0
    rows_failed = 0
    errors: List[str] = []
    site_ids: Set[str] = set()
    meter_ids: Set[str] = set()

    org_id = user.organization_id
    source = "csv"
    rid = get_request_id()

    # Stable UTC now for guards (match ingest.py expectation)
    now_utc = datetime.now(timezone.utc).replace(microsecond=0)

    # Multi-site uploads must not be able to ingest other org's sites.
    allowed_site_ids: Optional[Set[str]] = None
    if forced_site_id is None:
        allowed_site_ids = _get_allowed_site_ids_for_org(db, org_id=org_id)

    payloads: List[Dict[str, Any]] = []
    seen_keys: Set[Tuple[str, str, datetime]] = set()

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

            if not raw_ts or raw_value == "":
                raise ValueError("timestamp_utc and value are required per row")

            # CSV is permissive on timestamp inputs, but we normalize to strict UTC for ingest.py
            ts = _parse_timestamp_utc_csv(raw_ts)
            _validate_timestamp_guardrails(ts, now_utc=now_utc)

            # PARITY: reuse ingest.py value parsing + bounds
            val_dec = _parse_value_kwh(raw_value)

            # Unit policy (Option A):
            # - unit is optional
            # - if provided (any casing), normalize to canonical "kWh"
            # - if invalid, fail the row with a clean message
            if raw_unit:
                unit = normalize_unit(raw_unit)
            else:
                unit = DEFAULT_UNIT

            if forced_site_id is not None:
                site_id_value = forced_site_id
            else:
                site_id_value = _coerce_site_id(raw_site) or ""
                if not site_id_value:
                    raise ValueError("site_id is required per row for multi-site uploads")

                if allowed_site_ids is not None and site_id_value not in allowed_site_ids:
                    raise ValueError(f"site_id '{site_id_value}' is not in your organization")

            meter_id_value = (raw_meter or DEFAULT_METER_ID).strip()
            if not meter_id_value:
                raise ValueError("meter_id is required per row")

            # in-file dedupe
            key = (site_id_value, meter_id_value, ts)
            if key in seen_keys:
                continue
            seen_keys.add(key)

            idem = _build_csv_idempotency_key(
                org_id=org_id, site_id=site_id_value, meter_id=meter_id_value, ts=ts
            )

            payloads.append(
                {
                    "site_id": site_id_value,
                    "meter_id": meter_id_value,
                    # Ensure ingest.py never sees naive strings:
                    "timestamp_utc": _to_utc_z_iso(ts),
                    "value": str(val_dec),
                    "unit": unit,
                    "idempotency_key": idem,
                }
            )

            site_ids.add(site_id_value)
            meter_ids.add(meter_id_value)

        except Exception as e:
            rows_failed += 1
            if len(errors) < MAX_ERROR_LINES:
                # Unit errors become very common; make them crystal clear.
                # normalize_unit already returns "unit must be 'kWh'" for bad values.
                errors.append(f"Row {rows_received}: {e}")
            logger.exception("Failed to parse/validate CSV row request_id=%s row=%s", rid, rows_received)

    if not payloads:
        return CsvUploadResult(
            rows_received=rows_received,
            rows_ingested=0,
            rows_failed=rows_failed,
            rows_skipped_duplicate=0,
            errors=errors,
            sample_site_ids=sorted(site_ids)[:10],
            sample_meter_ids=sorted(meter_ids)[:10],
        )

    try:
        ingest_result = _call_ingest_timeseries_batch(
            db=db,
            org_id=org_id,
            records=payloads,
            source=source,
            request_id=rid,
        )
    except Exception:
        logger.exception("CSV ingest_timeseries_batch failed request_id=%s", rid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "type": "csv_ingest_failed",
                "message": "CSV ingestion failed. See server logs for request_id.",
                "request_id": rid,
            },
        )

    ingested = int(ingest_result.get("ingested", 0) or 0)
    skipped = int(ingest_result.get("skipped_duplicate", 0) or 0)
    failed = int(ingest_result.get("failed", 0) or 0)

    # ✅ Keep UX clean: do NOT treat duplicates as errors.
    ingest_errors = ingest_result.get("errors") or []
    if isinstance(ingest_errors, list):
        remaining_slots = max(0, MAX_ERROR_LINES - len(errors))
        for e in ingest_errors:
            if remaining_slots <= 0:
                break
            if _is_duplicate_ingest_error(e):
                continue
            errors.append(str(e))
            remaining_slots -= 1

    return CsvUploadResult(
        rows_received=rows_received,
        rows_ingested=ingested,
        rows_failed=rows_failed + failed,
        rows_skipped_duplicate=skipped,
        errors=errors,
        sample_site_ids=sorted(site_ids)[:10],
        sample_meter_ids=sorted(meter_ids)[:10],
    )
