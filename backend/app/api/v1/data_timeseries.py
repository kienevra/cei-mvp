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

from app.api.v1.auth import get_current_user
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
    user=Depends(get_current_user),
):
    """
    Direct ingestion endpoint for integrators and backends.

    Phase #3:
    - Accepts JSON records with {site_id, meter_id, timestamp_utc, value, unit, idempotency_key}.
    - Uses the same org-scoping model as the rest of the app (currently via user.org).
    - Internally delegates to app.services.ingest.ingest_timeseries_batch.

    NOTE:
    - At this stage, auth is user-based (JWT). Integration tokens will plug in
      later via a dedicated dependency that resolves organization_id from a
      long-lived token instead of a user session.
    """
    if not payload.records:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="records must be a non-empty list",
        )

    org_id = getattr(user, "organization_id", None)

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


def _bucket_timestamp(ts: datetime, resolution: str) -> datetime:
    if resolution == "day":
        return ts.replace(hour=0, minute=0, second=0, microsecond=0)
    # default: hour
    return ts.replace(minute=0, second=0, microsecond=0)
