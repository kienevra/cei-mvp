# backend/app/api/v1/alerts.py
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import TimeseriesRecord  # and Site if available

logger = logging.getLogger("cei")

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertOut(BaseModel):
    id: str
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    severity: Literal["critical", "warning", "info"]
    title: str
    message: str
    metric: Optional[str] = None
    window_hours: int
    triggered_at: datetime

    class Config:
        from_attributes = True  # pydantic v2 replacement for orm_mode


class AlertThresholdsConfig(BaseModel):
    """
    Central place to tune alert thresholds.

    Global defaults live here; you can override per-site below.
    """

    # Night vs day baseline
    night_warning_ratio: float = 0.4   # >= 40% of day -> warning
    night_critical_ratio: float = 0.7  # >= 70% of day -> critical

    # Peak vs average (short windows)
    spike_warning_ratio: float = 2.5   # >= 2.5x avg -> warning

    # Portfolio dominance
    portfolio_share_info_ratio: float = 1.5  # >= 1.5x avg per site -> info

    # NEW: Weekend vs weekday baseline
    weekend_warning_ratio: float = 0.6   # weekend >= 60% of weekday -> warning
    weekend_critical_ratio: float = 0.8  # weekend >= 80% of weekday -> critical

    # Data quality guards
    min_points: int = 4
    min_total_kwh: float = 0.0


# Global defaults
DEFAULT_THRESHOLDS = AlertThresholdsConfig()

# Optional per-site overrides (keyed by timeseries site_id, e.g. "site-1")
SITE_THRESHOLDS: Dict[str, AlertThresholdsConfig] = {
    # Example of how you'd override in future:
    # "site-1": AlertThresholdsConfig(
    #     night_warning_ratio=0.5,
    #     night_critical_ratio=0.8,
    #     spike_warning_ratio=3.0,
    # )
}


def get_thresholds_for_site(site_id: Optional[str]) -> AlertThresholdsConfig:
    if not site_id:
        return DEFAULT_THRESHOLDS
    return SITE_THRESHOLDS.get(site_id, DEFAULT_THRESHOLDS)


