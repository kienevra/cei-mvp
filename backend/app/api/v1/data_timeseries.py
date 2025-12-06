# backend/app/api/v1/data_timeseries.py
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
import csv
import io
import logging

from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user, get_org_context, OrgContext
from app.db.session import get_db
from app.models import TimeseriesRecord
from app.api import deps  # org-scoping helpers
from app.services.ingest import ingest_timeseries_batch as ingest_batch_service
from app.core.rate_limit import timeseries_batch_rate_limit

router = APIRouter(prefix="/timeseries", tags=["timeseries"])

logger = logging.getLogger("cei.timeseries")


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


@router.get("/summary", response_model=TimeseriesSummary)
def get_timeseries_summary(
    site_id: Optional[str] = Query(None),
    meter_id: Optional[str] = Query(None),
    window_hours: int = Query(24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Summarize timeseries over the last N hours.

    Returns:
      - total value
      - count of points
      - min/max timestamps

    Multi-tenant behavior:
    - If user.organization_id is set -> only aggregate data for sites belonging
      to that org (via TimeseriesRecord.site_id mapping to Site.org_id).
    - If user.organization_id is None -> behave as single-tenant/dev and do not
      apply any org restriction.
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    # Base aggregate query
    q = (
        db.query(
            func.coalesce(func.sum(TimeseriesRecord.value), 0),
            func.count(TimeseriesRecord.id),
            func.min(TimeseriesRecord.timestamp),
            func.max(TimeseriesRecord.timestamp),
        )
        .filter(TimeseriesRecord.timestamp >= start)
    )

    # Optional filters for site/meter
    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

    # Org scoping: restrict to the current user's organization if applicable
    q = deps.apply_org_scope_to_timeseries_query(q, db, user)

    total_value, points, min_ts, max_ts = q.one()

    return TimeseriesSummary(
        site_id=site_id,
        meter_id=meter_id,
        window_hours=window_hours,
        total_value=float(total_value or 0),
        points=points,
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
    user=Depends(get_current_user),
):
    """
    Return time-bucketed series over the last N hours.

    Bucketing is done in Python to keep it portable between SQLite and Postgres.
    - resolution = "hour": bucket by hour (YYYY-MM-DD HH:00).
    - resolution = "day": bucket by day (YYYY-MM-DD 00:00).

    Multi-tenant behavior:
    - If user.organization_id is set -> only return points for sites belonging
      to that org.
    - If user.organization_id is None -> behave as single-tenant/dev.
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    # Base row query
    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    # Optional filters
    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

    # Org scoping
    q = deps.apply_org_scope_to_timeseries_query(q, db, user)

    rows = q.order_by(TimeseriesRecord.timestamp.asc()).all()

    buckets: Dict[datetime, float] = {}

    for row in rows:
        ts: datetime = row.timestamp
        bucket_ts = _bucket_timestamp(ts, resolution)
        current = buckets.get(bucket_ts, 0.0)
        # row.value may be Decimal; cast to float for API response
        buckets[bucket_ts] = current + float(row.value)

    # Sort buckets by time
    sorted_points = sorted(buckets.items(), key=lambda kv: kv[0])

    points = [TimeseriesPoint(ts=ts, value=value) for ts, value in sorted_points]

    return TimeseriesSeries(
        site_id=site_id,
        meter_id=meter_id,
        window_hours=window_hours,
        resolution=resolution,
        points=points,
    )


@router.get("/export", response_class=StreamingResponse)
def export_timeseries_csv(
    site_id: Optional[str] = Query(None),
    meter_id: Optional[str] = Query(None),
    window_hours: int = Query(24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Export raw timeseries rows for the last N hours as CSV.

    Columns:
      - timestamp_utc (ISO8601)
      - site_id
      - meter_id
      - value

    Multi-tenant behavior:
    - Same org scoping as /summary and /series.
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    # Base query
    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    # Optional filters
    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

    # Org scoping
    q = deps.apply_org_scope_to_timeseries_query(q, db, user)

    q = q.order_by(TimeseriesRecord.timestamp.asc())

    def iter_csv():
        buffer = io.StringIO()
        writer = csv.writer(buffer)

        # Header
        writer.writerow(["timestamp_utc", "site_id", "meter_id", "value"])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        # Stream rows
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
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"'
    }

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
      to scope writes into TimeseriesRecord.

    Payload:
    - JSON body:
      {
        "records": [
          {
            "site_id": "site-1",
            "meter_id": "main-incomer",
            "timestamp_utc": "2025-12-05T07:00:00Z",
            "value": 123.45,
            "unit": "kWh",
            "idempotency_key": "optional-stable-id"
          },
          ...
        ],
        "source": "your-system-name"
      }

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
        # In practice, integration tokens are always org-bound; a missing org_id
        # here would indicate a misconfigured token or a legacy single-tenant path.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No organization associated with this credential",
        )

    # Convert Pydantic models to plain dicts before handing off to the service.
    records = [r.dict() for r in payload.records]

    result_dict = ingest_batch_service(
        records=records,
        organization_id=org_id,
        source=payload.source,
        db=db,
    )

    # Structured log for observability
    logger.info(
        "timeseries_batch_ingest org_id=%s source=%s records=%d ingested=%d skipped_duplicate=%d failed=%d",
        org_id,
        payload.source or "",
        len(records),
        result_dict.get("ingested", 0),
        result_dict.get("skipped_duplicate", 0),
        result_dict.get("failed", 0),
    )

    # Map raw dict errors into TimeseriesBatchError for the response model.
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
    user=Depends(get_current_user),
):
    """
    Ingestion health over the last N hours, grouped by (site_id, meter_id).

    For each meter we return:
    - expected_points: window_hours (assuming 1 point/hour)
    - actual_points: count of rows in TimeseriesRecord
    - completeness_pct: actual_points / expected_points * 100
    - last_seen: latest timestamp for that meter in the window

    Multi-tenant behavior:
    - If user.organization_id is set -> only consider data belonging to that org.
    - If user.organization_id is None -> behave as single-tenant/dev.
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    # Base query
    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    # Optional filters
    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

    # Org scoping
    q = deps.apply_org_scope_to_timeseries_query(q, db, user)

    # Pull rows and aggregate in Python to stay DB-agnostic
    rows = (
        q.order_by(
            TimeseriesRecord.site_id,
            TimeseriesRecord.meter_id,
            TimeseriesRecord.timestamp,
        )
        .all()
    )

    meter_map: Dict[tuple[str, str], Dict[str, Any]] = {}

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

        if row.timestamp and (
            data["last_seen"] is None or row.timestamp > data["last_seen"]
        ):
            data["last_seen"] = row.timestamp

    expected_points = window_hours if window_hours > 0 else 0

    meters: List[IngestMeterHealth] = []
    for (s_id, m_id), agg in meter_map.items():
        actual = agg["actual_points"]
        completeness = (
            (actual / expected_points) * 100.0 if expected_points > 0 else 0.0
        )
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


def _bucket_timestamp(ts: datetime, resolution: str) -> datetime:
    if resolution == "day":
        return ts.replace(hour=0, minute=0, second=0, microsecond=0)
    # default: hour
    return ts.replace(minute=0, second=0, microsecond=0)
