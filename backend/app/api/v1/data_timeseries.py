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
    Returns total value, count of points, and min/max timestamps.
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    q = (
        db.query(
            func.coalesce(func.sum(TimeseriesRecord.value), 0),
            func.count(TimeseriesRecord.id),
            func.min(TimeseriesRecord.timestamp),
            func.max(TimeseriesRecord.timestamp),
        )
        .filter(TimeseriesRecord.timestamp >= start)
    )

    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

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
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=window_hours)

    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

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
