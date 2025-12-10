# backend/app/api/v1/opportunities.py

from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user
from app.services.opportunities import OpportunityEngine
from app.services.analytics import AnalyticsService
from app.models import Opportunity, User

router = APIRouter()


# --------------------------------------------------------------------------------------
# Pydantic models for MANUAL opportunities (persisted in the DB)
# --------------------------------------------------------------------------------------


class ManualOpportunityBase(BaseModel):
    name: str
    description: Optional[str] = None


class ManualOpportunityCreate(ManualOpportunityBase):
    pass


class ManualOpportunityOut(ManualOpportunityBase):
    id: int
    site_id: int

    class Config:
        orm_mode = True  # pydantic v1-style; still supported via from_attributes in v2


# --------------------------------------------------------------------------------------
# AUTO + MANUAL OPPORTUNITIES – UNIFIED VIEW FOR /sites/{site_id}/opportunities
# --------------------------------------------------------------------------------------


@router.get("/sites/{site_id}/opportunities")
def get_opportunities(
    site_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Unified opportunities view for a site.

    - PRESERVES existing behaviour: returns a JSON object with an "opportunities" key.
    - Auto-generated measures still come from AnalyticsService + OpportunityEngine.
    - Manual, DB-backed Opportunity rows for this site are appended into the same list,
      normalized into the same shape the frontend expects.

    NOTE:
    - Endpoint remains unauthenticated for now (to avoid breaking existing
      consumers/tests). Manual CRUD endpoints are auth-protected.
    """

    # 1) Auto-generated opportunities from analytics KPIs
    kpis = AnalyticsService(db).compute_kpis(site_id)
    engine = OpportunityEngine()
    auto_opps = engine.suggest_measures(kpis)

    # Normalize auto measures so they always include "source"
    normalized_auto: List[Dict[str, Any]] = []
    for opp in auto_opps:
        data = dict(opp)
        data.setdefault("source", "auto")
        normalized_auto.append(data)

    # 2) Manual, persisted opportunities for this site
    manual_rows: List[Opportunity] = (
        db.query(Opportunity)
        .filter(Opportunity.site_id == site_id)
        .order_by(Opportunity.created_at.desc())
        .all()
    )

    manual_opps: List[Dict[str, Any]] = []
    for row in manual_rows:
        manual_opps.append(
            {
                "id": row.id,
                "name": row.name,
                "description": row.description,
                # These fields may or may not exist on your Opportunity model;
                # getattr() keeps this tolerant.
                "est_annual_kwh_saved": getattr(row, "est_annual_kwh_saved", None),
                "est_capex_eur": getattr(row, "est_capex_eur", None),
                "simple_roi_years": getattr(row, "simple_roi_years", None),
                "est_co2_tons_saved_per_year": getattr(
                    row, "est_co2_tons_saved_per_year", None
                ),
                "source": "manual",
            }
        )

    # Manual first, then auto – so operator-entered measures are more visible.
    combined = manual_opps + normalized_auto

    return {"opportunities": combined}


# --------------------------------------------------------------------------------------
# MANUAL OPPORTUNITIES – LIST + CREATE (NO SITE LOOKUP TO AVOID 404 IN DEV)
# --------------------------------------------------------------------------------------


@router.get(
    "/sites/{site_id}/opportunities/manual",
    response_model=List[ManualOpportunityOut],
)
def list_manual_opportunities_for_site(
    site_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),  # kept for auth, but not used for lookup
) -> List[ManualOpportunityOut]:
    """
    List manually entered opportunities for a given site.

    - Auth-protected via get_current_user.
    - For now we do NOT enforce org scoping or a separate site lookup; we just
      return rows with this site_id. This avoids 'Site not found' 404s caused by
      mismatched demo/org wiring in local dev.
    """
    rows: List[Opportunity] = (
      db.query(Opportunity)
      .filter(Opportunity.site_id == site_id)
      .order_by(Opportunity.created_at.desc())
      .all()
    )
    return rows


@router.post(
    "/sites/{site_id}/opportunities/manual",
    response_model=ManualOpportunityOut,
    status_code=201,
)
def create_manual_opportunity_for_site(
    site_id: int,
    payload: ManualOpportunityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),  # kept for auth, but not used for lookup
) -> ManualOpportunityOut:
    """
    Create a manual opportunity for a given site.

    - Auth-protected via get_current_user.
    - DOES NOT perform a separate Site lookup, to avoid 404s in dev when IDs /
      org wiring are slightly out of sync.
    - Writes directly into the existing Opportunity model with the given site_id.
    """
    row = Opportunity(
        site_id=site_id,
        name=payload.name,
        description=payload.description,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
