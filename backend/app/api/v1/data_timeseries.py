# backend/app/api/v1/data_timeseries.py
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Set, Tuple
import csv
import io
import logging

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_org_context, OrgContext
from app.db.session import get_db
from app.models import TimeseriesRecord
from app.api import deps  # org-scoping helpers
from app.services.ingest import ingest_timeseries_batch as ingest_batch_service
from app.core.rate_limit import timeseries_batch_rate_limit

router = APIRouter(prefix="/timeseries", tags=["timeseries"])

# Use the canonical app logger ("cei") so request_observability formatting/filtering is consistent.
logger = logging.getLogger("cei")


class TimeseriesSummary(BaseModel):
    site_id: Optional[str]
    meter_id: Optional[str]
    window_hours: int
    total_value: float
    points: int
    from_timestamp: Optional[datetime]
    to_timestamp: Optional[datetime]


class TimeseriesPoint(BaseModel):
    ts: datetime
    value: float


class TimeseriesSeries(BaseModel):
    site_id: Optional[str]
    meter_id: Optional[str]
    window_hours: int
    resolution: str  # "hour" or "day"
    points: List[TimeseriesPoint]


class TimeseriesBatchRecord(BaseModel):
    """
    Payload shape for a single record in /timeseries/batch.

    Note:
    - timestamp_utc is required and must be ISO8601, UTC.
    - unit is locked to "kWh" for v1 (if provided).
    - idempotency_key is optional but recommended for integrators.
    """

    site_id: str
    meter_id: str
    timestamp_utc: datetime
    value: float
    unit: Optional[str] = "kWh"
    idempotency_key: Optional[str] = None


class TimeseriesBatchRequest(BaseModel):
    records: List[TimeseriesBatchRecord]
    source: Optional[str] = None


class TimeseriesBatchError(BaseModel):
    index: int
    code: str
    detail: str


class TimeseriesBatchResponse(BaseModel):
    ingested: int
    skipped_duplicate: int
    failed: int
    errors: List[TimeseriesBatchError]


class IngestMeterHealth(BaseModel):
    """
    Per (site_id, meter_id) ingestion health over a lookback window.

    This is intentionally simple and DB-agnostic: we compute everything in Python
    from TimeseriesRecord rows that already passed validation and org scoping.
    """

    site_id: str
    meter_id: str
    window_hours: int
    expected_points: int  # assuming 1 value/hour
    actual_points: int
    completeness_pct: float
    last_seen: Optional[datetime]


class IngestHealthResponse(BaseModel):
    window_hours: int
    meters: List[IngestMeterHealth]


def _bucket_timestamp(ts: datetime, resolution: str) -> datetime:
    if resolution == "day":
        return ts.replace(hour=0, minute=0, second=0, microsecond=0)
    # default: hour
    return ts.replace(minute=0, second=0, microsecond=0)


def _apply_org_scope(q, org_ctx: OrgContext):
    """
    Enforce multi-tenant isolation at the TimeseriesRecord layer.

    - If org_ctx.organization_id is set: filter by TimeseriesRecord.organization_id (preferred),
      with a safe fallback to TimeseriesRecord.org_id if your model uses that legacy name.
    - If org_ctx.organization_id is None: no filter (legacy/single-tenant dev behavior)

    Fail-closed: if we can't find an org scope column on TimeseriesRecord, return an always-false filter.
    """
    org_id = org_ctx.organization_id
    if org_id is None:
        return q

    # Preferred schema
    if hasattr(TimeseriesRecord, "organization_id"):
        return q.filter(TimeseriesRecord.organization_id == org_id)

    # Legacy / alternate schema
    if hasattr(TimeseriesRecord, "org_id"):
        return q.filter(TimeseriesRecord.org_id == org_id)

    # Fail closed (prevents cross-tenant leakage if schema drifts)
    return q.filter(sa.false())


def _get_allowed_site_ids(db: Session, org_id: int) -> Set[str]:
    """
    Resolve the set of allowed site_ids for an org as strings.
    Uses the same helper the ingest service uses (canonical).
    """
    allowed = deps.get_org_allowed_site_ids(db, org_id)
    return {str(s) for s in (allowed or [])}


