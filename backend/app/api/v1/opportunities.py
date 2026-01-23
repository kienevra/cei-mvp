# backend/app/api/v1/opportunities.py

from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user
from app.services.opportunities import OpportunityEngine
from app.models import Opportunity, User, Organization
from app.services.analytics import compute_site_insights

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
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Unified opportunities view for a site.

    Level B accuracy wiring:
    - Uses compute_site_insights() to get actual vs expected (baseline).
    - Uses org electricity tariff (€/kWh) + currency_code.
    - Computes annualized kWh + cost + CO2 savings off measured "excess vs baseline".

    NOTE:
    - Now auth-protected so we can safely fetch org tariff and enforce org-scoped reads.
    - Manual CRUD endpoints remain auth-protected as before.
    """

    # Map numeric /sites/{id} to CEI string key used in timeseries: "site-<id>"
    site_key = f"site-{int(site_id)}"

    org_id = getattr(user, "organization_id", None)

    org: Optional[Organization] = None
    if org_id is not None:
        org = db.query(Organization).filter(Organization.id == org_id).first()

    # Tariff + currency (Level B)
    electricity_price_per_kwh: Optional[float] = None
    currency_code: Optional[str] = None
    if org is not None:
        try:
            # Numeric may come back as Decimal
            v = org.electricity_price_per_kwh
            electricity_price_per_kwh = float(v) if v is not None else None
        except Exception:
            electricity_price_per_kwh = None
        try:
            currency_code = str(org.currency_code) if org.currency_code else None
        except Exception:
            currency_code = None

    # 1) Auto-generated opportunities from measured baseline delta
    # Use 7-day window for stability (Level B), 30-day baseline lookback
    insights = compute_site_insights(
        db=db,
        site_id=site_key,
        window_hours=168,
        lookback_days=30,
        organization_id=org_id,
        allowed_site_ids=[site_key],
    )

    # If no data, still return manual opps (operators may have entered items)
    kpis: Dict[str, Any] = {
        "site_id": site_key,
        "window_hours": 168,
        "baseline_lookback_days": 30,
        "total_actual_kwh": None,
        "total_expected_kwh": None,
        "excess_kwh_window": None,
        "electricity_price_per_kwh": electricity_price_per_kwh,
        "currency_code": currency_code,
    }

    if insights:
        try:
            total_actual = float(insights.get("total_actual_kwh") or 0.0)
        except Exception:
            total_actual = 0.0

        try:
            total_expected = float(insights.get("total_expected_kwh") or 0.0)
        except Exception:
            total_expected = 0.0

        excess = total_actual - total_expected
        if excess < 0:
            excess = 0.0  # savings potential = clamp to positive "waste" only

        kpis.update(
            {
                "total_actual_kwh": total_actual,
                "total_expected_kwh": total_expected,
                "excess_kwh_window": float(excess),
                "deviation_pct": insights.get("deviation_pct"),
                "generated_at": insights.get("generated_at"),
                "baseline_confidence_level": insights.get("confidence_level"),
                "baseline_is_warming_up": insights.get("is_baseline_warming_up"),
                "baseline_total_history_days": insights.get("total_history_days"),
            }
        )

    engine = OpportunityEngine()
    auto_opps = engine.suggest_measures(kpis)

    # Normalize auto measures so they always include "source"
    normalized_auto: List[Dict[str, Any]] = []
    for opp in auto_opps:
        data = dict(opp)
        data.setdefault("source", "auto")
        normalized_auto.append(data)

    # 2) Manual, persisted opportunities for this site (numeric site FK)
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
                # Manual table does NOT currently store savings fields.
                # Keep these nullable so frontend can render safely.
                "est_annual_kwh_saved": None,
                "est_capex_eur": None,
                "simple_roi_years": None,
                "est_co2_tons_saved_per_year": None,
                "est_annual_cost_saved": None,
                "currency_code": currency_code,
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
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
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
