# backend/app/api/v1/data_timeseries.py
from datetime import datetime, timedelta
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import TimeseriesRecord
from app.api import deps  # org-scoping helpers

router = APIRouter(prefix="/timeseries", tags=["timeseries"])


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


def _bucket_timestamp(ts: datetime, resolution: str) -> datetime:
    if resolution == "day":
        return ts.replace(hour=0, minute=0, second=0, microsecond=0)
    # default: hour
    return ts.replace(minute=0, second=0, microsecond=0)