def _enforce_site_allowed_if_provided(
    *,
    db: Session,
    org_ctx: OrgContext,
    site_id: Optional[str],
) -> None:
    """
    Hard guardrail: if a caller provides site_id and we are in multi-tenant mode,
    verify the site belongs to the org. If not, return 404 (no leakage).
    """
    org_id = org_ctx.organization_id
    if org_id is None or not site_id:
        return

    allowed = _get_allowed_site_ids(db, org_id)
    if str(site_id) not in allowed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found",
        )


def _normalize_optional_param(raw: Optional[str]) -> Optional[str]:
    """
    Treat blank/whitespace query params as None.
    This prevents accidental filtering on empty strings.
    """
    if raw is None:
        return None
    s = raw.strip()
    return s if s else None


def _parse_iso8601_utc_param(raw: Optional[str]) -> Optional[datetime]:
    """
    Parse an ISO8601 timestamp query param into a naive UTC datetime.

    Accepts:
      - "2026-01-18T15:00:00Z"
      - "2026-01-18T15:00:00+00:00"
      - "2026-01-18T15:00:00" (treated as UTC)

    Returns naive UTC datetime (tzinfo stripped) to match the rest of this module.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None

    # Normalize common "Z" suffix to +00:00 for fromisoformat
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"

    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid datetime format. Use ISO8601, e.g. 2026-01-18T15:00:00Z",
        )

    if dt.tzinfo is not None:
        dt = dt.astimezone(tz=None).replace(tzinfo=None)

    return dt


@router.get("/summary", response_model=TimeseriesSummary)
def get_timeseries_summary(
    site_id: Optional[str] = Query(None),
    meter_id: Optional[str] = Query(None),
    window_hours: int = Query(24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
    org_ctx: OrgContext = Depends(get_org_context),
):
    """
    Summarize timeseries over the last N hours.

    Multi-tenant behavior:
    - If org_ctx.organization_id is set -> strict org scoping (organization_id / org_id).
    - If org_ctx.organization_id is None -> legacy/single-tenant behavior.
    - If site_id is provided, we verify it is allowed for the org (404 if not).
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    site_id_norm = _normalize_optional_param(site_id)
    meter_id_norm = _normalize_optional_param(meter_id)

    _enforce_site_allowed_if_provided(db=db, org_ctx=org_ctx, site_id=site_id_norm)

    q = (
        db.query(
            func.coalesce(func.sum(TimeseriesRecord.value), 0),
            func.count(TimeseriesRecord.id),
            func.min(TimeseriesRecord.timestamp),
            func.max(TimeseriesRecord.timestamp),
        )
        .filter(TimeseriesRecord.timestamp >= start)
    )

    if site_id_norm:
        q = q.filter(TimeseriesRecord.site_id == site_id_norm)
    if meter_id_norm:
        q = q.filter(TimeseriesRecord.meter_id == meter_id_norm)

    q = _apply_org_scope(q, org_ctx)

    total_value, points, min_ts, max_ts = q.one()

    return TimeseriesSummary(
        site_id=site_id_norm,
        meter_id=meter_id_norm,
        window_hours=window_hours,
        total_value=float(total_value or 0),
        points=int(points or 0),
        from_timestamp=min_ts,
        to_timestamp=max_ts,
    )


