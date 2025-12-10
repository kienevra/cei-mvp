from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user
from app.db import models  # kept import to avoid accidental regressions
from app.services.analytics import (
    compute_site_insights,
    compute_baseline_profile,
    compute_site_forecast_stub,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ========= Schemas =========


class HourBandOut(BaseModel):
  hour: int
  actual_kwh: float
  expected_kwh: float
  delta_kwh: float
  delta_pct: float
  z_score: float
  band: str


class BaselineBucketOut(BaseModel):
  hour_of_day: int  # 0–23
  is_weekend: bool  # True = Saturday/Sunday
  mean_kwh: float
  std_kwh: float  # 0 if only one point in bucket


class BaselineProfileOut(BaseModel):
  """
  Statistical baseline profile for a site (and optional meter_id).

  This is purely additive: existing consumers of
  /analytics/sites/{site_id}/insights can ignore this object; new
  consumers can lean on it for richer rules/UI.
  """

  site_id: Optional[str]
  meter_id: Optional[str]
  lookback_days: int

  global_mean_kwh: Optional[float] = None
  global_p50_kwh: Optional[float] = None
  global_p90_kwh: Optional[float] = None

  n_points: int

  # Warm-up / confidence metadata
  total_history_days: Optional[int] = None
  is_warming_up: Optional[bool] = None
  confidence_level: Optional[str] = None

  buckets: List[BaselineBucketOut]


class SiteInsightsOut(BaseModel):
  """
  End-to-end insight payload for a single site.

  This preserves the existing deterministic/statistical fields and adds
  an optional `baseline_profile` section derived from compute_baseline_profile().
  """

  site_id: str
  window_hours: int
  baseline_lookback_days: int

  total_actual_kwh: float
  total_expected_kwh: float
  deviation_pct: float

  critical_hours: int
  elevated_hours: int
  below_baseline_hours: int

  hours: List[HourBandOut]
  generated_at: str

  # Warm-up / confidence metadata for the site's baseline
  total_history_days: Optional[int] = None
  is_baseline_warming_up: Optional[bool] = None
  confidence_level: Optional[str] = None

  # Richer statistical baseline (optional)
  baseline_profile: Optional[BaselineProfileOut] = None


class ForecastPointOut(BaseModel):
  ts: str
  expected_kwh: float
  lower_kwh: Optional[float] = None
  upper_kwh: Optional[float] = None
  basis: Optional[str] = None  # e.g. "stub_baseline_v1", "arima_v2" later


class SiteForecastOut(BaseModel):
  site_id: str
  history_window_hours: int
  horizon_hours: int
  baseline_lookback_days: int
  generated_at: str
  method: str  # e.g. "stub_baseline_v1"

  # Warm-up metadata for the baseline underpinning this forecast
  baseline_total_history_days: Optional[int] = None
  baseline_is_warming_up: Optional[bool] = None
  baseline_confidence_level: Optional[str] = None

  points: List[ForecastPointOut]


class SiteKpiOut(BaseModel):
  site_id: str
  now_utc: datetime

  last_24h_kwh: float
  baseline_24h_kwh: Optional[float] = None
  deviation_pct_24h: Optional[float] = None

  last_7d_kwh: float
  prev_7d_kwh: Optional[float] = None
  deviation_pct_7d: Optional[float] = None

  # Warm-up / confidence metadata for the baseline used by the KPI
  total_history_days: Optional[int] = None
  is_baseline_warming_up: Optional[bool] = None
  confidence_level: Optional[str] = None


# ========= Helpers =========


def _build_empty_insights_payload(
  *,
  site_id: str,
  window_hours: int,
  lookback_days: int,
  baseline_profile: Optional[BaselineProfileOut] = None,
) -> SiteInsightsOut:
  """
  When there is no usable insights data yet (no points for this site
  in the requested window), we return a neutral "warming up" payload
  instead of a 404 to keep the frontend contract stable.
  """

  now_iso = datetime.now(timezone.utc).isoformat()

  # If we do have a baseline_profile (e.g. from long-term history but
  # no recent points), keep it; otherwise baseline_profile stays None.
  total_history_days = (
    baseline_profile.total_history_days
    if baseline_profile and baseline_profile.total_history_days is not None
    else None
  )

  return SiteInsightsOut(
    site_id=site_id,
    window_hours=window_hours,
    baseline_lookback_days=lookback_days,
    total_actual_kwh=0.0,
    total_expected_kwh=0.0,
    deviation_pct=0.0,
    critical_hours=0,
    elevated_hours=0,
    below_baseline_hours=0,
    hours=[],
    generated_at=now_iso,
    total_history_days=total_history_days,
    is_baseline_warming_up=True,
    confidence_level="warming_up",
    baseline_profile=baseline_profile,
  )


def _build_empty_kpi_payload(
  *,
  site_id: str,
  lookback_days: int,
) -> SiteKpiOut:
  """
  Neutral KPI when there is no recent data. Keeps response_model shape
  stable and lets the UI render a "warming up" state instead of hard
  failing on 404.
  """
  now = datetime.now(timezone.utc)

  return SiteKpiOut(
    site_id=site_id,
    now_utc=now,
    last_24h_kwh=0.0,
    baseline_24h_kwh=None,
    deviation_pct_24h=None,
    last_7d_kwh=0.0,
    prev_7d_kwh=None,
    deviation_pct_7d=None,
    total_history_days=None,
    is_baseline_warming_up=True,
    confidence_level="warming_up",
  )


# ========= Routes =========


@router.get(
  "/sites/{site_id}/insights",
  response_model=SiteInsightsOut,
  status_code=status.HTTP_200_OK,
)
def get_site_insights(
  site_id: str,
  window_hours: int = Query(24, ge=1, le=24 * 7),
  lookback_days: int = Query(30, ge=7, le=365),
  db: Session = Depends(get_db),
  user=Depends(get_current_user),
) -> SiteInsightsOut:
  """
  Return a combined deterministic + statistical insight payload for a site.

  - deterministic/statistical (existing behaviour):
      * call compute_site_insights(...) to get:
        total_actual, total_expected, deviation_pct, per-hour bands, etc.

  - statistical baseline (additive):
      * call compute_baseline_profile(...) over the same lookback window
        and expose global_mean/p50/p90 plus per-bucket stats.

  If there is no usable data yet, we return a neutral "warming up" payload
  (200) instead of 404, so the frontend can show a graceful empty state.
  """

  # --- Statistical baseline profile (can exist even if no recent data) ---
  baseline = compute_baseline_profile(
    db=db,
    site_id=site_id,
    meter_id=None,  # per-meter later
    lookback_days=lookback_days,
  )

  baseline_profile_out: Optional[BaselineProfileOut] = None
  if baseline is not None:
    bucket_outs: List[BaselineBucketOut] = [
      BaselineBucketOut(
        hour_of_day=b.hour_of_day,
        is_weekend=b.is_weekend,
        mean_kwh=b.mean_kwh,
        std_kwh=b.std_kwh,
      )
      for b in baseline.buckets
    ]

    baseline_profile_out = BaselineProfileOut(
      site_id=baseline.site_id,
      meter_id=baseline.meter_id,
      lookback_days=baseline.lookback_days,
      global_mean_kwh=baseline.global_mean,
      global_p50_kwh=baseline.global_p50,
      global_p90_kwh=baseline.global_p90,
      n_points=baseline.n_points,
      total_history_days=baseline.total_history_days,
      is_warming_up=baseline.is_warming_up,
      confidence_level=baseline.confidence_level,
      buckets=bucket_outs,
    )

  # --- Deterministic/statistical insights ---
  try:
    insights: Optional[Dict[str, Any]] = compute_site_insights(
      db=db,
      site_id=site_id,
      window_hours=window_hours,
      lookback_days=lookback_days,
    )
  except HTTPException as exc:
    # If the underlying engine uses 404 for "no data yet", convert to a
    # neutral payload. Any other status is propagated.
    if exc.status_code == status.HTTP_404_NOT_FOUND:
      return _build_empty_insights_payload(
        site_id=site_id,
        window_hours=window_hours,
        lookback_days=lookback_days,
        baseline_profile=baseline_profile_out,
      )
    raise

  if not insights:
    # No insights object returned → treat as "warming up"
    return _build_empty_insights_payload(
      site_id=site_id,
      window_hours=window_hours,
      lookback_days=lookback_days,
      baseline_profile=baseline_profile_out,
    )

  # Validate and map hours list into typed HourBandOut objects
  raw_hours = insights.get("hours", []) or []
  hours_out: List[HourBandOut] = []
  for h in raw_hours:
    hours_out.append(
      HourBandOut(
        hour=int(h.get("hour", 0)),
        actual_kwh=float(h.get("actual_kwh", 0.0)),
        expected_kwh=float(h.get("expected_kwh", 0.0)),
        delta_kwh=float(h.get("delta_kwh", 0.0)),
        delta_pct=float(h.get("delta_pct", 0.0)),
        z_score=float(h.get("z_score", 0.0)),
        band=str(h.get("band", "normal")),
      )
    )

  # Warm-up / confidence metadata from insights engine
  raw_total_history_days = insights.get("total_history_days")
  total_history_days: Optional[int] = (
    int(raw_total_history_days) if raw_total_history_days is not None else None
  )
  is_baseline_warming_up: Optional[bool] = insights.get(
    "is_baseline_warming_up"
  )
  confidence_level: Optional[str] = insights.get("confidence_level")

  return SiteInsightsOut(
    site_id=str(insights.get("site_id", site_id)),
    window_hours=int(insights.get("window_hours", window_hours)),
    baseline_lookback_days=int(
      insights.get("baseline_lookback_days", lookback_days)
    ),
    total_actual_kwh=float(insights.get("total_actual_kwh", 0.0)),
    total_expected_kwh=float(insights.get("total_expected_kwh", 0.0)),
    deviation_pct=float(insights.get("deviation_pct", 0.0)),
    critical_hours=int(insights.get("critical_hours", 0)),
    elevated_hours=int(insights.get("elevated_hours", 0)),
    below_baseline_hours=int(insights.get("below_baseline_hours", 0)),
    hours=hours_out,
    generated_at=str(insights.get("generated_at", "")),
    total_history_days=total_history_days,
    is_baseline_warming_up=is_baseline_warming_up,
    confidence_level=confidence_level,
    baseline_profile=baseline_profile_out,
  )


@router.get(
  "/sites/{site_id}/kpi",
  response_model=SiteKpiOut,
  status_code=status.HTTP_200_OK,
)
def get_site_kpi(
  site_id: str,
  lookback_days: int = Query(
    30,
    ge=7,
    le=365,
    description="Lookback window in days used to build the statistical baseline for 24h comparison.",
  ),
  db: Session = Depends(get_db),
  user=Depends(get_current_user),
) -> SiteKpiOut:
  """
  Site-level KPI snapshot using the existing analytics engine:

    - Last 24h vs baseline (expected 24h) via compute_site_insights(window_hours=24)
    - Last 7 days total kWh via compute_site_insights(window_hours=168)

  If there is no usable data yet, we return a neutral "warming up" KPI
  instead of a 404, to keep the frontend contract and KPIs stable.
  """

  now = datetime.now(timezone.utc)

  # --- 24h: actual vs expected (baseline) ---
  try:
    insights_24h: Optional[Dict[str, Any]] = compute_site_insights(
      db=db,
      site_id=site_id,
      window_hours=24,
      lookback_days=lookback_days,
    )
  except HTTPException as exc:
    if exc.status_code == status.HTTP_404_NOT_FOUND:
      return _build_empty_kpi_payload(site_id=site_id, lookback_days=lookback_days)
    raise

  if not insights_24h:
    return _build_empty_kpi_payload(site_id=site_id, lookback_days=lookback_days)

  last_24h_kwh = float(insights_24h.get("total_actual_kwh", 0.0))

  baseline_expected = insights_24h.get("total_expected_kwh")
  baseline_24h_kwh: Optional[float] = (
    float(baseline_expected) if baseline_expected is not None else None
  )

  deviation_pct_24h: Optional[float] = None
  if baseline_24h_kwh is not None and baseline_24h_kwh != 0.0:
    deviation_pct_24h = (
      (last_24h_kwh - baseline_24h_kwh) / baseline_24h_kwh * 100.0
    )

  # Warm-up / confidence metadata for the baseline underpinning this KPI
  raw_total_history_days = insights_24h.get("total_history_days")
  total_history_days: Optional[int] = (
    int(raw_total_history_days) if raw_total_history_days is not None else None
  )
  is_baseline_warming_up: Optional[bool] = insights_24h.get(
    "is_baseline_warming_up"
  )
  confidence_level: Optional[str] = insights_24h.get("confidence_level")

  # --- 7d: total actual over last 168h ---
  try:
    insights_7d: Optional[Dict[str, Any]] = compute_site_insights(
      db=db,
      site_id=site_id,
      window_hours=24 * 7,
      lookback_days=lookback_days,
    )
  except HTTPException as exc:
    if exc.status_code == status.HTTP_404_NOT_FOUND:
      insights_7d = None
    else:
      raise

  if insights_7d:
    last_7d_kwh = float(insights_7d.get("total_actual_kwh", 0.0))
  else:
    last_7d_kwh = 0.0

  # Not implemented yet: previous 7d comparison (keep neutral)
  prev_7d_kwh: Optional[float] = None
  deviation_pct_7d: Optional[float] = None

  return SiteKpiOut(
    site_id=site_id,
    now_utc=now,
    last_24h_kwh=last_24h_kwh,
    baseline_24h_kwh=baseline_24h_kwh,
    deviation_pct_24h=deviation_pct_24h,
    last_7d_kwh=last_7d_kwh,
    prev_7d_kwh=prev_7d_kwh,
    deviation_pct_7d=deviation_pct_7d,
    total_history_days=total_history_days,
    is_baseline_warming_up=is_baseline_warming_up,
    confidence_level=confidence_level,
  )


@router.get(
  "/sites/{site_id}/forecast",
  response_model=SiteForecastOut,
  status_code=status.HTTP_200_OK,
)
def get_site_forecast(
  site_id: str,
  history_window_hours: int = Query(
    24,
    ge=1,
    le=24 * 7,
    description="History window in hours used to compute recent deviation vs baseline.",
  ),
  horizon_hours: int = Query(
    24,
    ge=1,
    le=24 * 7,
    description="Forecast horizon in hours.",
  ),
  lookback_days: int = Query(
    30,
    ge=7,
    le=365,
    description="Lookback window in days used to build the statistical baseline.",
  ),
  db: Session = Depends(get_db),
  user=Depends(get_current_user),
) -> SiteForecastOut:
  """
  Short-term forecast endpoint (stub implementation).

  For now:
    - Builds a statistical baseline over `lookback_days`.
    - Computes recent deviation over `history_window_hours`.
    - Projects the baseline forward `horizon_hours` with a simple uplift factor.

  The shape is stable so we can swap in a real ML model later without breaking
  the front-end or any API consumers.
  """
  forecast = compute_site_forecast_stub(
    db=db,
    site_id=site_id,
    history_window_hours=history_window_hours,
    horizon_hours=horizon_hours,
    lookback_days=lookback_days,
  )

  if not forecast:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="Not enough data to generate a forecast for this site.",
    )

  raw_points = forecast.get("points", []) or []
  points_out: List[ForecastPointOut] = []
  for p in raw_points:
    points_out.append(
      ForecastPointOut(
        ts=str(p.get("ts")),
        expected_kwh=float(p.get("expected_kwh", 0.0)),
        lower_kwh=(
          float(p["lower_kwh"])
          if "lower_kwh" in p and p["lower_kwh"] is not None
          else None
        ),
        upper_kwh=(
          float(p["upper_kwh"])
          if "upper_kwh" in p and p["upper_kwh"] is not None
          else None
        ),
        basis=p.get("basis"),
      )
    )

  return SiteForecastOut(
    site_id=str(forecast.get("site_id", site_id)),
    history_window_hours=int(
      forecast.get("history_window_hours", history_window_hours)
    ),
    horizon_hours=int(forecast.get("horizon_hours", horizon_hours)),
    baseline_lookback_days=int(
      forecast.get("baseline_lookback_days", lookback_days)
    ),
    generated_at=str(forecast.get("generated_at", "")),
    method=str(forecast.get("method", "stub_baseline_v1")),
    baseline_total_history_days=forecast.get("baseline_total_history_days"),
    baseline_is_warming_up=forecast.get("baseline_is_warming_up"),
    baseline_confidence_level=forecast.get("baseline_confidence_level"),
    points=points_out,
  )
