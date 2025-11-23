# backend/app/services/analytics.py
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from math import sqrt
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import TimeseriesRecord


def _utcnow() -> datetime:
    # Keep this naive (no tzinfo) to match how timestamps are parsed from CSVs
    return datetime.utcnow()


def _load_site_history(
    db: Session,
    site_id: str,
    history_start: datetime,
    history_end: datetime,
) -> List[TimeseriesRecord]:
    """
    Load historical records for baseline calculation.
    """
    q = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id == site_id)
        .filter(TimeseriesRecord.timestamp >= history_start)
        .filter(TimeseriesRecord.timestamp < history_end)
    )
    return q.all()


def _load_site_recent(
    db: Session,
    site_id: str,
    recent_start: datetime,
    recent_end: datetime,
) -> List[TimeseriesRecord]:
    """
    Load recent records for deviation scoring.
    """
    q = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id == site_id)
        .filter(TimeseriesRecord.timestamp >= recent_start)
        .filter(TimeseriesRecord.timestamp <= recent_end)
    )
    return q.all()


def compute_hourly_baseline(
    db: Session,
    site_id: str,
    lookback_days: int = 30,
    as_of: Optional[datetime] = None,
) -> Dict[int, Dict[str, float]]:
    """
    Compute a very simple "learned" baseline per hour-of-day for a site,
    using the last `lookback_days` of data.

    Returns:
      { hour: {"mean": float, "std": float}, ... }
    """
    now = as_of or _utcnow()
    history_end = now
    history_start = now - timedelta(days=lookback_days)

    records = _load_site_history(db, site_id, history_start, history_end)
    if not records:
        return {}

    buckets: Dict[int, List[float]] = defaultdict(list)

    for rec in records:
        if not rec.timestamp:
            continue
        try:
            val = float(rec.value)
        except Exception:
            continue

        hour = rec.timestamp.hour  # 0–23
        buckets[hour].append(val)

    baseline: Dict[int, Dict[str, float]] = {}
    for hour, values in buckets.items():
        if not values:
            continue

        mean = sum(values) / len(values)
        if len(values) > 1:
            variance = sum((v - mean) ** 2 for v in values) / len(values)
            std = sqrt(variance)
        else:
            std = 0.0

        baseline[hour] = {
            "mean": float(mean),
            "std": float(std),
        }

    return baseline


