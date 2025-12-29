# backend/app/api/v1/upload_csv.py

from __future__ import annotations

from typing import List, Set, Optional, Dict, Any, Tuple

import csv
import io
import logging
import inspect
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
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Site
from app.core.rate_limit import csv_upload_rate_limit
from app.core.request_context import get_request_id
from app.services.ingest import ingest_timeseries_batch

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


def _parse_timestamp_utc(raw: str) -> datetime:
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

    # common parameter names we’ve used across CEI iterations
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

    # last resort: allow returning a pydantic model / object with attrs
    out: Dict[str, Any] = {}
    for k in ("ingested", "skipped_duplicate", "failed", "errors"):
        if hasattr(result, k):
            out[k] = getattr(result, k)
    return out


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
    site_id: Optional[str] = None,
):
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

    # Build canonical ingest payload (NOT ORM instances)
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

            if not raw_ts or not raw_value:
                raise ValueError("timestamp_utc and value are required per row")

            ts = _parse_timestamp_utc(raw_ts)

            try:
                # keep Decimal to preserve precision; ingest layer can coerce as needed
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

            # in-file dedupe (same timestamp/site/meter repeated in file)
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
                    # Keep name aligned with your Direct API contract; ingest layer should accept this.
                    "timestamp_utc": ts.astimezone(timezone.utc).replace(microsecond=0).isoformat(),
                    "value": str(val),  # safe across JSON-ish handling
                    "unit": unit,
                    "idempotency_key": idem,
                }
            )

            site_ids.add(site_id_value)
            meter_ids.add(meter_id_value)

        except Exception as e:
            rows_failed += 1
            if len(errors) < 20:
                errors.append(f"Row {rows_received}: {e}")
            logger.exception("Failed to parse CSV row request_id=%s row=%s", rid, rows_received)

    # No valid payloads
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

    # Canonical ingest (same path as /timeseries/batch)
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

    ingest_errors = ingest_result.get("errors") or []
    if isinstance(ingest_errors, list):
        for e in ingest_errors[: max(0, 20 - len(errors))]:
            errors.append(str(e))

    return CsvUploadResult(
        rows_received=rows_received,
        rows_ingested=ingested,
        rows_failed=rows_failed + failed,
        rows_skipped_duplicate=skipped,
        errors=errors,
        sample_site_ids=sorted(site_ids)[:10],
        sample_meter_ids=sorted(meter_ids)[:10],
    )
