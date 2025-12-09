# backend/app/api/v1/opportunities.py

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user
from app.services.opportunities import OpportunityEngine
from app.services.analytics import AnalyticsService
from app.models import Site, User, Opportunity

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
        orm_mode = True  # pydantic v1-style; still supported under v2 via from_attributes


# --------------------------------------------------------------------------------------
# AUTO-GENERATED OPPORTUNITIES (existing behaviour – KEEPING AS-IS)
# --------------------------------------------------------------------------------------


@router.get("/sites/{site_id}/opportunities")
def get_opportunities(site_id: int, db: Session = Depends(get_db)):
    """
    Auto-generated opportunities based on analytics KPIs.

    NOTE:
    - This endpoint preserves the existing behaviour and response shape.
    - It remains unauthenticated for now to avoid breaking existing tests/consumers.
      Org scoping will be added in a later hardening pass.
    """
    kpis = AnalyticsService(db).compute_kpis(site_id)
    engine = OpportunityEngine()
    opportunities = engine.suggest_measures(kpis)
    return {"opportunities": opportunities}


# --------------------------------------------------------------------------------------
# MANUAL OPPORTUNITIES (persisted) – FIRST SLICE OF THE UNIFIED ENGINE
# --------------------------------------------------------------------------------------


def _get_site_for_user(db: Session, user: User, site_id: int) -> Site:
    """
    Resolve a site for the current user with basic org scoping.

    - If user.organization_id is set, enforce Site.org_id == user.organization_id.
    - If user.organization_id is None, fall back to single-tenant/dev behaviour (by id only).
    """
    org_id = getattr(user, "organization_id", None)

    query = db.query(Site).filter(Site.id == site_id)
    if org_id is not None:
        query = query.filter(Site.org_id == org_id)

    site = query.first()
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found",
        )
    return site


@router.get(
    "/sites/{site_id}/opportunities/manual",
    response_model=List[ManualOpportunityOut],
    status_code=status.HTTP_200_OK,
)
def list_manual_opportunities_for_site(
    site_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[ManualOpportunityOut]:
    """
    List manually entered opportunities for a given site.

    - Scoped to the caller's organization via the Site.org_id link.
    - Returns only DB-backed Opportunity rows for that site (no auto suggestions).
    """
    site = _get_site_for_user(db, user, site_id)

    rows: List[Opportunity] = (
        db.query(Opportunity)
        .filter(Opportunity.site_id == site.id)
        .order_by(Opportunity.created_at.desc())
        .all()
    )
    return rows


@router.post(
    "/sites/{site_id}/opportunities/manual",
    response_model=ManualOpportunityOut,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_opportunity_for_site(
    site_id: int,
    payload: ManualOpportunityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ManualOpportunityOut:
    """
    Create a manual opportunity for a given site.

    This powers the first slice of the "human-entered opportunities" workflow:
    - Name + description stored in the existing Opportunity model.
    - Scoped via Site.org_id so users cannot write into other orgs' sites.
    """
    site = _get_site_for_user(db, user, site_id)

    row = Opportunity(
        site_id=site.id,
        name=payload.name,
        description=payload.description,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