def compute_site_insights(
    db: Session,
    site_id: str,
    window_hours: int = 24,
    lookback_days: int = 30,
    as_of: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """
    Core engine that:
      1) Builds a per-hour baseline from historical data.
      2) Compares the last `window_hours` of actuals vs that baseline.
      3) Returns structured "insights" that both /analytics and /alerts can use.
    """
    now = as_of or _utcnow()
    recent_end = now
    recent_start = now - timedelta(hours=window_hours)

    # 1) Baseline
    baseline = compute_hourly_baseline(
        db=db,
        site_id=site_id,
        lookback_days=lookback_days,
        as_of=now,
    )
    # No baseline -> nothing to say
    if not baseline:
        return None

    # 2) Recent actuals
    recent_records = _load_site_recent(db, site_id, recent_start, recent_end)
    if not recent_records:
        return None

    # Aggregate recent actuals by hour-of-day (0–23)
    actual_by_hour: Dict[int, float] = defaultdict(float)
    for rec in recent_records:
        if not rec.timestamp:
            continue
        try:
            val = float(rec.value)
        except Exception:
            continue
        hour = rec.timestamp.hour
        actual_by_hour[hour] += val

    hours_output: List[Dict[str, Any]] = []

    total_actual = 0.0
    total_expected = 0.0
    critical_hours = 0
    elevated_hours = 0
    below_baseline_hours = 0

    for hour in range(24):
        actual = actual_by_hour.get(hour, 0.0)
        base = baseline.get(hour)
        expected = base["mean"] if base else 0.0
        std = base["std"] if base else 0.0

        if expected > 0:
            delta = actual - expected
            delta_pct = (delta / expected) * 100.0
        else:
            delta = actual
            delta_pct = 0.0 if actual == 0 else 100.0

        if std > 0:
            z = delta / std
        else:
            z = 0.0

        total_actual += actual
        if expected > 0:
            total_expected += expected

        if expected > 0 and actual < expected:
            below_baseline_hours += 1

        band = "normal"
        if expected > 0:
            # baseline-driven classification
            if delta_pct >= 30.0 or z >= 2.5:
                band = "critical"
                critical_hours += 1
            elif delta_pct >= 10.0 or z >= 1.5:
                band = "elevated"
                elevated_hours += 1

        hours_output.append(
            {
                "hour": hour,
                "actual_kwh": round(actual, 3),
                "expected_kwh": round(expected, 3),
                "delta_kwh": round(delta, 3),
                "delta_pct": round(delta_pct, 2),
                "z_score": round(z, 2),
                "band": band,
            }
        )

    deviation_pct = 0.0
    if total_expected > 0:
        deviation_pct = (total_actual - total_expected) / total_expected * 100.0

    insights: Dict[str, Any] = {
        "site_id": site_id,
        "window_hours": window_hours,
        "baseline_lookback_days": lookback_days,
        "total_actual_kwh": round(total_actual, 3),
        "total_expected_kwh": round(total_expected, 3),
        "deviation_pct": round(deviation_pct, 2),
        "critical_hours": critical_hours,
        "elevated_hours": elevated_hours,
        "below_baseline_hours": below_baseline_hours,
        "hours": hours_output,
        "generated_at": now.isoformat(),
    }
    return insights


def generate_alerts_for_all_sites(
    db: Session,
    window_hours: int = 24,
    lookback_days: int = 30,
    as_of: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """
    Portfolio-level alert generator that uses the baseline/deviation engine.

    Strategy:
      - For each site_id seen in TimeseriesRecord:
          * Build insights.
          * If deviation is large or there are many critical/elevated hours,
            emit an alert.
      - Keeps output shape compatible with the existing Alerts frontend.
    """
    now = as_of or _utcnow()

    # Get distinct site_ids from the timeseries table
    site_rows = (
        db.query(TimeseriesRecord.site_id)
        .filter(TimeseriesRecord.site_id.isnot(None))
        .distinct()
        .all()
    )
    site_ids: List[str] = [row[0] for row in site_rows if row[0]]

    alerts: List[Dict[str, Any]] = []

    for site_id in site_ids:
        insights = compute_site_insights(
            db=db,
            site_id=site_id,
            window_hours=window_hours,
            lookback_days=lookback_days,
            as_of=now,
        )
        if not insights:
            continue

        dev_pct = float(insights.get("deviation_pct", 0.0))
        crit_hours = int(insights.get("critical_hours", 0))
        elev_hours = int(insights.get("elevated_hours", 0))

        severity: Optional[str] = None
        title: Optional[str] = None

        # Simple but defensible rules:
        if dev_pct >= 30.0 or crit_hours >= 2:
            severity = "critical"
            title = "Sustained high consumption vs baseline"
        elif dev_pct >= 10.0 or elev_hours >= 2:
            severity = "warning"
            title = "Elevated consumption vs baseline"
        else:
            # small deviations – optionally emit info alerts only if notable
            if abs(dev_pct) < 5.0:
                continue  # too small, skip as noise
            severity = "info"
            title = "Mild deviation vs baseline"

        message_parts = [
            f"Total energy in the last {window_hours}h is {dev_pct:+.1f}% vs this site's learned baseline.",
            f"Critical hours: {crit_hours}, elevated hours: {elev_hours}.",
        ]
        message = " ".join(message_parts)

        alerts.append(
            {
                "id": f"{site_id}:{window_hours}",
                "site_id": site_id,
                "site_name": None,  # frontend falls back to site_id if missing
                "severity": severity,
                "title": title,
                "message": message,
                "metric": "kwh_vs_baseline_pct",
                "window_hours": window_hours,
                "triggered_at": now,
            }
        )

    return alerts
