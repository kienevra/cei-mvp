"""
# To include in app.main:
# from app.api.v1.data_timeseries import router as data_timeseries_router
# app.include_router(data_timeseries_router)
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, Field, validator
from typing import List
from uuid import uuid4
from datetime import datetime
import json
import os

router = APIRouter(prefix="/api/v1/data", tags=["Data Timeseries"])

class TimeseriesRecord(BaseModel):
    site_id: str = Field(..., example="site-123")
    meter_id: str = Field(..., example="meter-456")
    timestamp: datetime = Field(..., example="2025-01-01T12:00:00Z")
    value: float = Field(..., example=123.45)
    unit: str = Field(..., example="kWh")

    @validator("value")
    def value_range(cls, v):
        if not (0 <= v <= 1e6):
            raise ValueError("Value must be between 0 and 1,000,000")
        return v

    @validator("unit")
    def unit_kwh(cls, v):
        if v != "kWh":
            raise ValueError("Unit must be 'kWh'")
        return v

class TimeseriesRequest(BaseModel):
    __root__: List[TimeseriesRecord]

    class Config:
        schema_extra = {
            "example": [
                {
                    "site_id": "site-123",
                    "meter_id": "meter-456",
                    "timestamp": "2025-01-01T12:00:00Z",
                    "value": 123.45,
                    "unit": "kWh"
                }
            ]
        }

class TimeseriesAcceptedResponse(BaseModel):
    status: str = Field("accepted", example="accepted")
    job_id: str = Field(..., example="a1b2c3d4-5678-90ab-cdef-1234567890ab")

STAGING_FILE = os.path.join(os.path.dirname(__file__), "timeseries_staging.json")

def process_timeseries_job(job_id: str):
    # Placeholder for real processing logic
    pass

@router.post("/timeseries", response_model=TimeseriesAcceptedResponse, status_code=status.HTTP_202_ACCEPTED)
async def post_timeseries(
    records: TimeseriesRequest,
    background_tasks: BackgroundTasks
):
    """
    Accepts a JSON array of timeseries records and enqueues processing.
    - Validates required fields, value range, and timestamp format.
    - Saves raw payload to a staging file (or DB if ready).
    - Returns job_id for tracking.
    """
    job_id = str(uuid4())
    # Save raw payload to staging file
    try:
        with open(STAGING_FILE, "a") as f:
            json.dump({"job_id": job_id, "records": records.__root__}, f, default=str)
            f.write("\n")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save data: {e}")
    # Enqueue background processing
    background_tasks.add_task(process_timeseries_job, job_id)
    return TimeseriesAcceptedResponse(job_id=job_id)
