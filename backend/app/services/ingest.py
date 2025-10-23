import os
import json
import logging
from typing import Tuple, List, Dict, Any
logger = logging.getLogger(__name__)


# --- Pure validation ---

# --- IO functions ---

# --- Processing ---
import os
import uuid
import json
import logging
from typing import Tuple, Dict, Any, List
from datetime import datetime
from decimal import Decimal

STAGING_DIR = os.getenv("INGEST_STAGING_DIR", "/tmp/cei_staging")
os.makedirs(STAGING_DIR, exist_ok=True)
logger = logging.getLogger("app.services.ingest")


def save_raw_timeseries(payload: List[Dict[str, Any]]) -> str:
    job_id = uuid.uuid4().hex
    path = os.path.join(STAGING_DIR, f"{job_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    logger.info("saved staging payload %s", path)
    return job_id


def validate_record(r: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errs = []
    if not r.get("site_id"):
        errs.append("site_id missing")
    if not r.get("meter_id"):
        errs.append("meter_id missing")
    if "value" not in r:
        errs.append("value missing")
    else:
        try:
            Decimal(str(r["value"]))
        except Exception:
            errs.append("value not numeric")
    if "timestamp" in r:
        try:
            datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00"))
        except Exception:
            errs.append("timestamp not ISO8601")
    else:
        errs.append("timestamp missing")
    return (len(errs) == 0, errs)


def process_job(job_id: str) -> int:
    """
    Simple process: read staging file, validate, and return count of accepted rows.
    In real app, insert into DB using SQLAlchemy session (not done here to keep file small).
    """
    path = os.path.join(STAGING_DIR, f"{job_id}.json")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    accepted = 0
    for r in payload:
        ok, errs = validate_record(r)
        if ok:
            # TODO: persist to DB
            accepted += 1
        else:
            logger.warning("staging record %s failed validation: %s", r, errs)
    logger.info("processed job %s accepted=%d total=%d", job_id, accepted, len(payload))
    return accepted
