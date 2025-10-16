from fastapi import APIRouter, Depends
from app.services.opportunities import OpportunityEngine
from app.services.analytics import AnalyticsService
from app.db.session import get_db

router = APIRouter()

@router.get("/sites/{site_id}/opportunities")
def get_opportunities(site_id: int, db=Depends(get_db)):
    # Compute KPIs for the site
    kpis = AnalyticsService(db).compute_kpis(site_id)
    engine = OpportunityEngine()
    opportunities = engine.suggest_measures(kpis)
    return {"opportunities": opportunities}
