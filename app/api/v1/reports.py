from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from app.services.reporting import ReportingService
from app.services.analytics import AnalyticsService
from app.services.opportunities import OpportunityEngine
from app.db.session import get_db
from app.models import Site
import aiofiles
from sqlalchemy.orm import Session

router = APIRouter()

@router.post("/sites/{site_id}/reports")
async def generate_report(site_id: int, db: Session = Depends(get_db)):
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        return Response(content="Site not found", status_code=404)
    kpis = AnalyticsService(db).compute_kpis(site_id)
    opportunities = OpportunityEngine().suggest_measures(kpis)
    pdf_bytes = ReportingService().generate_pdf_report(site.name, kpis, opportunities)

    async def pdf_streamer():
        yield pdf_bytes

    headers = {
        "Content-Disposition": f"attachment; filename=site_{site_id}_report.pdf"
    }
    return StreamingResponse(pdf_streamer(), media_type="application/pdf", headers=headers)
