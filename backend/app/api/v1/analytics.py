# backend/app/api/v1/analytics.py
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.services.analytics import compute_site_insights

router = APIRouter(prefix="/analytics", tags=["analytics"])


class HourDeviation(BaseModel):
  hour: int
  actual_kwh: float
  expected_kwh: float
  delta_kwh: float
  delta_pct: float
  z_score: float
  band: str


class SiteInsightsResponse(BaseModel):
  site_id: str
  window_hours: int
  baseline_lookback_days: int
  total_actual_kwh: float
  total_expected_kwh: float
  deviation_pct: float
  critical_hours: int
  elevated_hours: int
  below_baseline_hours: int
  hours: List[HourDeviation]
  generated_at: Optional[str] = None


@router.get(
    "/sites/{site_id}/insights",
    response_model=SiteInsightsResponse,
)
def get_site_insights(
    site_id: str,
    window_hours: int = Query(24, ge=1, le=168),
    lookback_days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Return baseline-vs-actual insights for a single site.

    - window_hours: how much recent data to compare (e.g. 24h or 168h).
    - lookback_days: how far back we learn the baseline (e.g. 30 days).
    """
    insights = compute_site_insights(
        db=db,
        site_id=site_id,
        window_hours=window_hours,
        lookback_days=lookback_days,
    )
    if not insights:
        raise HTTPException(
            status_code=404,
            detail=f"No insights available for site_id={site_id} (insufficient history or no recent data).",
        )

    return insights
