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
    *,
    organization_id: Optional[int] = None,
    allowed_site_ids: Optional[List[str]] = None,
) -> List[TimeseriesRecord]:
    """
    Load historical records for baseline calculation.

    Multi-tenant safety (additive, optional):
      - If organization_id is provided, filter TimeseriesRecord.organization_id.
      - If allowed_site_ids is provided, filter TimeseriesRecord.site_id IN allowed_site_ids.
    """
    q = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id == site_id)
        .filter(TimeseriesRecord.timestamp >= history_start)
        .filter(TimeseriesRecord.timestamp < history_end)
    )

    if organization_id is not None:
        q = q.filter(TimeseriesRecord.organization_id == organization_id)

    # Defense-in-depth: if caller supplies allow-list, constrain to it too
    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    return q.all()


def _load_site_recent(
    db: Session,
    site_id: str,
    recent_start: datetime,
    recent_end: datetime,
    *,
    organization_id: Optional[int] = None,
    allowed_site_ids: Optional[List[str]] = None,
) -> List[TimeseriesRecord]:
    """
    Load recent records for deviation scoring.

    Multi-tenant safety (additive, optional):
      - If organization_id is provided, filter TimeseriesRecord.organization_id.
      - If allowed_site_ids is provided, filter TimeseriesRecord.site_id IN allowed_site_ids.
    """
    q = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id == site_id)
        .filter(TimeseriesRecord.timestamp >= recent_start)
        .filter(TimeseriesRecord.timestamp <= recent_end)
    )

    if organization_id is not None:
        q = q.filter(TimeseriesRecord.organization_id == organization_id)

    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    return q.all()


# ========= Baseline confidence thresholds =========

# Below this many days of actual history, we treat the baseline as "warming up"
MIN_HISTORY_DAYS_FOR_CONFIDENT_BASELINE = 7


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

    # Warm-up / confidence metadata
    # How many days of actual data span we have in this baseline (min..max timestamp)
    total_history_days: Optional[int] = None
    # True if baseline is still "warming up" (not enough history)
    is_warming_up: bool = False
    # "low" / "normal" for now; can be extended later
    confidence_level: Optional[str] = None


def compute_baseline_profile(
    db: Session,
    *,
    site_id: Optional[str] = None,
    meter_id: Optional[str] = None,
    lookback_days: int = 30,
    now: Optional[datetime] = None,
    allowed_site_ids: Optional[List[str]] = None,
    organization_id: Optional[int] = None,
) -> Optional[BaselineProfile]:
    """
    Compute a statistical baseline profile for a given site/meter.

    Multi-tenant safety (additive, optional):
      - If organization_id is provided, filter TimeseriesRecord.organization_id.
      - If allowed_site_ids is provided, filter TimeseriesRecord.site_id IN allowed_site_ids.

    Returns:
        BaselineProfile if we have data, otherwise None.
    """
    if now is None:
        now = _utcnow()

    start = now - timedelta(days=lookback_days)

    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.timestamp >= start)

    if organization_id is not None:
        q = q.filter(TimeseriesRecord.organization_id == organization_id)

    # Defense-in-depth allow-list
    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    if site_id:
        q = q.filter(TimeseriesRecord.site_id == site_id)
    if meter_id:
        q = q.filter(TimeseriesRecord.meter_id == meter_id)

    rows = q.all()
    if not rows:
        return None

    # Compute actual history span for warm-up / confidence metadata
    valid_timestamps: List[datetime] = [r.timestamp for r in rows if r.timestamp is not None]
    total_history_days: Optional[int] = None
    is_warming_up: bool = False
    confidence_level: Optional[str] = None

    if valid_timestamps:
        min_ts = min(valid_timestamps)
        max_ts = max(valid_timestamps)
        span_days = (max_ts.date() - min_ts.date()).days + 1
        total_history_days = span_days
        is_warming_up = span_days < MIN_HISTORY_DAYS_FOR_CONFIDENT_BASELINE
        confidence_level = "low" if is_warming_up else "normal"

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
        is_weekend_flag = ts.weekday() >= 5

        group_values[(hour_of_day, is_weekend_flag)].append(val)
        all_values.append(val)

    # Build per-bucket statistics
    buckets: List[BaselineBucket] = []
    for (hour_of_day, is_weekend_flag), vals in group_values.items():
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
                s = 0.0

        buckets.append(
            BaselineBucket(
                hour_of_day=hour_of_day,
                is_weekend=is_weekend_flag,
                mean_kwh=m,
                std_kwh=s,
            )
        )

    buckets.sort(key=lambda b: (b.is_weekend, b.hour_of_day))

    # Global distribution metrics
    all_values.sort()
    n = len(all_values)

    def _percentile(values: List[float], p: float) -> Optional[float]:
        if not values:
            return None
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
        total_history_days=total_history_days,
        is_warming_up=is_warming_up,
        confidence_level=confidence_level,
    )