@router.get(
    "/",
    response_model=List[AlertOut],
    status_code=status.HTTP_200_OK,
)
def list_alerts(
    window_hours: int = Query(
        24,
        ge=1,
        le=24 * 30,
        description="Look-back window in hours (e.g. 24, 168 for 7 days).",
    ),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[AlertOut]:
    """
    Return portfolio alerts computed from TimeseriesRecord.

    Rules (MVP, but grounded in real ops):
    - High night-time baseline (critical / warning)
    - Peak spikes vs average (warning)
    - Site dominating portfolio energy (info)
    - NEW: weekend baseline too close to weekday baseline (warning / critical)
    """
    # Clamp any silly values
    if window_hours <= 0:
        window_hours = 24
    if window_hours > 24 * 30:
        window_hours = 24 * 30

    alerts = _generate_alerts_for_window(db=db, window_hours=window_hours)
    logger.info("Generated %d alerts for window_hours=%s", len(alerts), window_hours)
    return alerts


# ---- Internal helpers ----


def _generate_alerts_for_window(db: Session, window_hours: int) -> List[AlertOut]:
    window_start = datetime.utcnow() - timedelta(hours=window_hours)

    # Base stats per site_id
    stats_rows = (
        db.query(
            TimeseriesRecord.site_id,
            func.count().label("points"),
            func.sum(TimeseriesRecord.value).label("total_value"),
            func.avg(TimeseriesRecord.value).label("avg_value"),
            func.max(TimeseriesRecord.value).label("max_value"),
            func.min(TimeseriesRecord.value).label("min_value"),
            func.max(TimeseriesRecord.timestamp).label("last_ts"),
        )
        .filter(TimeseriesRecord.timestamp >= window_start)
        .group_by(TimeseriesRecord.site_id)
        .all()
    )

    if not stats_rows:
        return []

    # Aggregate portfolio numbers
    portfolio_total = float(sum((row.total_value or 0) for row in stats_rows))
    total_sites = len(stats_rows)
    portfolio_avg_per_site = portfolio_total / total_sites if total_sites > 0 else 0.0

    # Pull raw points once and compute day/night + weekday/weekend in Python
    point_rows = (
        db.query(
            TimeseriesRecord.site_id,
            TimeseriesRecord.timestamp,
            TimeseriesRecord.value,
        )
        .filter(TimeseriesRecord.timestamp >= window_start)
        .all()
    )

    # Typical "plant" definition of night and day hours
    night_hours = {0, 1, 2, 3, 4, 5, 22, 23}
    day_hours = {8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19}

    buckets_by_site: Dict[str, Dict[str, float]] = {}

    for row in point_rows:
        site_id = row.site_id or "unknown"
        ts: datetime = row.timestamp
        try:
            val = float(row.value or 0)
        except Exception:
            val = 0.0

        bucket = buckets_by_site.get(site_id)
        if bucket is None:
            bucket = {
                "night_sum": 0.0,
                "night_count": 0.0,
                "day_sum": 0.0,
                "day_count": 0.0,
                "weekday_sum": 0.0,
                "weekday_count": 0.0,
                "weekend_sum": 0.0,
                "weekend_count": 0.0,
            }
            buckets_by_site[site_id] = bucket

        hour = ts.hour
        if hour in night_hours:
            bucket["night_sum"] += val
            bucket["night_count"] += 1
        if hour in day_hours:
            bucket["day_sum"] += val
            bucket["day_count"] += 1

        # Python weekday(): 0=Mon, ..., 6=Sun
        dow = ts.weekday()
        if dow < 5:
            bucket["weekday_sum"] += val
            bucket["weekday_count"] += 1
        else:
            bucket["weekend_sum"] += val
            bucket["weekend_count"] += 1

    # Best-effort site name resolution (e.g. site-1 → Site 1)
    site_name_map: Dict[str, str] = _build_site_name_map(db, stats_rows)

    alerts: List[AlertOut] = []
    alert_id_counter = 1

    for row in stats_rows:
        site_id = row.site_id or "unknown"
        total_value = float(row.total_value or 0)
        points = int(row.points or 0)
        avg_value = float(row.avg_value or 0)
        max_value = float(row.max_value or 0)
        min_value = float(row.min_value or 0)  # noqa: F841  # reserved for future rules
        last_ts = row.last_ts or datetime.utcnow()
        site_name = site_name_map.get(site_id)

        thresholds = get_thresholds_for_site(site_id)

        # Skip sites with too little data
        if points < thresholds.min_points or total_value <= thresholds.min_total_kwh:
            continue

        # Pull bucketed stats if we have them
        bucket = buckets_by_site.get(site_id, {})
        night_sum = float(bucket.get("night_sum", 0.0))
        night_count = float(bucket.get("night_count", 0.0))
        day_sum = float(bucket.get("day_sum", 0.0))
        day_count = float(bucket.get("day_count", 0.0))
        weekday_sum = float(bucket.get("weekday_sum", 0.0))
        weekday_count = float(bucket.get("weekday_count", 0.0))
        weekend_sum = float(bucket.get("weekend_sum", 0.0))
        weekend_count = float(bucket.get("weekend_count", 0.0))

        avg_night = night_sum / night_count if night_count > 0 else 0.0
        avg_day = day_sum / day_count if day_count > 0 else 0.0
        avg_weekday = weekday_sum / weekday_count if weekday_count > 0 else 0.0
        avg_weekend = weekend_sum / weekend_count if weekend_count > 0 else 0.0

        # ---------- Rule 1: Night-time baseline too high ----------
        if avg_day > 0:
            night_ratio = avg_night / avg_day if avg_day > 0 else 0.0
        else:
            night_ratio = 0.0

        # Only consider sites that matter at portfolio level
        is_material = portfolio_total > 0 and total_value >= 0.2 * portfolio_total

        if avg_day > 0 and night_ratio >= thresholds.night_critical_ratio and is_material:
            alerts.append(
                AlertOut(
                    id=f"{alert_id_counter}",
                    site_id=site_id,
                    site_name=site_name,
                    severity="critical",
                    title="High night-time baseline",
                    message=(
                        f"{site_name or site_id} has a night-time baseline at "
                        f"{night_ratio:.0%} of the day-time average over the last {window_hours}h. "
                        "This usually indicates significant idle losses (compressors, HVAC, lines left on)."
                    ),
                    metric="night_baseline_ratio",
                    window_hours=window_hours,
                    triggered_at=last_ts,
                )
            )
            alert_id_counter += 1
        elif avg_day > 0 and thresholds.night_warning_ratio <= night_ratio < thresholds.night_critical_ratio:
            alerts.append(
                AlertOut(
                    id=f"{alert_id_counter}",
                    site_id=site_id,
                    site_name=site_name,
                    severity="warning",
                    title="Elevated night-time baseline",
                    message=(
                        f"{site_name or site_id} shows a night-time baseline at "
                        f"{night_ratio:.0%} of day-time average over the last {window_hours}h. "
                        "There is likely low-hanging fruit in shutdown procedures."
                    ),
                    metric="night_baseline_ratio",
                    window_hours=window_hours,
                    triggered_at=last_ts,
                )
            )
            alert_id_counter += 1

        # ---------- Rule 2: Peak spikes vs typical load (short windows only) ----------
        if window_hours <= 48 and avg_value > 0:
            spike_ratio = max_value / avg_value if avg_value > 0 else 0.0

            if spike_ratio >= thresholds.spike_warning_ratio and max_value > 0:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="warning",
                        title="Short-term peak significantly above typical load",
                        message=(
                            f"{site_name or site_id} has a peak hour at {max_value:.1f} kWh, "
                            f"which is {spike_ratio:.1f}x the average for the last {window_hours}h. "
                            "Check for overlapping batches, start-up procedures, or one-off events."
                        ),
                        metric="peak_spike_ratio",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                    )
                )
                alert_id_counter += 1

        # ---------- NEW Rule 3: Weekend baseline vs weekday baseline ----------
        # Only meaningful if we actually have both weekday and weekend data
        if avg_weekday > 0 and avg_weekend > 0:
            weekend_ratio = avg_weekend / avg_weekday

            if weekend_ratio >= thresholds.weekend_critical_ratio and is_material:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="critical",
                        title="Weekend baseline close to weekday levels",
                        message=(
                            f"{site_name or site_id} shows weekend consumption at "
                            f"{weekend_ratio:.0%} of weekday average over the last {window_hours}h. "
                            "This usually indicates large portions of the plant stay energized through weekends."
                        ),
                        metric="weekend_weekday_ratio",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                    )
                )
                alert_id_counter += 1
            elif weekend_ratio >= thresholds.weekend_warning_ratio:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="warning",
                        title="Elevated weekend baseline",
                        message=(
                            f"{site_name or site_id} has weekend consumption at "
                            f"{weekend_ratio:.0%} of weekday average over the last {window_hours}h. "
                            "Review weekend shutdown procedures and auxiliary loads."
                        ),
                        metric="weekend_weekday_ratio",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                    )
                )
                alert_id_counter += 1

        # ---------- Rule 4: Site dominating portfolio energy (informational) ----------
        if portfolio_avg_per_site > 0:
            if total_value >= thresholds.portfolio_share_info_ratio * portfolio_avg_per_site:
                share = (total_value / portfolio_total) * 100 if portfolio_total > 0 else 0
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="info",
                        title="Site dominates portfolio energy",
                        message=(
                            f"{site_name or site_id} is consuming {share:.1f}% of portfolio "
                            f"energy over the last {window_hours}h. This is a natural candidate "
                            "for deeper opportunity hunting and focused projects."
                        ),
                        metric="relative_share",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                    )
                )
                alert_id_counter += 1

    return alerts


