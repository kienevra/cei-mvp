# backend/app/services/analytics.py
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from math import sqrt
from dataclasses import dataclass
from statistics import mean, pstdev
from typing import Any, Dict, List, Optional, Tuple

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


# ========= Statistical baselines (deterministic + statistical layer) =========


@dataclass
class BaselineBucket:
    """
    One baseline cell for (hour_of_day, weekend/weekday).

    Example: "weekday 08:00–09:00 has mean 900 kWh with std 120 kWh".
    """

    hour_of_day: int       # 0–23
    is_weekend: bool       # True = Saturday/Sunday
    mean_kwh: float
    std_kwh: float         # 0 if we only have 1 point


@dataclass
class BaselineProfile:
    """
    Baseline profile for a given (site_id, meter_id) over a lookback window.

    This is the core statistical object we will reuse in:
      - /analytics/sites/{site_id}/insights
      - /alerts (statistical anomaly rule)
      - /reports (distribution metrics)
    """

    site_id: Optional[str]
    meter_id: Optional[str]
    lookback_days: int

    buckets: List[BaselineBucket]

    # Global distribution metrics across all points in the lookback
    global_mean: Optional[float]
    global_p50: Optional[float]
    global_p90: Optional[float]

    # Total number of points used
    n_points: int


def compute_baseline_profile(
    db: Session,
    *,
    site_id: Optional[str] = None,
    meter_id: Optional[str] = None,
    lookback_days: int = 30,
    now: Optional[datetime] = None,
    allowed_site_ids: Optional[List[str]] = None,
) -> Optional[BaselineProfile]:
    """
    Compute a statistical baseline profile for a given site/meter.

    - Pulls last `lookback_days` worth of TimeseriesRecord rows.
    - Groups values by (hour_of_day, weekend/weekday).
    - For each group: computes mean and std (population std).
    - Also computes global mean, p50, p90 across all points.

    Returns:
        BaselineProfile if we have data, otherwise None.

    This does NOT change any existing behaviour yet; it's a reusable
    building block for richer insights/alerts.
    """
    if now is None:
        now = _utcnow()

    start = now - timedelta(days=lookback_days)

    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    # Multi-tenant safety: optional org-level scoping via allowed_site_ids
    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

    rows = q.all()
    if not rows:
        # No data in the lookback window – caller must handle None gracefully
        return None

    # Group values by (hour_of_day, is_weekend)
    group_values: Dict[Tuple[int, bool], List[float]] = defaultdict(list)
    all_values: List[float] = []

    for row in rows:
        ts: datetime = row.timestamp
        if not ts:
            continue
        try:
            val = float(row.value)
        except Exception:
            continue

        hour_of_day = ts.hour
        is_weekend = ts.weekday() >= 5

        group_values[(hour_of_day, is_weekend)].append(val)
        all_values.append(val)

    # Build per-bucket statistics
    buckets: List[BaselineBucket] = []
    for (hour_of_day, is_weekend), vals in group_values.items():
        if not vals:
            continue

        if len(vals) == 1:
            m = float(vals[0])
            s = 0.0
        else:
            m = float(mean(vals))
            try:
                s = float(pstdev(vals))
            except Exception:
                # Extremely defensive; we never want baselines to break the app
                s = 0.0

        buckets.append(
            BaselineBucket(
                hour_of_day=hour_of_day,
                is_weekend=is_weekend,
                mean_kwh=m,
                std_kwh=s,
            )
        )

    # Stable sort: weekend flag then hour
    buckets.sort(key=lambda b: (b.is_weekend, b.hour_of_day))

    # Global distribution metrics
    all_values.sort()
    n = len(all_values)

    def _percentile(values: List[float], p: float) -> Optional[float]:
        if not values:
            return None
        # Simple nearest-rank style; operationally good enough
        idx = int(round((p / 100.0) * (len(values) - 1)))
        return float(values[idx])

    global_mean = float(sum(all_values) / n) if n > 0 else None
    global_p50 = _percentile(all_values, 50.0)
    global_p90 = _percentile(all_values, 90.0)

    return BaselineProfile(
        site_id=site_id,
        meter_id=meter_id,
        lookback_days=lookback_days,
        buckets=buckets,
        global_mean=global_mean,
        global_p50=global_p50,
        global_p90=global_p90,
        n_points=n,
    )


