"""
# To include in app.main:
# from app.api.v1.webhook import router as webhook_router
# app.include_router(webhook_router)
"""

from fastapi import APIRouter, Request, BackgroundTasks, HTTPException, status, Header
from pydantic import BaseModel, Field, validator
from typing import Optional
from uuid import uuid4
from datetime import datetime
import hmac
import hashlib
import os
import time
from app.core.config import settings

router = APIRouter(prefix="/api/v1", tags=["Webhook"])

# Simple in-memory rate limit store
RATE_LIMIT = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 30    # requests per window

def check_rate_limit(ip: str):
    now = int(time.time())
    window = now // RATE_LIMIT_WINDOW
    key = f"{ip}:{window}"
    count = RATE_LIMIT.get(key, 0)
    if count >= RATE_LIMIT_MAX:
        return False
    RATE_LIMIT[key] = count + 1
    return True

class WebhookRecord(BaseModel):
    site_id: str
    meter_id: str
    timestamp: datetime
    value: float
    unit: str
    device_id: str
    signature: Optional[str] = None

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

# Placeholder for background pipeline
from app.api.v1.data_timeseries import process_timeseries_job

def verify_signature(payload: dict, signature: str, secret: str) -> bool:
    msg = (str(payload)).encode()
    key = secret.encode()
    expected = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

@router.post("/webhook", status_code=status.HTTP_202_ACCEPTED)
async def webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_signature: Optional[str] = Header(None)
):
    """
    Accepts a single-record JSON payload from gateway devices. Verifies signature if present, validates, and enqueues for processing.
    """
    # Rate limit per-IP
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    payload = await request.json()
    try:
        record = WebhookRecord(**payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Validation error: {e}")
    # Signature verification
    if x_signature:
        secret = getattr(settings, "GATEWAY_SHARED_SECRET", None)
        if not secret:
            raise HTTPException(status_code=500, detail="Gateway shared secret not configured")
        if not verify_signature(payload, x_signature, secret):
            raise HTTPException(status_code=401, detail="Invalid signature")
    # Enqueue background job
    job_id = str(uuid4())
    background_tasks.add_task(process_timeseries_job, job_id)
    return {"status": "accepted", "job_id": job_id}
