# backend/app/services/ingest.py
import os
import json
import logging
from typing import Tuple, Dict, Any, List, Optional, Set
from datetime import datetime
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db import models as db_models  # still used for other models later
from app.models import TimeseriesRecord  # TimeseriesRecord lives here
from app.api.deps import get_org_allowed_site_ids  # reuse org scoping logic
from app.core.errors import TimeseriesIngestErrorCode

STAGING_DIR = os.getenv("INGEST_STAGING_DIR", "/tmp/cei_staging")
os.makedirs(STAGING_DIR, exist_ok=True)

# Legacy single-file staging path used by old tests and flows.
# tests/test_ingest.py monkeypatches this to a temp file.
STAGING_FILE: Optional[str] = None

logger = logging.getLogger("app.services.ingest")


# --- Legacy staging-based ingestion (used by older CSV/raw flows) ---


def save_raw_timeseries(job_id: str, payload: List[Dict[str, Any]]) -> str:
    """
    Save raw timeseries payload into a staging file and return a job_id.

    Legacy behavior, aligned with tests/test_ingest.py:

    - Signature: save_raw_timeseries(job_id, payload)
    - If STAGING_FILE is set (e.g. in tests), always write a single
      newline-delimited JSON object to that path:

        {"job_id": "<job_id>", "records": [...]}

    - Otherwise, write the raw payload array to STAGING_DIR/<job_id>.json
      so that process_job(job_id) can json.load() and iterate records.
    """
    if STAGING_FILE:
        path = STAGING_FILE
        entry = {"job_id": job_id, "records": payload}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        logger.info("saved staging payload %s job_id=%s (STAGING_FILE mode)", path, job_id)
    else:
        path = os.path.join(STAGING_DIR, f"{job_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        logger.info("saved staging payload %s job_id=%s (STAGING_DIR mode)", path, job_id)

    return job_id


def validate_record(r: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Legacy validator used by process_job and older tests.
    """
    errs: List[str] = []

    if not r.get("site_id"):
        errs.append("Missing field: site_id")
    if not r.get("meter_id"):
        errs.append("Missing field: meter_id")

    if "value" not in r:
        errs.append("Missing field: value")
    else:
        try:
            v = Decimal(str(r["value"]))
            if v < 0:
                errs.append("Value must be non-negative")
        except Exception:
            errs.append("Value must be numeric")

    ts_raw = r.get("timestamp") or r.get("timestamp_utc")
    if ts_raw is None:
        errs.append("Missing field: timestamp")
    else:
        try:
            datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except Exception:
            errs.append("Invalid timestamp format")

    unit = r.get("unit")
    if unit is not None and unit != "kWh":
        errs.append("Unit must be 'kWh'")

    return (len(errs) == 0, errs)


def process_job(job_id: str) -> int:
    """
    Back-compat staging job processor. (No DB writes.)
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
            accepted += 1
        else:
            logger.warning("staging record %s failed validation: %s", r, errs)

    logger.info("processed job %s accepted=%d total=%d", job_id, accepted, len(payload))
    return accepted


# --- Direct API ingestion for /timeseries/batch (Phase #3) ---


def validate_batch_record(r: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Strict validator for the /timeseries/batch API.
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
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                errs.append("timestamp_utc must be timezone-aware (UTC)")
        except Exception:
            errs.append("timestamp_utc not ISO8601")

    unit = r.get("unit")
    if unit is not None and unit != "kWh":
        errs.append("unit must be 'kWh'")

    return (len(errs) == 0, errs)


def _guess_code_from_validation_errors(errs: List[str]) -> TimeseriesIngestErrorCode:
    for e in errs:
        if (
            "timestamp_utc missing" in e
            or "timestamp_utc not ISO8601" in e
            or "timestamp_utc must be timezone-aware" in e
        ):
            return TimeseriesIngestErrorCode.INVALID_TIMESTAMP

    for e in errs:
        if "value missing" in e or "value not numeric" in e:
            return TimeseriesIngestErrorCode.INVALID_VALUE

    for e in errs:
        if "unit must be 'kWh'" in e:
            return TimeseriesIngestErrorCode.INVALID_UNIT

    return TimeseriesIngestErrorCode.INTERNAL_ERROR


def _normalize_idempotency_key(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _record_model_supports_org() -> bool:
    return hasattr(TimeseriesRecord, "organization_id")


def _record_model_supports_idempotency() -> bool:
    return hasattr(TimeseriesRecord, "idempotency_key")


def _is_likely_idempotency_integrity_error(exc: IntegrityError) -> bool:
    """
    Best-effort classifier so we don't mislabel *every* IntegrityError as idempotency.
    This is DB-specific, so we use string heuristics.
    """
    msg = str(getattr(exc, "orig", exc)).lower()
    # common fragments across sqlite/postgres for unique violations
    return ("unique" in msg or "duplicate" in msg) and ("idempotency" in msg or "idempotency_key" in msg)


def _idempotency_exists(
    db: Session,
    *,
    organization_id: Optional[int],
    idempotency_key: str,
) -> bool:
    """
    Deterministic idempotency gate.

    - If model supports org scoping: enforce (organization_id, idempotency_key)
    - Else: enforce global (idempotency_key)
    """
    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.idempotency_key == idempotency_key)
    if _record_model_supports_org() and organization_id is not None:
        q = q.filter(TimeseriesRecord.organization_id == organization_id)
    return db.query(q.exists()).scalar() is True


def ingest_timeseries_batch(
    records: List[Dict[str, Any]],
    organization_id: Optional[int],
    source: Optional[str] = None,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    """
    Ingest a batch of timeseries records directly into TimeseriesRecord.

    Idempotency guarantee:
    - If a record provides idempotency_key and TimeseriesRecord supports it,
      we will NEVER double-ingest that key (scoped by org when possible),
      even if the DB constraint is missing in production.

    Returns:
      {
        "ingested": int,
        "skipped_duplicate": int,
        "failed": int,
        "errors": [{"index": int, "code": str, "detail": str}]
      }
    """
    if not records:
        return {"ingested": 0, "skipped_duplicate": 0, "failed": 0, "errors": []}

    session_provided = db is not None
    if db is None:
        db = SessionLocal()

    ingested = 0
    skipped_duplicate = 0
    failed = 0
    errors: List[Dict[str, Any]] = []

    # Allowed site_ids for org, once per batch
    allowed_site_ids: Optional[Set[str]] = None
    if organization_id:
        try:
            allowed_list = get_org_allowed_site_ids(db, organization_id)
            allowed_site_ids = {str(s) for s in allowed_list}
        except Exception as exc:
            logger.error("failed to load allowed site ids for org %s: %s", organization_id, exc)
            allowed_site_ids = set()  # fail-closed

    model_has_org = _record_model_supports_org()
    model_has_idem = _record_model_supports_idempotency()

    try:
        for idx, r in enumerate(records):
            ok, errs = validate_batch_record(r)
            if not ok:
                failed += 1
                code_enum = _guess_code_from_validation_errors(errs)
                errors.append({"index": idx, "code": code_enum.value, "detail": "; ".join(errs)})
                continue

            site_id_str = str(r["site_id"])

            if allowed_site_ids is not None and site_id_str not in allowed_site_ids:
                failed += 1
                errors.append(
                    {
                        "index": idx,
                        "code": TimeseriesIngestErrorCode.ORG_MISMATCH.value,
                        "detail": f"site_id '{site_id_str}' is not allowed for this organization",
                    }
                )
                continue

            ts_raw = r.get("timestamp_utc") or r.get("timestamp")
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))

            # Normalize idempotency key early
            idem_key = _normalize_idempotency_key(r.get("idempotency_key"))

            # Deterministic idempotency pre-check (works even without DB constraints)
            if model_has_idem and idem_key:
                try:
                    if _idempotency_exists(db, organization_id=organization_id, idempotency_key=idem_key):
                        skipped_duplicate += 1
                        errors.append(
                            {
                                "index": idx,
                                "code": TimeseriesIngestErrorCode.DUPLICATE_IDEMPOTENCY_KEY.value,
                                "detail": "Duplicate idempotency_key (pre-check)",
                            }
                        )
                        continue
                except Exception as exc:
                    # If pre-check fails, we still attempt insert; DB constraint may still protect us.
                    logger.warning("idempotency pre-check failed (idx=%s): %s", idx, exc)

            record_kwargs: Dict[str, Any] = {
                "site_id": site_id_str,
                "meter_id": r["meter_id"],
                "value": float(r["value"]),
            }

            if hasattr(TimeseriesRecord, "timestamp_utc"):
                record_kwargs["timestamp_utc"] = ts
            elif hasattr(TimeseriesRecord, "timestamp"):
                record_kwargs["timestamp"] = ts

            if model_has_org and organization_id is not None:
                record_kwargs["organization_id"] = organization_id

            record = TimeseriesRecord(**record_kwargs)

            if hasattr(TimeseriesRecord, "unit"):
                setattr(record, "unit", r.get("unit", "kWh"))

            if model_has_idem and idem_key:
                setattr(record, "idempotency_key", idem_key)

            if hasattr(TimeseriesRecord, "source") and source:
                setattr(record, "source", source)

            try:
                with db.begin_nested():
                    db.add(record)
                    db.flush()
            except IntegrityError as exc:
                # Only classify as idempotency duplicate if it's likely that constraint,
                # otherwise treat it as a failure so we don't mask data issues.
                if model_has_idem and idem_key and _is_likely_idempotency_integrity_error(exc):
                    skipped_duplicate += 1
                    errors.append(
                        {
                            "index": idx,
                            "code": TimeseriesIngestErrorCode.DUPLICATE_IDEMPOTENCY_KEY.value,
                            "detail": str(getattr(exc, "orig", exc)),
                        }
                    )
                    continue

                failed += 1
                errors.append(
                    {
                        "index": idx,
                        "code": TimeseriesIngestErrorCode.INTERNAL_ERROR.value,
                        "detail": str(getattr(exc, "orig", exc)),
                    }
                )
                continue
            except Exception as exc:
                failed += 1
                errors.append(
                    {"index": idx, "code": TimeseriesIngestErrorCode.INTERNAL_ERROR.value, "detail": str(exc)}
                )
                continue
            else:
                ingested += 1

        db.commit()
        return {
            "ingested": ingested,
            "skipped_duplicate": skipped_duplicate,
            "failed": failed,
            "errors": errors,
        }

    except Exception:
        db.rollback()
        raise
    finally:
        if not session_provided:
            db.close()