# ========= Existing hourly baseline + insights (kept as-is) =========


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

        mean_val = sum(values) / len(values)
        if len(values) > 1:
            variance = sum((v - mean_val) ** 2 for v in values) / len(values)
            std_val = sqrt(variance)
        else:
            std_val = 0.0

        baseline[hour] = {
            "mean": float(mean_val),
            "std": float(std_val),
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
        std_val = base["std"] if base else 0.0

        if expected > 0:
            delta = actual - expected
            delta_pct = (delta / expected) * 100.0
        else:
            delta = actual
            delta_pct = 0.0 if actual == 0 else 100.0

        if std_val > 0:
            z = delta / std_val
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
    allowed_site_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Portfolio-level alert generator that uses the baseline/deviation engine.

    Strategy:
      - For each site_id seen in TimeseriesRecord (optionally restricted to
        allowed_site_ids for multi-tenant safety):
          * Build insights.
          * If deviation is large or there are many critical/elevated hours,
            emit an alert.
      - Keeps output shape compatible with the existing Alerts frontend.
    """
    now = as_of or _utcnow()

    # Get distinct site_ids from the timeseries table
    q = db.query(TimeseriesRecord.site_id).filter(
        TimeseriesRecord.site_id.isnot(None)
    )
    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    site_rows = q.distinct().all()
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


# ========= Forecast stub (predictive layer v0) =========


def compute_site_forecast_stub(
    db: Session,
    *,
    site_id: str,
    history_window_hours: int = 24,
    horizon_hours: int = 24,
    lookback_days: int = 30,
    as_of: Optional[datetime] = None,
    allowed_site_ids: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Very simple baseline-driven forecast stub.

    Uses:
      - compute_baseline_profile(...) over `lookback_days` to get typical hourly levels
      - compute_site_insights(...) over `history_window_hours` to get recent deviation_pct
        and folds that into a single uplift factor.

    Returns a dict with:
      {
        "site_id": str,
        "history_window_hours": int,
        "horizon_hours": int,
        "baseline_lookback_days": int,
        "generated_at": iso-str,
        "method": "stub_baseline_v1",
        "points": [
           {
             "ts": iso-str,
             "expected_kwh": float,
             "lower_kwh": float,
             "upper_kwh": float,
             "basis": "stub_baseline_v1",
           },
           ...
        ],
      }

    If there is not enough data to build a baseline, returns None.
    """
    now = as_of or _utcnow()

    # 1) Statistical baseline profile
    baseline = compute_baseline_profile(
        db=db,
        site_id=site_id,
        meter_id=None,
        lookback_days=lookback_days,
        now=now,
        allowed_site_ids=allowed_site_ids,
    )
    if baseline is None or not baseline.buckets:
        return None

    # 2) Recent deviation vs baseline (deterministic/statistical)
    insights = compute_site_insights(
        db=db,
        site_id=site_id,
        window_hours=history_window_hours,
        lookback_days=lookback_days,
        as_of=now,
    )

    deviation_pct = 0.0
    if insights is not None:
        try:
            deviation_pct = float(insights.get("deviation_pct", 0.0))
        except Exception:
            deviation_pct = 0.0

    # Turn deviation into a simple uplift factor and clamp to sane bounds
    uplift_factor = 1.0 + (deviation_pct / 100.0)
    if uplift_factor < 0.1:
        uplift_factor = 0.1
    if uplift_factor > 3.0:
        uplift_factor = 3.0

    # Index baseline buckets by (hour_of_day, is_weekend)
    bucket_index: Dict[Tuple[int, bool], BaselineBucket] = {}
    for b in baseline.buckets:
        key = (int(b.hour_of_day), bool(b.is_weekend))
        bucket_index[key] = b

    def _get_baseline_for(ts: datetime) -> float:
        hour = ts.hour
        is_weekend = ts.weekday() >= 5

        # Prefer exact (hour, weekend_flag)
        b = bucket_index.get((hour, is_weekend))
        if b is None:
            # Fallback: any bucket with same hour
            b = bucket_index.get((hour, True)) or bucket_index.get((hour, False))

        if b is not None:
            try:
                return float(b.mean_kwh)
            except Exception:
                pass

        gm = baseline.global_mean
        try:
            return float(gm) if gm is not None else 0.0
        except Exception:
            return 0.0

    points: List[Dict[str, Any]] = []
    for h in range(1, horizon_hours + 1):
        ts = now + timedelta(hours=h)
        base = _get_baseline_for(ts)
        expected = base * uplift_factor

        # Very simple symmetric band; intentionally conservative placeholder.
        lower = expected * 0.9 if expected > 0 else 0.0
        upper = expected * 1.1 if expected > 0 else 0.0

        points.append(
            {
                "ts": ts.isoformat(),
                "expected_kwh": float(round(expected, 3)),
                "lower_kwh": float(round(lower, 3)),
                "upper_kwh": float(round(upper, 3)),
                "basis": "stub_baseline_v1",
            }
        )

    return {
        "site_id": site_id,
        "history_window_hours": history_window_hours,
        "horizon_hours": horizon_hours,
        "baseline_lookback_days": lookback_days,
        "generated_at": now.isoformat(),
        "method": "stub_baseline_v1",
        "points": points,
    }
