# backend/app/services/forecast.py
"""
Prophet-based forecasting engine for CEI.

Replaces compute_site_forecast_stub() with a real time-series model.

Design decisions:
  - Uses Facebook Prophet with daily + weekly seasonality
  - Falls back to stub_baseline_v1 if Prophet fails or insufficient data
  - Minimum data requirement: 48 hourly points (2 days)
  - Caches nothing — stateless per request (acceptable at current scale)
  - Returns same dict shape as compute_site_forecast_stub() for drop-in replacement
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import TimeseriesRecord
from app.services.analytics import (
    compute_baseline_profile,
    compute_site_insights,
    _utcnow,
    _as_utc,
)

# ── Forecast cache (in-memory, TTL = 1 hour) ─────────────────────────────────
# Avoids re-fitting Prophet on every dashboard load.
# Cache key: (site_id, horizon_hours, lookback_days, org_id)
# ML model still trains on full history — results are just reused for 1 hour.

import time
from typing import Tuple

_forecast_cache: dict = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour


def _cache_key(site_id, horizon_hours, lookback_days, org_id) -> Tuple:
    return (site_id, horizon_hours, lookback_days, org_id)


def _cache_get(key: Tuple):
    entry = _forecast_cache.get(key)
    if entry is None:
        return None
    result, expires_at = entry
    if time.time() > expires_at:
        del _forecast_cache[key]
        return None
    return result


def _cache_set(key: Tuple, result):
    _forecast_cache[key] = (result, time.time() + _CACHE_TTL_SECONDS)

logger = logging.getLogger("cei")

# Minimum number of hourly data points required to run Prophet
PROPHET_MIN_POINTS = 48  # 2 days of hourly data


def _load_site_series(
    db: Session,
    site_id: str,
    lookback_days: int,
    now: datetime,
    organization_id: Optional[int] = None,
    allowed_site_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Load hourly timeseries as list of {ds: datetime, y: float}."""
    start = now - timedelta(days=lookback_days)

    q = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id == site_id)
        .filter(TimeseriesRecord.timestamp >= start)
        .filter(TimeseriesRecord.timestamp <= now)
    )
    if organization_id is not None:
        q = q.filter(TimeseriesRecord.organization_id == organization_id)
    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    rows = q.order_by(TimeseriesRecord.timestamp).all()

    series = []
    for row in rows:
        if row.timestamp is None:
            continue
        try:
            val = float(row.value)
        except Exception:
            continue
        ts = _as_utc(row.timestamp)
        if ts is None:
            continue
        # Prophet requires timezone-naive timestamps
        ts_naive = ts.replace(tzinfo=None)
        series.append({"ds": ts_naive, "y": val})

    return series


