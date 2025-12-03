import os
import uuid
import json
import logging
from typing import Tuple, Dict, Any, List, Optional
from datetime import datetime
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db import models as db_models  # still used for other models later
from app.models import TimeseriesRecord  # TimeseriesRecord lives here
from app.api.deps import get_org_allowed_site_ids  # reuse org scoping logic

STAGING_DIR = os.getenv("INGEST_STAGING_DIR", "/tmp/cei_staging")
os.makedirs(STAGING_DIR, exist_ok=True)

logger = logging.getLogger("app.services.ingest")


# --- Legacy staging-based ingestion (used by older CSV/raw flows) ---


def save_raw_timeseries(payload: List[Dict[str, Any]]) -> str:
    """
    Save raw timeseries payload into a staging file and return a job_id.

    This is the legacy staging-based flow. It is kept for backward
    compatibility with any existing CSV/raw ingestion that relies on it.
    """
    job_id = uuid.uuid4().hex
    path = os.path.join(STAGING_DIR, f"{job_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    logger.info("saved staging payload %s", path)
    return job_id


def validate_record(r: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Legacy validator used by process_job.

    NOTE:
    - Accepts either "timestamp" (old) or "timestamp_utc" (newer naming).
    - Does NOT enforce units or idempotency; that’s handled in the
      dedicated batch validator for the /timeseries/batch API.
    """
    errs: List[str] = []

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

    ts_raw = r.get("timestamp_utc") or r.get("timestamp")
    if ts_raw is None:
        errs.append("timestamp_utc missing")
    else:
        try:
            # Support "Z" suffix for UTC
            datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except Exception:
            errs.append("timestamp_utc not ISO8601")

    return (len(errs) == 0, errs)


def process_job(job_id: str) -> int:
    """
    Simple process: read staging file, validate, and return count of accepted rows.
    In real app, insert into DB using SQLAlchemy session (not done here to keep file small).

    This function is retained for backward compatibility with any staging-based
    ingestion flows you might still be using.
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
            # TODO: persist to DB for legacy flows if needed
            accepted += 1
        else:
            logger.warning("staging record %s failed validation: %s", r, errs)

    logger.info("processed job %s accepted=%d total=%d", job_id, accepted, len(payload))
    return accepted


# --- Direct API ingestion for /timeseries/batch (Phase #3) ---


def validate_batch_record(r: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Strict validator for the /timeseries/batch API.

    Expected shape per record:
      {
        "site_id": "1",
        "meter_id": "main-incomer",
        "timestamp_utc": "2025-12-03T10:00:00Z",
        "value": 123.4,
        "unit": "kWh",                 # optional but if present must be "kWh"
        "idempotency_key": "..."       # optional but recommended
      }
    """
    errs: List[str] = []

    # Required identifiers
    if not r.get("site_id"):
        errs.append("site_id missing")
    if not r.get("meter_id"):
        errs.append("meter_id missing")

    # Value
    if "value" not in r:
        errs.append("value missing")
    else:
        try:
            Decimal(str(r["value"]))
        except Exception:
            errs.append("value not numeric")

    # Timestamp (UTC, ISO8601)
    ts_raw = r.get("timestamp_utc") or r.get("timestamp")
    if ts_raw is None:
        errs.append("timestamp_utc missing")
    else:
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                errs.append("timestamp_utc must be timezone-aware (UTC)")
        except Exception:
            errs.append("timestamp_utc not ISO8601")

    # Unit (locked to kWh for now if provided)
    unit = r.get("unit")
    if unit is not None and unit != "kWh":
        errs.append("unit must be 'kWh'")

    return (len(errs) == 0, errs)


def ingest_timeseries_batch(
    records: List[Dict[str, Any]],
    organization_id: Optional[int],
    source: Optional[str] = None,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    """
    Ingest a batch of timeseries records directly into TimeseriesRecord.

    This is the core service for the POST /api/v1/timeseries/batch endpoint.

    - Validates each record.
    - If organization_id is set, enforces that site_id is in the org's allowed site list.
    - Writes to DB with org scoping when supported by the model.
    - Handles duplicates via DB constraints (if idempotency/unique keys exist).
    - Returns a machine-readable summary.

    Returns:
      {
        "ingested": int,
        "skipped_duplicate": int,
        "failed": int,
        "errors": [
          {
            "index": int,
            "code": str,
            "detail": str
          }
        ]
      }
    """
    if not records:
        return {
            "ingested": 0,
            "skipped_duplicate": 0,
            "failed": 0,
            "errors": [],
        }

    session_provided = db is not None
    if db is None:
        db = SessionLocal()

    ingested = 0
    skipped_duplicate = 0
    failed = 0
    errors: List[Dict[str, Any]] = []

    # Precompute allowed site_ids for this org, once per batch
    allowed_site_ids: Optional[set[str]] = None
    if organization_id:
        try:
            allowed_list = get_org_allowed_site_ids(db, organization_id)
            # Normalize to strings because TimeseriesRecord.site_id is a String column
            allowed_site_ids = {str(s) for s in allowed_list}
        except Exception as exc:
            logger.error("failed to load allowed site ids for org %s: %s", organization_id, exc)
            # In the worst case, treat as no sites allowed to avoid leaking data across orgs
            allowed_site_ids = set()

    try:
        for idx, r in enumerate(records):
            ok, errs = validate_batch_record(r)
            if not ok:
                failed += 1
                errors.append(
                    {
                        "index": idx,
                        "code": "VALIDATION_ERROR",
                        "detail": "; ".join(errs),
                    }
                )
                continue

            # Enforce org-scoped site_id if org is known
            site_id_str = str(r["site_id"])
            if allowed_site_ids is not None:
                if site_id_str not in allowed_site_ids:
                    failed += 1
                    errors.append(
                        {
                            "index": idx,
                            "code": "INVALID_SITE",
                            "detail": f"site_id '{site_id_str}' is not allowed for this organization",
                        }
                    )
                    continue

            # Safe timestamp parsing (we already validated)
            ts_raw = r.get("timestamp_utc") or r.get("timestamp")
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))

            # Build kwargs based on what the TimeseriesRecord model actually has
            record_kwargs: Dict[str, Any] = {
                "site_id": site_id_str,
                "meter_id": r["meter_id"],
                "value": float(r["value"]),
            }

            # Timestamp field: support either timestamp_utc or timestamp
            if hasattr(TimeseriesRecord, "timestamp_utc"):
                record_kwargs["timestamp_utc"] = ts
            elif hasattr(TimeseriesRecord, "timestamp"):
                record_kwargs["timestamp"] = ts

            # Org scoping if the model supports organization_id
            if hasattr(TimeseriesRecord, "organization_id") and organization_id is not None:
                record_kwargs["organization_id"] = organization_id

            record = TimeseriesRecord(**record_kwargs)

            # Optionally set unit if the model supports it
            if hasattr(TimeseriesRecord, "unit"):
                setattr(record, "unit", r.get("unit", "kWh"))

            # Optionally set idempotency_key if the model supports it
            if hasattr(TimeseriesRecord, "idempotency_key") and r.get("idempotency_key"):
                setattr(record, "idempotency_key", r["idempotency_key"])

            # Optionally set source if the model supports it
            if hasattr(TimeseriesRecord, "source") and source:
                setattr(record, "source", source)

            try:
                db.add(record)
                db.commit()
            except IntegrityError as exc:
                db.rollback();
                skipped_duplicate += 1
                errors.append(
                    {
                        "index": idx,
                        "code": "DUPLICATE",
                        "detail": str(getattr(exc, "orig", exc)),
                    }
                )
            except Exception as exc:
                db.rollback()
                failed += 1
                errors.append(
                    {
                        "index": idx,
                        "code": "DB_ERROR",
                        "detail": str(exc),
                    }
                )
            else:
                ingested += 1

        return {
            "ingested": ingested,
            "skipped_duplicate": skipped_duplicate,
            "failed": failed,
            "errors": errors,
        }
    finally:
        if not session_provided:
            db.close()