@router.get("/series", response_model=TimeseriesSeries)
def get_timeseries_series(
    site_id: Optional[str] = Query(None),
    meter_id: Optional[str] = Query(None),
    window_hours: int = Query(24, ge=1, le=24 * 90),
    resolution: str = Query("hour", pattern="^(hour|day)$"),
    db: Session = Depends(get_db),
    org_ctx: OrgContext = Depends(get_org_context),
):
    """
    Return time-bucketed series over the last N hours.

    Bucketing is done in Python to keep it portable between SQLite and Postgres.

    Multi-tenant behavior:
    - Strict org scoping when org_ctx.organization_id is set.
    - If site_id is provided, verify allowed for org (404 if not).
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    site_id_norm = _normalize_optional_param(site_id)
    meter_id_norm = _normalize_optional_param(meter_id)

    _enforce_site_allowed_if_provided(db=db, org_ctx=org_ctx, site_id=site_id_norm)

    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    if site_id_norm:
        q = q.filter(TimeseriesRecord.site_id == site_id_norm)
    if meter_id_norm:
        q = q.filter(TimeseriesRecord.meter_id == meter_id_norm)

    q = _apply_org_scope(q, org_ctx)

    rows = q.order_by(TimeseriesRecord.timestamp.asc()).all()

    buckets: Dict[datetime, float] = {}
    for row in rows:
        ts: datetime = row.timestamp
        bucket_ts = _bucket_timestamp(ts, resolution)
        buckets[bucket_ts] = buckets.get(bucket_ts, 0.0) + float(row.value)

    sorted_points = sorted(buckets.items(), key=lambda kv: kv[0])
    points = [TimeseriesPoint(ts=ts, value=value) for ts, value in sorted_points]

    return TimeseriesSeries(
        site_id=site_id_norm,
        meter_id=meter_id_norm,
        window_hours=window_hours,
        resolution=resolution,
        points=points,
    )


@router.get("/export", response_class=StreamingResponse)
def export_timeseries_csv(
    site_id: Optional[str] = Query(None),
    meter_id: Optional[str] = Query(None),
    window_hours: int = Query(24, ge=1, le=24 * 90),
    start_utc: Optional[str] = Query(
        None,
        description="Optional ISO8601 UTC start (e.g. 2026-01-01T00:00:00Z). If provided with end_utc, overrides window_hours.",
    ),
    end_utc: Optional[str] = Query(
        None,
        description="Optional ISO8601 UTC end (e.g. 2026-01-02T00:00:00Z). If provided with start_utc, overrides window_hours.",
    ),
    db: Session = Depends(get_db),
    org_ctx: OrgContext = Depends(get_org_context),
):
    """
    Export raw timeseries rows as CSV.

    Default behavior (backwards compatible):
      - Exports rows for the last N hours (window_hours).

    Ranged export (pilot-friendly verification):
      - If start_utc AND end_utc are provided, exports rows in [start_utc, end_utc).
      - Range is capped to 90 days (2160 hours) to preserve the existing guardrail.

    Columns:
      - timestamp_utc (ISO8601)
      - site_id
      - meter_id
      - value

    Multi-tenant behavior:
    - Strict org scoping when org_ctx.organization_id is set.
    - If site_id is provided, verify allowed for org (404 if not).
    """
    site_id_norm = _normalize_optional_param(site_id)
    meter_id_norm = _normalize_optional_param(meter_id)

    _enforce_site_allowed_if_provided(db=db, org_ctx=org_ctx, site_id=site_id_norm)

    start_dt = _parse_iso8601_utc_param(start_utc)
    end_dt = _parse_iso8601_utc_param(end_utc)

    # Backwards compatible mode: last N hours
    if start_dt is None and end_dt is None:
        now = datetime.utcnow()
        start = now - timedelta(hours=window_hours)
        end = now
    else:
        # Require both to avoid ambiguous semantics
        if start_dt is None or end_dt is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Provide both start_utc and end_utc for ranged export.",
            )
        if end_dt <= start_dt:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="end_utc must be greater than start_utc.",
            )

        max_hours = 24 * 90
        range_hours = (end_dt - start_dt).total_seconds() / 3600.0
        if range_hours > max_hours + 1e-9:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Requested range is too large. Max is {max_hours} hours (90 days).",
            )

        start = start_dt
        end = end_dt

        # Keep window_hours field semantics stable for clients that still pass it:
        # in ranged mode it's ignored, but validation already happened.

    q = db.query(TimeseriesRecord).filter(
        TimeseriesRecord.timestamp >= start,
        TimeseriesRecord.timestamp < end,
    )

    if site_id_norm:
        q = q.filter(TimeseriesRecord.site_id == site_id_norm)
    if meter_id_norm:
        q = q.filter(TimeseriesRecord.meter_id == meter_id_norm)

    q = _apply_org_scope(q, org_ctx)
    q = q.order_by(TimeseriesRecord.timestamp.asc())

    def iter_csv():
        buffer = io.StringIO()
        writer = csv.writer(buffer)

        writer.writerow(["timestamp_utc", "site_id", "meter_id", "value"])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        for row in q.yield_per(1000):
            writer.writerow(
                [
                    row.timestamp.isoformat() if row.timestamp else "",
                    row.site_id or "",
                    row.meter_id or "",
                    float(row.value) if row.value is not None else "",
                ]
            )
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    filename = "cei_timeseries_export.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}

    return StreamingResponse(iter_csv(), media_type="text/csv", headers=headers)


@router.post(
    "/batch",
    response_model=TimeseriesBatchResponse,
    dependencies=[Depends(timeseries_batch_rate_limit)],
)
def create_timeseries_batch(
    payload: TimeseriesBatchRequest,
    db: Session = Depends(get_db),
    org_ctx: OrgContext = Depends(get_org_context),
):
    """
    Direct ingestion endpoint for integrators and backends.

    Auth:
    - Accepts either:
      * A normal short-lived access JWT (interactive user), OR
      * A long-lived integration token (cei_int_...) created via /auth/integration-tokens.
    - In both cases we resolve a single organization_id via get_org_context and use that
      to scope writes into TimeseriesRecord.organization_id (or org_id for legacy schemas).

    Behavior:
    - Delegates to app.services.ingest.ingest_timeseries_batch for the heavy lifting.
    - Enforces rate limiting via timeseries_batch_rate_limit.
    - Returns a structured summary of ingested / skipped / failed records.
    """
    if not payload.records:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="records must be a non-empty list",
        )

    org_id = org_ctx.organization_id
    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No organization associated with this credential",
        )

    # Convert Pydantic models to plain dicts before handing off to the service.
    records = [r.dict() for r in payload.records]

    # Source fallback: make it explicit for observability.
    source = payload.source or "api"

    result_dict = ingest_batch_service(
        records=records,
        organization_id=org_id,
        source=source,
        db=db,
    )

    logger.info(
        "timeseries_batch_ingest org_id=%s source=%s records=%d ingested=%d skipped_duplicate=%d failed=%d",
        org_id,
        source,
        len(records),
        result_dict.get("ingested", 0),
        result_dict.get("skipped_duplicate", 0),
        result_dict.get("failed", 0),
    )

    errors = [
        TimeseriesBatchError(
            index=err.get("index", -1),
            code=err.get("code", "UNKNOWN"),
            detail=err.get("detail", ""),
        )
        for err in result_dict.get("errors", [])
    ]

    return TimeseriesBatchResponse(
        ingested=result_dict.get("ingested", 0),
        skipped_duplicate=result_dict.get("skipped_duplicate", 0),
        failed=result_dict.get("failed", 0),
        errors=errors,
    )


@router.get("/ingest_health", response_model=IngestHealthResponse)
def get_ingest_health(
    site_id: Optional[str] = Query(None),
    meter_id: Optional[str] = Query(None),
    window_hours: int = Query(24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
    org_ctx: OrgContext = Depends(get_org_context),
):
    """
    Ingestion health over the last N hours, grouped by (site_id, meter_id).

    Multi-tenant behavior:
    - Strict org scoping when org_ctx.organization_id is set.
    - If site_id is provided, verify allowed for org (404 if not).
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    site_id_norm = _normalize_optional_param(site_id)
    meter_id_norm = _normalize_optional_param(meter_id)

    _enforce_site_allowed_if_provided(db=db, org_ctx=org_ctx, site_id=site_id_norm)

    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    if site_id_norm:
        q = q.filter(TimeseriesRecord.site_id == site_id_norm)
    if meter_id_norm:
        q = q.filter(TimeseriesRecord.meter_id == meter_id_norm)

    q = _apply_org_scope(q, org_ctx)

    rows = (
        q.order_by(
            TimeseriesRecord.site_id,
            TimeseriesRecord.meter_id,
            TimeseriesRecord.timestamp,
        )
        .all()
    )

    meter_map: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for row in rows:
        key = (row.site_id, row.meter_id)
        data = meter_map.get(key)
        if data is None:
            data = {
                "site_id": row.site_id,
                "meter_id": row.meter_id,
                "actual_points": 0,
                "last_seen": row.timestamp,
            }
            meter_map[key] = data

        data["actual_points"] += 1

        if row.timestamp and (data["last_seen"] is None or row.timestamp > data["last_seen"]):
            data["last_seen"] = row.timestamp

    expected_points = window_hours if window_hours > 0 else 0

    meters: List[IngestMeterHealth] = []
    for (s_id, m_id), agg in meter_map.items():
        actual = agg["actual_points"]
        completeness = (actual / expected_points) * 100.0 if expected_points > 0 else 0.0
        meters.append(
            IngestMeterHealth(
                site_id=s_id,
                meter_id=m_id,
                window_hours=window_hours,
                expected_points=expected_points,
                actual_points=actual,
                completeness_pct=round(completeness, 1),
                last_seen=agg["last_seen"],
            )
        )

    return IngestHealthResponse(window_hours=window_hours, meters=meters)