# ========= Existing hourly baseline + insights (kept as-is, now enriched) =========


def compute_hourly_baseline(
    db: Session,
    site_id: str,
    lookback_days: int = 30,
    as_of: Optional[datetime] = None,
    *,
    organization_id: Optional[int] = None,
    allowed_site_ids: Optional[List[str]] = None,
) -> Dict[int, Dict[str, float]]:
    """
    Compute a very simple "learned" baseline per hour-of-day for a site,
    using the last `lookback_days` of data.

    Multi-tenant safety (additive, optional):
      - If organization_id is provided, filter TimeseriesRecord.organization_id.
      - If allowed_site_ids is provided, filter TimeseriesRecord.site_id IN allowed_site_ids.
    """
    now = as_of or _utcnow()
    history_end = now
    history_start = now - timedelta(days=lookback_days)

    records = _load_site_history(
        db, site_id, history_start, history_end,
        organization_id=organization_id,
        allowed_site_ids=allowed_site_ids,
    )
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
    *,
    organization_id: Optional[int] = None,
    allowed_site_ids: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Core engine that:
      1) Builds a per-hour baseline from historical data.
      2) Compares the last `window_hours` of actuals vs that baseline.
      3) Returns structured "insights" that both /analytics and /alerts can use.

    Multi-tenant safety (additive, optional):
      - If organization_id is provided, filter TimeseriesRecord.organization_id.
      - If allowed_site_ids is provided, constrain reads to that allow-list.
    """
    now = as_of or _utcnow()
    recent_end = now
    recent_start = now - timedelta(hours=window_hours)

    # 1) Baseline (hour-of-day dict used for deviation logic)
    baseline = compute_hourly_baseline(
        db=db,
        site_id=site_id,
        lookback_days=lookback_days,
        as_of=now,
        organization_id=organization_id,
        allowed_site_ids=allowed_site_ids,
    )
    if not baseline:
        return None

    # 1b) Statistical baseline profile for richer context (best-effort)
    baseline_profile_obj: Optional[BaselineProfile] = None
    try:
        baseline_profile_obj = compute_baseline_profile(
            db=db,
            site_id=site_id,
            meter_id=None,
            lookback_days=lookback_days,
            now=now,
            allowed_site_ids=allowed_site_ids,
            organization_id=organization_id,
        )
    except Exception:
        baseline_profile_obj = None

    baseline_profile_payload: Optional[Dict[str, Any]] = None
    if baseline_profile_obj is not None:
        try:
            baseline_profile_payload = {
                "site_id": baseline_profile_obj.site_id,
                "meter_id": baseline_profile_obj.meter_id,
                "lookback_days": baseline_profile_obj.lookback_days,
                "global_mean_kwh": baseline_profile_obj.global_mean,
                "global_p50_kwh": baseline_profile_obj.global_p50,
                "global_p90_kwh": baseline_profile_obj.global_p90,
                "n_points": baseline_profile_obj.n_points,
                "total_history_days": baseline_profile_obj.total_history_days,
                "is_warming_up": baseline_profile_obj.is_warming_up,
                "confidence_level": baseline_profile_obj.confidence_level,
                "buckets": [
                    {
                        "hour_of_day": b.hour_of_day,
                        "is_weekend": b.is_weekend,
                        "mean_kwh": b.mean_kwh,
                        "std_kwh": b.std_kwh,
                    }
                    for b in baseline_profile_obj.buckets
                ],
            }
        except Exception:
            baseline_profile_payload = None

    # Derive top-level warm-up / confidence flags for this site's insights
    total_history_days: Optional[int] = None
    is_baseline_warming_up: bool = False
    confidence_level: str = "normal"

    if baseline_profile_obj is not None:
        total_history_days = baseline_profile_obj.total_history_days
        is_baseline_warming_up = bool(baseline_profile_obj.is_warming_up)
        if baseline_profile_obj.confidence_level:
            confidence_level = str(baseline_profile_obj.confidence_level)
        else:
            confidence_level = "low" if is_baseline_warming_up else "normal"

    # 2) Recent actuals
    recent_records = _load_site_recent(
        db, site_id, recent_start, recent_end,
        organization_id=organization_id,
        allowed_site_ids=allowed_site_ids,
    )
    if not recent_records:
        return None

    # Aggregate recent actuals by hour-of-day (0–23) (legacy path)
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

    # ---- IMPORTANT FIX (only when window_hours > 24): expand expected/actual over full window ----
    # Keep the existing 24-entry behavior unchanged for window_hours <= 24.
    if int(window_hours) > 24:
        # Build a per-hour (ts floored to hour) actual series for the last window_hours.
        def _floor_to_hour(ts: datetime) -> datetime:
            return ts.replace(minute=0, second=0, microsecond=0)

        actual_by_ts: Dict[datetime, float] = defaultdict(float)
        for rec in recent_records:
            ts = rec.timestamp
            if not ts:
                continue
            try:
                val = float(rec.value)
            except Exception:
                continue
            hts = _floor_to_hour(ts)
            if hts < recent_start or hts >= recent_end:
                continue
            actual_by_ts[hts] += val

        # Index statistical buckets by (hour_of_day, is_weekend) when available
        bucket_index: Dict[Tuple[int, bool], BaselineBucket] = {}
        if baseline_profile_obj is not None and baseline_profile_obj.buckets:
            for b in baseline_profile_obj.buckets:
                try:
                    bucket_index[(int(b.hour_of_day), bool(b.is_weekend))] = b
                except Exception:
                    continue

        def _expected_and_std_for(ts: datetime) -> Tuple[float, float]:
            hour_of_day = ts.hour
            is_weekend_flag = ts.weekday() >= 5

            # Prefer statistical buckets (weekday/weekend-aware)
            b = bucket_index.get((hour_of_day, is_weekend_flag))
            if b is None:
                # Fallback: try any bucket for that hour (either weekend/weekday)
                b = bucket_index.get((hour_of_day, True)) or bucket_index.get((hour_of_day, False))
            if b is not None:
                try:
                    return float(b.mean_kwh), float(b.std_kwh)
                except Exception:
                    pass

            # Final fallback: legacy per-hour baseline (weekday/weekend-agnostic)
            base = baseline.get(hour_of_day)
            if base:
                try:
                    return float(base.get("mean", 0.0)), float(base.get("std", 0.0))
                except Exception:
                    return 0.0, 0.0

            return 0.0, 0.0

        # Emit one entry per hour in the requested window (chronological).
        # We keep "hour" as the sequential offset to avoid collapsing repeated hour-of-day values.
        base_ts = _floor_to_hour(recent_end) - timedelta(hours=int(window_hours))
        for i in range(int(window_hours)):
            ts = base_ts + timedelta(hours=i)
            actual = float(actual_by_ts.get(ts, 0.0))

            expected, std_val = _expected_and_std_for(ts)

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
                if delta_pct >= 30.0 or z >= 2.5:
                    band = "critical"
                    critical_hours += 1
                elif delta_pct >= 10.0 or z >= 1.5:
                    band = "elevated"
                    elevated_hours += 1

            hours_output.append(
                {
                    "hour": int(i),
                    "actual_kwh": round(actual, 3),
                    "expected_kwh": round(expected, 3),
                    "delta_kwh": round(delta, 3),
                    "delta_pct": round(delta_pct, 2),
                    "z_score": round(z, 2),
                    "band": band,
                }
            )

    else:
        # ---- Legacy behavior (unchanged): 24 buckets by hour-of-day ----
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
        # Warm-up / confidence metadata
        "total_history_days": total_history_days,
        "is_baseline_warming_up": is_baseline_warming_up,
        "confidence_level": confidence_level,
    }

    if baseline_profile_payload is not None:
        insights["baseline_profile"] = baseline_profile_payload

    return insights


def generate_alerts_for_all_sites(
    db: Session,
    window_hours: int = 24,
    lookback_days: int = 30,
    as_of: Optional[datetime] = None,
    allowed_site_ids: Optional[List[str]] = None,
    *,
    organization_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Portfolio-level alert generator that uses the baseline/deviation engine.

    Multi-tenant safety (additive, optional):
      - If organization_id is provided, filter TimeseriesRecord.organization_id.
      - If allowed_site_ids is provided, restricts to those site_ids.
    """
    now = as_of or _utcnow()

    q = db.query(TimeseriesRecord.site_id).filter(TimeseriesRecord.site_id.isnot(None))

    if organization_id is not None:
        q = q.filter(TimeseriesRecord.organization_id == organization_id)

    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    site_rows = q.distinct().all()
    site_ids: List[str] = [row[0] for row in site_rows if row[0]]

    alerts: List[Dict[str, Any]] = []

    for sid in site_ids:
        insights = compute_site_insights(
            db=db,
            site_id=sid,
            window_hours=window_hours,
            lookback_days=lookback_days,
            as_of=now,
            organization_id=organization_id,
            allowed_site_ids=allowed_site_ids,
        )
        if not insights:
            continue

        dev_pct = float(insights.get("deviation_pct", 0.0))
        crit_hours = int(insights.get("critical_hours", 0))
        elev_hours = int(insights.get("elevated_hours", 0))

        severity: Optional[str] = None
        title: Optional[str] = None

        if dev_pct >= 30.0 or crit_hours >= 2:
            severity = "critical"
            title = "Sustained high consumption vs baseline"
        elif dev_pct >= 10.0 or elev_hours >= 2:
            severity = "warning"
            title = "Elevated consumption vs baseline"
        else:
            if abs(dev_pct) < 5.0:
                continue
            severity = "info"
            title = "Mild deviation vs baseline"

        message = (
            f"Total energy in the last {window_hours}h is {dev_pct:+.1f}% vs this site's learned baseline. "
            f"Critical hours: {crit_hours}, elevated hours: {elev_hours}."
        )

        alerts.append(
            {
                "id": f"{sid}:{window_hours}",
                "site_id": sid,
                "site_name": None,
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
    organization_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """
    Very simple baseline-driven forecast stub.

    Multi-tenant safety (additive, optional):
      - If organization_id is provided, filter TimeseriesRecord.organization_id.
      - If allowed_site_ids is provided, restricts to those site_ids.
    """
    now = as_of or _utcnow()

    baseline = compute_baseline_profile(
        db=db,
        site_id=site_id,
        meter_id=None,
        lookback_days=lookback_days,
        now=now,
        allowed_site_ids=allowed_site_ids,
        organization_id=organization_id,
    )
    if baseline is None or not baseline.buckets:
        return None

    # IMPORTANT: pass the same scoping into insights, otherwise forecast can leak
    insights = compute_site_insights(
        db=db,
        site_id=site_id,
        window_hours=history_window_hours,
        lookback_days=lookback_days,
        as_of=now,
        organization_id=organization_id,
        allowed_site_ids=allowed_site_ids,
    )

    deviation_pct = 0.0
    if insights is not None:
        try:
            deviation_pct = float(insights.get("deviation_pct", 0.0))
        except Exception:
            deviation_pct = 0.0

    uplift_factor = 1.0 + (deviation_pct / 100.0)
    if uplift_factor < 0.1:
        uplift_factor = 0.1
    if uplift_factor > 3.0:
        uplift_factor = 3.0

    bucket_index: Dict[Tuple[int, bool], BaselineBucket] = {}
    for b in baseline.buckets:
        key = (int(b.hour_of_day), bool(b.is_weekend))
        bucket_index[key] = b

    def _get_baseline_for(ts: datetime) -> float:
        hour = ts.hour
        is_weekend_flag = ts.weekday() >= 5

        b = bucket_index.get((hour, is_weekend_flag))
        if b is None:
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
        "baseline_total_history_days": baseline.total_history_days,
        "baseline_is_warming_up": baseline.is_warming_up,
        "baseline_confidence_level": baseline.confidence_level
        or ("low" if baseline.is_warming_up else "normal"),
    }


# ========= Legacy-friendly AnalyticsService shim (for tests) =========


class AnalyticsService:
    """
    Backwards-compatibility shim used only by legacy unit tests.

    The production API uses the module-level functions above directly
    (compute_site_insights, compute_site_forecast_stub, etc.).
    This class stays deliberately DB-free so that tests can use a DummySession.
    """

    def __init__(self, db: Any):
        self.db = db

    def compute_kpis(
        self,
        site_id: Any,
        window_days: Optional[int] = None,
        window_hours: Optional[int] = None,
        values: Optional[List[float]] = None,
        as_of: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        if window_hours is None and window_days is not None:
            try:
                window_hours = int(window_days) * 24
            except Exception:
                window_hours = None

        if not values:
            total = 0.0
            avg = 0.0
            min_v = 0.0
            max_v = 0.0
        else:
            vals = [float(v) for v in values]
            total = float(sum(vals))
            avg = total / len(vals)
            min_v = float(min(vals))
            max_v = float(max(vals))

        if window_hours is not None and window_hours > 0:
            avg_power_kw = total / float(window_hours)
        else:
            avg_power_kw = 0.0

        peak_kw = max_v

        if peak_kw > 0:
            load_factor = avg_power_kw / peak_kw
        else:
            load_factor = 0.0

        return {
            "site_id": site_id,
            "window_days": window_days,
            "window_hours": window_hours,
            "energy_kwh": total,
            "total_kwh": total,
            "avg_kwh": avg,
            "min_kwh": min_v,
            "max_kwh": max_v,
            "avg_power_kw": avg_power_kw,
            "peak_kw": peak_kw,
            "load_factor": load_factor,
        }

    def benchmark_against_industry(
        self,
        metric_name: str,
        metric_value: float,
    ) -> Dict[str, Any]:
        industry_baselines = {
            "manufacturing_energy_intensity": 1000.0,
        }
        baseline = float(industry_baselines.get(metric_name, metric_value))

        if baseline == 0:
            diff_pct = 0.0
        else:
            diff_pct = (metric_value - baseline) / baseline * 100.0

        flagged = diff_pct > 5.0
        if flagged:
            recommendation = "Above industry baseline – investigate major loads and schedules."
        else:
            recommendation = "Within industry range – monitor periodically."

        return {
            "metric": metric_name,
            "value": float(metric_value),
            "industry_baseline": baseline,
            "difference_pct": diff_pct,
            "is_above_industry": metric_value > baseline,
            "flagged": flagged,
            "recommendation": recommendation,
        }

    def detect_anomalies(
        self,
        values: List[float],
        *,
        z_threshold: float = 2.0,
    ) -> Dict[str, Any]:
        if not values:
            return {
                "values": [],
                "mean": None,
                "std": None,
                "z_threshold": z_threshold,
                "anomalies": [],
                "anomaly_indices": [],
            }

        vals = [float(v) for v in values]
        mu = mean(vals)
        sigma = pstdev(vals) if len(vals) > 1 else 0.0

        anomalies: List[Dict[str, Any]] = []
        if sigma > 0:
            for idx, v in enumerate(vals):
                z = (v - mu) / sigma
                if abs(z) >= z_threshold:
                    anomalies.append({"index": idx, "value": v, "z_score": z})

        anomaly_indices = [a["index"] for a in anomalies]

        return {
            "values": vals,
            "mean": mu,
            "std": sigma,
            "z_threshold": z_threshold,
            "anomalies": anomalies,
            "anomaly_indices": anomaly_indices,
        }
