from fastapi import APIRouter, BackgroundTasks, HTTPException
from typing import List, Dict, Any
from pydantic import BaseModel, Field
from app.services.ingest import save_raw_timeseries, process_job, validate_record

router = APIRouter()


class TimeseriesRecordIn(BaseModel):
    site_id: str
    meter_id: str
    timestamp: str
    value: float
    unit: str = Field(default="kWh")


@router.post("/timeseries", status_code=202)
async def ingest_timeseries(records: List[TimeseriesRecordIn], background: BackgroundTasks):
    if not records:
        raise HTTPException(status_code=400, detail="empty payload")
    payload = [r.dict() for r in records]
    job_id = save_raw_timeseries(payload)

    def _process():
        try:
            process_job(job_id)
        except Exception:
            # in production push to worker queue
            pass

    background.add_task(_process)
    return {"status": "accepted", "job_id": job_id}
