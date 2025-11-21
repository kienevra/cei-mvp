# backend/app/services/analytics.py
"""
Analytics service for CEI (Carbon Efficiency Intelligence).

This module provides core analytics functionality for processing and analyzing
energy metrics, plus lightweight site-level insights.

Features:
- KPI computation (energy, avg power, peak, load factor)
- Industry-style benchmarking
- Simple anomaly detection (z-score, optional IsolationForest)
- Site-level efficiency insights based on timeseries patterns
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, TypedDict, Literal

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import TimeseriesRecord, Metric, Sensor

logger = logging.getLogger("cei")

# Optional sklearn import for advanced anomaly detection
try:
    from sklearn.ensemble import IsolationForest  # type: ignore

    SKLEARN_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    SKLEARN_AVAILABLE = False


# === Typed results ===


class KPIResult(TypedDict):
    energy_kwh: float
    avg_power_kw: float
    peak_kw: float
    load_factor: float | None
    window_hours: float
    window_start: str
    window_end: str


class BenchmarkResult(TypedDict):
    metric_name: str
    value: float
    benchmark: float | None
    percent_of_benchmark: float | None
    flagged: bool
    recommendation: str


class AnomalyResult(TypedDict):
    method: str | None
    anomaly_indices: List[int]
    anomalies: List[float]


class Insight(TypedDict):
    id: str
    severity: Literal["info", "warning", "critical"]
    title: str
    message: str


class SiteInsightsResult(TypedDict):
    site_id: str
    window_days: int
    insights: List[Insight]


# === Benchmarks (stubbed for now) ===


def _load_benchmarks() -> Dict[str, float]:
    # Stubbed constants – later we can load from config/DB
    return {
        "manufacturing_energy_intensity": 1000.0,
        "avg_power_kw_per_m2": 0.02,
    }


BENCHMARKS: Dict[str, float] = _load_benchmarks()


# === KPI / energy metrics ===


def energy_metrics_for_window(
    db: Session, site_id: int, window_days: int = 30
) -> KPIResult:
    """
    Calculate energy metrics for a given time window from Metric/Sensor.

    This assumes:
    - Metric.value ~ kW
    - energy_kwh ≈ avg_power_kw * window_hours
    """
    end_ts = datetime.utcnow()
    start_ts = end_ts - timedelta(days=window_days)

    # Get all sensor IDs for the site
    sensor_ids_subq = (
        select(Sensor.id)
        .where(Sensor.site_id == site_id)
        .scalar_subquery()
    )

    stmt_avg = select(func.avg(Metric.value)).where(
        Metric.sensor_id.in_(sensor_ids_subq),
        Metric.ts >= start_ts,
        Metric.ts <= end_ts,
    )
    stmt_max = select(func.max(Metric.value)).where(
        Metric.sensor_id.in_(sensor_ids_subq),
        Metric.ts >= start_ts,
        Metric.ts <= end_ts,
    )

    try:
        avg_res = db.execute(stmt_avg).scalar()
        max_res = db.execute(stmt_max).scalar()
    except SQLAlchemyError as e:
        logger.error("Database error in energy_metrics_for_window: %s", e)
        raise

    avg_power_kw = float(avg_res) if avg_res is not None else 0.0
    peak_kw = float(max_res) if max_res is not None else 0.0
    window_hours = float(window_days) * 24.0
    energy_kwh = avg_power_kw * window_hours  # approximation

    load_factor = (avg_power_kw / peak_kw) if peak_kw and peak_kw > 0 else None

    return {
        "energy_kwh": round(energy_kwh, 3),
        "avg_power_kw": round(avg_power_kw, 3),
        "peak_kw": round(peak_kw, 3),
        "load_factor": round(load_factor, 3) if load_factor is not None else None,
        "window_hours": round(window_hours, 2),
        "window_start": start_ts.isoformat(),
        "window_end": end_ts.isoformat(),
    }


# === Benchmarking ===


def benchmark_against_industry(
    metric_name: str,
    value: float,
    threshold: float = 1.15,
) -> BenchmarkResult:
    """
    Compare `value` to a benchmark for `metric_name`.

    - flagged if value > threshold * benchmark (default 115% of benchmark)
    """
    if not isinstance(value, (int, float)) or value < 0:
        raise ValueError(f"Invalid metric value: {value}")
    if not isinstance(threshold, (int, float)) or threshold <= 1:
        raise ValueError(f"Invalid threshold: {threshold}. Must be > 1")

    benchmark = BENCHMARKS.get(metric_name)
    if benchmark is None:
        logger.warning("No benchmark found for metric: %s", metric_name)
        return {
            "metric_name": metric_name,
            "value": float(value),
            "benchmark": None,
            "percent_of_benchmark": None,
            "flagged": False,
            "recommendation": (
                "No industry benchmark available. Consider collecting "
                "historical data to establish a baseline."
            ),
        }

    percent = (value / benchmark) * 100.0 if benchmark else None
    flagged = value > (threshold * benchmark) if benchmark else False

    if flagged:
        percent_over = ((value / benchmark) - 1) * 100
        if percent_over > 50:
            recommendation = (
                f"Critical: {percent_over:.1f}% above benchmark. "
                "Immediate investigation recommended (equipment malfunctions, "
                "process inefficiencies, calibration issues)."
            )
        else:
            recommendation = (
                f"Warning: {percent_over:.1f}% above benchmark. "
                "Target improvement via maintenance, operating procedure review, "
                "and a focused energy audit."
            )
    else:
        recommendation = "Performance within expected range. Continue monitoring for trends."

    logger.info(
        "Benchmark comparison for %s: %.2f vs benchmark %.2f (%.1f%%)",
        metric_name,
        value,
        benchmark,
        percent or 0.0,
    )

    return {
        "metric_name": metric_name,
        "value": round(value, 3),
        "benchmark": round(benchmark, 3),
        "percent_of_benchmark": round(percent, 2) if percent is not None else None,
        "flagged": flagged,
        "recommendation": recommendation,
    }


# === Anomaly detection ===


def detect_anomalies(
    series: Sequence[float],
    method: str = "zscore",
    z_thresh: float = 3.0,
    contamination: float = 0.1,
) -> AnomalyResult:
    """
    Basic anomaly detection.

    - z-score: simple statistical outlier detection
    - isolation_forest: optional, if scikit-learn is installed
    - both: combine results from both methods
    """
    if not series:
        raise ValueError("Empty input series")
    if z_thresh <= 0:
        raise ValueError(f"Invalid z-score threshold: {z_thresh}")
    if not (0 < contamination < 0.5):
        raise ValueError(f"Invalid contamination rate: {contamination}")

    arr = list(float(x) for x in series)
    result: AnomalyResult = {
        "method": method,
        "anomaly_indices": [],
        "anomalies": [],
    }

    method_lower = method.lower()

    # --- z-score path ---
    if method_lower in ("zscore", "both"):
        n = len(arr)
        mean = sum(arr) / n
        var = sum((x - mean) ** 2 for x in arr) / n
        sd = math.sqrt(var)
        if sd > 0:
            for idx, v in enumerate(arr):
                z = (v - mean) / sd
                if abs(z) >= z_thresh:
                    result["anomaly_indices"].append(idx)
                    result["anomalies"].append(v)

    # --- IsolationForest path ---
    if method_lower in ("isolation_forest", "both") and SKLEARN_AVAILABLE:
        try:
            import numpy as np  # type: ignore

            np_arr = np.array(arr).reshape(-1, 1)
            clf = IsolationForest(contamination=contamination, random_state=42)
            preds = clf.fit_predict(np_arr)
            for idx, p in enumerate(preds):
                if p == -1:
                    result["anomaly_indices"].append(idx)
                    result["anomalies"].append(arr[idx])
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("IsolationForest failed, falling back on z-score only: %s", e)

    # De-duplicate
    if result["anomaly_indices"]:
        # preserve order
        seen = set()
        indices_dedup: List[int] = []
        for i in result["anomaly_indices"]:
            if i not in seen:
                seen.add(i)
                indices_dedup.append(i)
        result["anomaly_indices"] = indices_dedup
        result["anomalies"] = [arr[i] for i in indices_dedup]

    logger.info(
        "Anomaly detection (%s) found %d anomalies in series of length %d",
        method,
        len(result["anomaly_indices"]),
        len(series),
    )
    return result


# === Site-level insights (Phase 1 rule-based) ===


def _float_or_zero(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def compute_site_insights(
    db: Session,
    site_key: str,
    window_days: int = 7,
) -> SiteInsightsResult:
    """
    Phase 1: lightweight, rule-based analytics for a single site.

    - Looks at TimeseriesRecord for this site_key (e.g. "site-1") in the last N days.
    - Computes:
        * Night vs day consumption share
        * Last 24h vs previous 24h delta
    - Returns a list of insights with severity + human-readable messages.
    """
    now = datetime.utcnow()
    window_start = now - timedelta(days=window_days)

    records: List[TimeseriesRecord] = (
        db.query(TimeseriesRecord)
        .filter(
            TimeseriesRecord.site_id == site_key,
            TimeseriesRecord.timestamp >= window_start,
        )
        .order_by(TimeseriesRecord.timestamp.asc())
        .all()
    )

    if not records:
        return {
            "site_id": site_key,
            "window_days": window_days,
            "insights": [
                {
                    "id": "no-data",
                    "severity": "info",
                    "title": "No recent data",
                    "message": (
                        f"No timeseries records found for {site_key} in the last "
                        f"{window_days} days. Upload fresh CSV data or connect a feed "
                        "to start seeing analytics for this site."
                    ),
                }
            ],
        }

    values = [_float_or_zero(r.value) for r in records]
    total_kwh = sum(values)
    total_nonzero = total_kwh if total_kwh > 0 else 1.0

    # Day vs night split (07:00–19:00 considered "day")
    day_values: List[float] = []
    night_values: List[float] = []
    for r in records:
        v = _float_or_zero(r.value)
        hour = r.timestamp.hour
        if 7 <= hour < 19:
            day_values.append(v)
        else:
            night_values.append(v)

    day_total = sum(day_values)
    night_total = sum(night_values)
    night_share = night_total / total_nonzero

    insights: List[Insight] = []

    # Rule 1 – high night baseload
    if night_total > 0 and night_share >= 0.4:
        sev: Literal["info", "warning", "critical"] = "warning"
        if night_share >= 0.6:
            sev = "critical"

        insights.append(
            {
                "id": "night-baseload",
                "severity": sev,
                "title": "High night baseload",
                "message": (
                    f"Night-time consumption accounts for ~{night_share * 100:.0f}% "
                    f"of this site's energy in the last {window_days} days. "
                    "This usually points to compressors, HVAC, or lines left "
                    "running outside of production hours. Start by mapping what "
                    "should be off between 19:00 and 07:00."
                ),
            }
        )

    # Rule 2 – last 24h vs previous 24h
    cutoff_24 = now - timedelta(hours=24)
    prev_24_start = now - timedelta(hours=48)

    last_24_vals = [
        _float_or_zero(r.value) for r in records if r.timestamp >= cutoff_24
    ]
    prev_24_vals = [
        _float_or_zero(r.value)
        for r in records
        if prev_24_start <= r.timestamp < cutoff_24
    ]

    if last_24_vals and prev_24_vals:
        last_24_total = sum(last_24_vals)
        prev_24_total = sum(prev_24_vals)
        if prev_24_total > 0:
            delta = (last_24_total - prev_24_total) / prev_24_total
            if delta >= 0.3:
                insights.append(
                    {
                        "id": "last24-spike",
                        "severity": "critical",
                        "title": "Sharp increase in last 24 hours",
                        "message": (
                            "Energy in the last 24 hours is roughly "
                            f"{delta * 100:+.0f}% versus the previous 24 hours. "
                            "Check for abnormal operating conditions, extended shifts, "
                            "or equipment left running."
                        ),
                    }
                )
            elif delta >= 0.15:
                insights.append(
                    {
                        "id": "last24-rise",
                        "severity": "warning",
                        "title": "Notable rise in recent consumption",
                        "message": (
                            "Energy in the last 24 hours is about "
                            f"{delta * 100:+.0f}% higher than the previous 24 hours. "
                            "If this isn't explained by production changes, this is a "
                            "good candidate for a focused walk-through."
                        ),
                    }
                )

    # Fallback – always give at least one directional insight
    if not insights and total_kwh > 0:
        insights.append(
            {
                "id": "baseline-check",
                "severity": "info",
                "title": "Establish a baseline",
                "message": (
                    f"CEI sees {total_kwh:.1f} kWh for this site in the last "
                    f"{window_days} days. Use this as a baseline, then compare "
                    "before/after when you implement specific actions "
                    "(e.g. night shutdown checklist, compressed air leak hunt)."
                ),
            }
        )

    return {
        "site_id": site_key,
        "window_days": window_days,
        "insights": insights,
    }
