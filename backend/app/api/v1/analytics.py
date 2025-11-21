# backend/app/api/v1/analytics.py
from typing import List, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.services.analytics import compute_site_insights

router = APIRouter(prefix="/analytics", tags=["analytics"])


class InsightOut(BaseModel):
    id: str
    severity: Literal["info", "warning", "critical"]
    title: str
    message: str


class SiteInsightsOut(BaseModel):
    site_id: str
    window_days: int
    insights: List[InsightOut]


@router.get("/sites/{site_numeric_id}/insights", response_model=SiteInsightsOut)
def get_site_insights(
    site_numeric_id: int,
    window_days: int = 7,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Site-level insights endpoint.

    - `site_numeric_id` is the app-level Site.id (e.g. 1).
    - Internally we map this to the timeseries key `site-{id}`.
    """
    site_key = f"site-{site_numeric_id}"
    payload = compute_site_insights(db=db, site_key=site_key, window_days=window_days)
    return payload
