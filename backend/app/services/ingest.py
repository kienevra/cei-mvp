import os
import json
import logging
from typing import Tuple, List, Dict, Any
from sqlalchemy.orm import Session
from app.core.config import settings

logger = logging.getLogger(__name__)

STAGING_FILE = os.path.join(os.path.dirname(__file__), "../api/v1/timeseries_staging.json")

# --- Pure validation ---
def validate_record(record: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errors = []
    required = ["site_id", "meter_id", "timestamp", "value", "unit"]
    for field in required:
        if field not in record or record[field] is None:
            errors.append(f"Missing field: {field}")
    try:
        float(record.get("value", ""))
    except Exception:
        errors.append("Value must be numeric")
    if record.get("unit") != "kWh":
        errors.append("Unit must be 'kWh'")
    # Add more validation as needed
    return (len(errors) == 0, errors)

# --- IO functions ---
def save_raw_timeseries(job_id: str, payload: Any):
    try:
        with open(STAGING_FILE, "a") as f:
            json.dump({"job_id": job_id, "records": payload}, f, default=str)
            f.write("\n")
        logger.info(f"Saved raw timeseries for job {job_id}")
    except Exception as e:
        logger.error(f"Failed to save raw timeseries: {e}")
        raise RuntimeError(f"Failed to save raw timeseries: {e}")

# --- Processing ---
def process_job(job_id: str, db: Session):
    # Read staged records
    try:
        with open(STAGING_FILE, "r") as f:
            for line in f:
                entry = json.loads(line)
                if entry.get("job_id") == job_id:
                    records = entry.get("records", [])
                    break
            else:
                raise RuntimeError(f"Job {job_id} not found in staging")
    except Exception as e:
        logger.error(f"Error reading staging file: {e}")
        raise
    # Normalize units and compute delta (placeholder)
    normalized = []
    for rec in records:
        valid, errors = validate_record(rec)
        if not valid:
            logger.warning(f"Invalid record in job {job_id}: {errors}")
            continue
        # Example normalization: unit
        rec["unit"] = "kWh"  # Only kWh supported for now
        # Example delta computation for cumulative meters (placeholder)
        # rec["delta"] = ...
        normalized.append(rec)
    # Write to main timeseries DB table (placeholder)
    try:
        for rec in normalized:
            # Replace with your SQLAlchemy model and insert logic
            # db.add(TimeseriesModel(**rec))
            pass
        db.commit()
        logger.info(f"Processed job {job_id}: {len(normalized)} records written to DB")
    except Exception as e:
        logger.error(f"Failed to write records to DB: {e}")
        raise RuntimeError(f"Failed to write records to DB: {e}")
