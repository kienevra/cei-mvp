# backend/app/api/v1/upload_csv.py
from typing import List, Set

import csv
import io
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import TimeseriesRecord

logger = logging.getLogger("cei")

router = APIRouter(prefix="/upload-csv", tags=["upload"])


class CsvUploadResult(BaseModel):
    rows_received: int
    rows_ingested: int
    rows_failed: int
    errors: List[str] = []
    sample_site_ids: List[str] = []
    sample_meter_ids: List[str] = []


@router.post("/", response_model=CsvUploadResult, status_code=status.HTTP_200_OK)
async def upload_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Upload a CSV of timeseries data and ingest into TimeseriesRecord.

    Expected columns (header row):
      - timestamp  (ISO8601 or 'YYYY-MM-DD HH:MM:SS')
      - value      (numeric)
      - unit       (e.g. kWh)
      - site_id    (string; optional but strongly recommended)
      - meter_id   (string; optional but strongly recommended)
    """

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    # Decode bytes -> text
    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file has no header row")

    required_cols = ["timestamp", "value", "unit", "site_id", "meter_id"]
    missing = [c for c in required_cols if c not in reader.fieldnames]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Missing required columns: {', '.join(missing)}. "
                f"Expected at least: {', '.join(required_cols)}"
            ),
        )

    rows_received = 0
    rows_ingested = 0
    rows_failed = 0
    errors: List[str] = []
    site_ids: Set[str] = set()
    meter_ids: Set[str] = set()
    records: List[TimeseriesRecord] = []

    for row in reader:
        rows_received += 1
        try:
            raw_ts = (row.get("timestamp") or "").strip()
            raw_value = (row.get("value") or "").strip()
            raw_unit = (row.get("unit") or "").strip()
            raw_site = (row.get("site_id") or "").strip()
            raw_meter = (row.get("meter_id") or "").strip()

            if not raw_ts or not raw_value or not raw_unit:
                raise ValueError("timestamp, value, and unit are required")

            # Parse timestamp
            ts = _parse_timestamp(raw_ts)

            # Parse numeric value
            try:
                val = Decimal(raw_value)
            except InvalidOperation:
                raise ValueError(f"Invalid numeric value: {raw_value}")

            site_id = raw_site or "default"
            meter_id = raw_meter or "default"

            rec = TimeseriesRecord(
                site_id=site_id,
                meter_id=meter_id,
                timestamp=ts,
                value=val,
                unit=raw_unit,
            )
            records.append(rec)

            site_ids.add(site_id)
            meter_ids.add(meter_id)
            rows_ingested += 1

        except Exception as e:
            rows_failed += 1
            # Cap error messages to avoid massive responses on big files
            if len(errors) < 20:
                errors.append(f"Row {rows_received}: {e}")
            logger.exception("Failed to ingest CSV row %s", rows_received)

    # Persist in one transaction
    if records:
        db.add_all(records)
        db.commit()

    return CsvUploadResult(
        rows_received=rows_received,
        rows_ingested=rows_ingested,
        rows_failed=rows_failed,
        errors=errors,
        sample_site_ids=sorted(site_ids)[:10],
        sample_meter_ids=sorted(meter_ids)[:10],
    )


def _parse_timestamp(raw: str) -> datetime:
    """
    Try a couple of sane timestamp formats for MVP.
    """
    raw = raw.strip()
    # Try ISO first
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass

    # Try 'YYYY-MM-DD HH:MM:SS'
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        pass

    raise ValueError(f"Invalid timestamp format: {raw}")