def _build_site_name_map(db: Session, stats_rows) -> Dict[str, str]:
    """
    Best-effort mapping from timeseries.site_id -> human-readable site name.

    For IDs like 'site-1', we try to resolve Site(id=1). If the Site model
    is not available or the lookup fails, we simply fall back to the raw site_id.
    """
    try:
        # Import here to avoid hard failure if Site isn't exposed via app.models
        from app.models import Site  # type: ignore

        numeric_ids = set()
        for row in stats_rows:
            raw_id = row.site_id
            if not raw_id:
                continue
            parsed = _try_parse_site_numeric_id(raw_id)
            if parsed is not None:
                numeric_ids.add(parsed)

        if not numeric_ids:
            return {}

        site_rows = db.query(Site).filter(Site.id.in_(numeric_ids)).all()

        mapping: Dict[str, str] = {}
        for s in site_rows:
            label = s.name or f"Site {s.id}"
            mapping[f"site-{s.id}"] = label
            mapping[str(s.id)] = label
        return mapping
    except Exception:
        logger.exception("Failed to build site name map; falling back to raw site_id only.")
        return {}


def _try_parse_site_numeric_id(site_id: str) -> Optional[int]:
    if not site_id:
        return None
    site_id = site_id.strip()
    if site_id.startswith("site-"):
        try:
            return int(site_id.split("site-")[-1])
        except ValueError:
            return None
    try:
        return int(site_id)
    except ValueError:
        return None
