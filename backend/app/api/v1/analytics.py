# backend/app/api/v1/analytics.py
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user
from app.services.analytics import (
    compute_site_insights,
    compute_baseline_profile,
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
    hour_of_day: int       # 0–23
    is_weekend: bool       # True = Saturday/Sunday
    mean_kwh: float
    std_kwh: float         # 0 if only one point in bucket


class BaselineProfileOut(BaseModel):
    """
    Statistical baseline profile for a site (and optional meter_id).

    This is purely additive: existing consumers of /analytics/sites/{site_id}/insights
    can ignore this object; new consumers can lean on it for richer rules/UI.
    """

    site_id: Optional[str]
    meter_id: Optional[str]
    lookback_days: int

    global_mean_kwh: Optional[float] = None
    global_p50_kwh: Optional[float] = None
    global_p90_kwh: Optional[float] = None

    n_points: int

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

    # New: richer statistical baseline (optional)
    baseline_profile: Optional[BaselineProfileOut] = None


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

    - statistical baseline (new, additive):
        * call compute_baseline_profile(...) over the same lookback window
          and expose global_mean/p50/p90 plus per-bucket (hour x weekend/weekday) stats.

    Existing consumers of this endpoint still get the same top-level fields;
    the new `baseline_profile` field is optional and can be ignored if not needed.
    """

    # --- Deterministic/statistical insights (existing behaviour) ---
    insights: Optional[Dict[str, Any]] = compute_site_insights(
        db=db,
        site_id=site_id,
        window_hours=window_hours,
        lookback_days=lookback_days,
    )
    if not insights:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No insights available for this site in the requested window.",
        )

    # Validate and map hours list into typed HourBandOut objects
    raw_hours = insights.get("hours", []) or []
    hours_out: List[HourBandOut] = []
    for h in raw_hours:
        # Extremely defensive: default missing keys to zero/normal to
        # avoid breaking if the underlying engine evolves.
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

    # --- Statistical baseline profile (new, additive) ---
    baseline = compute_baseline_profile(
        db=db,
        site_id=site_id,
        meter_id=None,          # we can add per-meter later
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
            buckets=bucket_outs,
        )

    # --- Assemble response, preserving existing keys ---
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
        baseline_profile=baseline_profile_out,
    )