def _aggregate_to_hourly(series: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Aggregate sub-hourly data to hourly means.
    If data is already hourly (one point per hour) this is a no-op.
    """
    from collections import defaultdict

    buckets: Dict[datetime, List[float]] = defaultdict(list)
    for point in series:
        ts = point["ds"]
        hour_key = ts.replace(minute=0, second=0, microsecond=0)
        buckets[hour_key].append(point["y"])

    result = []
    for hour_key in sorted(buckets.keys()):
        vals = buckets[hour_key]
        result.append({"ds": hour_key, "y": sum(vals) / len(vals)})

    return result


def compute_site_forecast_prophet(
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
    Generate a Prophet-based forecast for a site.

    Returns the same dict shape as compute_site_forecast_stub() for
    drop-in compatibility with the existing API endpoint.

    Falls back to stub_baseline_v1 if:
      - Prophet is not installed
      - Insufficient data (< PROPHET_MIN_POINTS hourly points)
      - Prophet raises any exception during fit/predict
    """
    now = as_of or _utcnow()
    now_utc = _as_utc(now)

    # ── Check cache ───────────────────────────────────────────────────────────
    _key = _cache_key(site_id, horizon_hours, lookback_days, organization_id)
    cached = _cache_get(_key)
    if cached is not None:
        logger.info("Prophet: cache hit for site %s", site_id)
        return cached

    # ── Load historical data ──────────────────────────────────────────────────
    raw_series = _load_site_series(
        db=db,
        site_id=site_id,
        lookback_days=lookback_days,
        now=now,
        organization_id=organization_id,
        allowed_site_ids=allowed_site_ids,
    )

    if not raw_series:
        logger.info("Prophet: no data for site %s — falling back to stub", site_id)
        return _fallback_stub(
            db=db,
            site_id=site_id,
            history_window_hours=history_window_hours,
            horizon_hours=horizon_hours,
            lookback_days=lookback_days,
            now=now,
            allowed_site_ids=allowed_site_ids,
            organization_id=organization_id,
        )

    hourly = _aggregate_to_hourly(raw_series)

    if len(hourly) < PROPHET_MIN_POINTS:
        logger.info(
            "Prophet: only %d hourly points for site %s (need %d) — falling back to stub",
            len(hourly), site_id, PROPHET_MIN_POINTS,
        )
        return _fallback_stub(
            db=db,
            site_id=site_id,
            history_window_hours=history_window_hours,
            horizon_hours=horizon_hours,
            lookback_days=lookback_days,
            now=now,
            allowed_site_ids=allowed_site_ids,
            organization_id=organization_id,
        )

    # ── Fit Prophet model ─────────────────────────────────────────────────────
    try:
        import pandas as pd
        from prophet import Prophet

        df = pd.DataFrame(hourly)

        # Configure Prophet for industrial energy data:
        # - Daily seasonality: captures shift patterns (08:00–18:00 production hours)
        # - Weekly seasonality: captures weekday vs weekend differences
        # - Yearly seasonality: disabled (not enough data, and industrial patterns
        #   don't follow a clean annual curve at hourly resolution)
        # - Multiplicative seasonality: energy scales with production level,
        #   so multiplicative fits better than additive for manufacturing
        model = Prophet(
            daily_seasonality=True,
            weekly_seasonality=True,
            yearly_seasonality=False,
            seasonality_mode="multiplicative",
            interval_width=0.80,          # 80% confidence interval
            changepoint_prior_scale=0.05,  # conservative — avoids overfitting short series
        )

        # Suppress Prophet's verbose cmdstanpy output
        import logging as _logging
        _logging.getLogger("prophet").setLevel(_logging.WARNING)
        _logging.getLogger("cmdstanpy").setLevel(_logging.WARNING)

        model.fit(df)

        # ── Generate future dataframe ──────────────────────────────────────────
        # Prophet's make_future_dataframe with freq='h' includes history + future
        future = model.make_future_dataframe(
            periods=horizon_hours,
            freq="h",
            include_history=False,
        )

        forecast_df = model.predict(future)

        # ── Build output points ───────────────────────────────────────────────
        points: List[Dict[str, Any]] = []
        now_naive = now.replace(tzinfo=None) if now.tzinfo else now

        for _, row in forecast_df.iterrows():
            ts = row["ds"]
            # Only include future points
            if ts <= now_naive:
                continue

            yhat = float(row["yhat"])
            yhat_lower = float(row["yhat_lower"])
            yhat_upper = float(row["yhat_upper"])

            # Clamp negatives — energy can't be negative
            yhat = max(yhat, 0.0)
            yhat_lower = max(yhat_lower, 0.0)
            yhat_upper = max(yhat_upper, 0.0)

            # Convert back to UTC-aware ISO string
            ts_utc = ts.replace(tzinfo=timezone.utc)

            points.append({
                "ts": ts_utc.isoformat(),
                "expected_kwh": round(yhat, 3),
                "lower_kwh": round(yhat_lower, 3),
                "upper_kwh": round(yhat_upper, 3),
                "basis": "prophet_v1",
            })

            if len(points) >= horizon_hours:
                break

        if not points:
            logger.warning("Prophet produced no future points for site %s — falling back", site_id)
            return _fallback_stub(
                db=db,
                site_id=site_id,
                history_window_hours=history_window_hours,
                horizon_hours=horizon_hours,
                lookback_days=lookback_days,
                now=now,
                allowed_site_ids=allowed_site_ids,
                organization_id=organization_id,
            )

        # ── Baseline metadata ──────────────────────────────────────────────────
        baseline = compute_baseline_profile(
            db=db,
            site_id=site_id,
            lookback_days=lookback_days,
            now=now,
            allowed_site_ids=allowed_site_ids,
            organization_id=organization_id,
        )

        total_history_days = getattr(baseline, "total_history_days", None) if baseline else None
        is_warming_up = getattr(baseline, "is_warming_up", False) if baseline else False
        confidence_level = (
            getattr(baseline, "confidence_level", "normal") if baseline else "normal"
        )

        logger.info(
            "Prophet: generated %d-hour forecast for site %s using %d hourly points",
            len(points), site_id, len(hourly),
        )

        result = {
            "site_id": site_id,
            "history_window_hours": history_window_hours,
            "horizon_hours": horizon_hours,
            "baseline_lookback_days": lookback_days,
            "generated_at": now.isoformat(),
            "method": "prophet_v1",
            "n_training_points": len(hourly),
            "points": points,
            "baseline_total_history_days": total_history_days,
            "baseline_is_warming_up": is_warming_up,
            "baseline_confidence_level": confidence_level or (
                "low" if is_warming_up else "normal"
            ),
        }
        _cache_set(_key, result)
        return result

    except ImportError:
        logger.warning("Prophet not installed — falling back to stub_baseline_v1")
        return _fallback_stub(
            db=db,
            site_id=site_id,
            history_window_hours=history_window_hours,
            horizon_hours=horizon_hours,
            lookback_days=lookback_days,
            now=now,
            allowed_site_ids=allowed_site_ids,
            organization_id=organization_id,
        )

    except Exception as exc:
        logger.warning(
            "Prophet forecast failed for site %s: %s — falling back to stub",
            site_id, exc,
        )
        return _fallback_stub(
            db=db,
            site_id=site_id,
            history_window_hours=history_window_hours,
            horizon_hours=horizon_hours,
            lookback_days=lookback_days,
            now=now,
            allowed_site_ids=allowed_site_ids,
            organization_id=organization_id,
        )


def _fallback_stub(
    db: Session,
    site_id: str,
    history_window_hours: int,
    horizon_hours: int,
    lookback_days: int,
    now: datetime,
    allowed_site_ids: Optional[List[str]],
    organization_id: Optional[int],
) -> Optional[Dict[str, Any]]:
    """Thin wrapper around the original stub for fallback."""
    from app.services.analytics import compute_site_forecast_stub
    return compute_site_forecast_stub(
        db=db,
        site_id=site_id,
        history_window_hours=history_window_hours,
        horizon_hours=horizon_hours,
        lookback_days=lookback_days,
        as_of=now,
        allowed_site_ids=allowed_site_ids,
        organization_id=organization_id,
    )