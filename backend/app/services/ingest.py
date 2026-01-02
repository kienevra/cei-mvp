# backend/app/services/ingest.py
import os
import json
import logging
from typing import Tuple, Dict, Any, List, Optional, Set
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import TimeseriesRecord  # TimeseriesRecord lives here
from app.api.deps import get_org_allowed_site_ids  # reuse org scoping logic
from app.core.errors import TimeseriesIngestErrorCode

STAGING_DIR = os.getenv("INGEST_STAGING_DIR", "/tmp/cei_staging")
os.makedirs(STAGING_DIR, exist_ok=True)

# Legacy single-file staging path used by old tests and flows.
# tests/test_ingest.py monkeypatches this to a temp file.
STAGING_FILE: Optional[str] = None

logger = logging.getLogger("app.services.ingest")

# ----------------------------
# Ingestion correctness guards
# ----------------------------

# Allow small clock skew but block clearly-future readings.
FUTURE_SKEW_SECONDS = int(os.getenv("TIMESERIES_FUTURE_SKEW_SECONDS", "300"))  # 5 minutes

# Optional: prevent "ancient junk" unless you deliberately widen this.
# 0 or negative disables the guard.
MAX_PAST_DAYS = int(os.getenv("TIMESERIES_MAX_PAST_DAYS", "3650"))  # ~10 years

# Optional: clamp insane values. 0 or negative disables the guard.
MAX_VALUE_KWH = float(os.getenv("TIMESERIES_MAX_VALUE_KWH", "1000000"))  # 1,000,000 kWh/hour

# Canonical unit(s) stored/returned by CEI.
CANONICAL_UNIT_KWH = "kWh"

# Acceptable spellings -> canonical
_UNIT_ALIASES = {
    "kwh": CANONICAL_UNIT_KWH,
}

# Keep canonical set for messages/guards
ALLOWED_UNITS = {CANONICAL_UNIT_KWH}


def normalize_unit(unit: Any) -> str:
    """
    Option A: backend is NOT case-sensitive for unit.
    Accepts variations like: "kwh", "KWH", " kWh " and normalizes to canonical "kWh".

    Raises ValueError for missing/invalid units when the caller expects a unit.
    """
    raw = ("" if unit is None else str(unit)).strip()
    if not raw:
        raise ValueError("unit missing")

    key = raw.lower()
    canonical = _UNIT_ALIASES.get(key)
    if canonical:
        return canonical

    raise ValueError("unit must be 'kWh'")


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

    NOTE: Unit checking is now case-insensitive and normalizes to canonical "kWh".
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
    if unit is not None and str(unit).strip():
        try:
            _ = normalize_unit(unit)
        except Exception:
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


def _parse_timestamp_utc(ts_raw: Any) -> datetime:
    """
    Parse timestamp (ISO8601) and normalize to timezone-aware UTC with microseconds stripped.

    Accepts:
    - "2025-12-29T11:00:00Z"
    - "2025-12-29T11:00:00+00:00"

    Rejects:
    - naive timestamps (no tzinfo)
    - non-ISO8601 formats
    """
    s = str(ts_raw).strip()
    if not s:
        raise ValueError("timestamp_utc missing")

    if s.endswith("Z"):
        s = s[:-1] + "+00:00"

    dt = datetime.fromisoformat(s)

    # enforce aware
    if dt.tzinfo is None:
        raise ValueError("timestamp_utc must be timezone-aware (UTC)")

    dt = dt.astimezone(timezone.utc).replace(microsecond=0)
    return dt


def _validate_timestamp_guardrails(ts: datetime, *, now_utc: datetime) -> None:
    # Future guard
    if ts > (now_utc + timedelta(seconds=FUTURE_SKEW_SECONDS)):
        raise ValueError(
            f"Timestamp is in the future (>{FUTURE_SKEW_SECONDS//60}m skew): {ts.isoformat()}"
        )

    # Too-old guard (optional)
    if MAX_PAST_DAYS > 0:
        oldest = now_utc - timedelta(days=MAX_PAST_DAYS)
        if ts < oldest:
            raise ValueError(f"Timestamp is too old (> {MAX_PAST_DAYS}d): {ts.isoformat()}")


def _parse_value_kwh(raw: Any) -> Decimal:
    s = str(raw).strip()
    if s == "":
        raise ValueError("value missing")
    try:
        v = Decimal(s)
    except Exception:
        raise ValueError("value not numeric")
    if v.is_nan() or v.is_infinite():
        raise ValueError("value must be finite")
    if v < 0:
        raise ValueError("value must be non-negative")
    if MAX_VALUE_KWH > 0 and float(v) > MAX_VALUE_KWH:
        raise ValueError(f"value exceeds max ({MAX_VALUE_KWH:g} kWh)")
    return v


def validate_batch_record(r: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Strict schema/format validator for the /timeseries/batch API.
    Deeper correctness (future timestamps, max age, numeric bounds) is enforced
    in ingest_timeseries_batch so ALL ingest paths share the same guardrails.

    NOTE: Unit checking is now case-insensitive and normalizes to canonical "kWh".
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
    if unit is not None and str(unit).strip():
        try:
            _ = normalize_unit(unit)
        except Exception:
            errs.append("unit must be 'kWh'")

    return (len(errs) == 0, errs)


def _guess_code_from_validation_errors(errs: List[str]) -> TimeseriesIngestErrorCode:
    # Timestamp-related
    for e in errs:
        if (
            "timestamp_utc missing" in e
            or "timestamp_utc not ISO8601" in e
            or "timestamp_utc must be timezone-aware" in e
            or "Timestamp is" in e
        ):
            return TimeseriesIngestErrorCode.INVALID_TIMESTAMP

    # Value-related (includes bounds)
    for e in errs:
        if "value" in e:
            return TimeseriesIngestErrorCode.INVALID_VALUE

    # Unit-related
    for e in errs:
        if "unit must be 'kWh'" in e or "Unit must be 'kWh'" in e:
            return TimeseriesIngestErrorCode.INVALID_UNIT

    # Org mismatch is emitted explicitly elsewhere
    return TimeseriesIngestErrorCode.INTERNAL_ERROR


def _normalize_idempotency_key(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _record_model_supports_org() -> bool:
    # Support both historical field names across snapshots
    return hasattr(TimeseriesRecord, "organization_id") or hasattr(TimeseriesRecord, "org_id")


def _record_model_supports_idempotency() -> bool:
    return hasattr(TimeseriesRecord, "idempotency_key")


def _set_org_field(record_kwargs: Dict[str, Any], organization_id: Optional[int]) -> None:
    if organization_id is None:
        return
    if hasattr(TimeseriesRecord, "org_id"):
        record_kwargs["org_id"] = organization_id
        return
    if hasattr(TimeseriesRecord, "organization_id"):
        record_kwargs["organization_id"] = organization_id
        return


def _is_likely_idempotency_integrity_error(exc: IntegrityError) -> bool:
    """
    Best-effort classifier so we don't mislabel *every* IntegrityError as idempotency.
    This is DB-specific, so we use string heuristics.
    """
    msg = str(getattr(exc, "orig", exc)).lower()
    return ("unique" in msg or "duplicate" in msg) and ("idempotency" in msg or "idempotency_key" in msg)


def _idempotency_exists(
    db: Session,
    *,
    organization_id: Optional[int],
    idempotency_key: str,
) -> bool:
    """
    Deterministic idempotency gate.

    - If model supports org scoping: enforce (org_id/organization_id, idempotency_key)
    - Else: enforce global (idempotency_key)
    """
    q = db.query(TimeseriesRecord).filter(TimeseriesRecord.idempotency_key == idempotency_key)

    if organization_id is not None:
        if hasattr(TimeseriesRecord, "org_id"):
            q = q.filter(TimeseriesRecord.org_id == organization_id)  # type: ignore[attr-defined]
        elif hasattr(TimeseriesRecord, "organization_id"):
            q = q.filter(TimeseriesRecord.organization_id == organization_id)  # type: ignore[attr-defined]

    return db.query(q.exists()).scalar() is True


def _build_fallback_idempotency_key(
    *,
    organization_id: Optional[int],
    site_id: str,
    meter_id: str,
    ts: datetime,
) -> str:
    """
    Pilot-grade guardrail:
    If a client doesn't send idempotency_key, we still want deterministic idempotency
    (especially for retrying factory agents).

    Format is stable and aligned with CSV behavior, but distinct:
      auto:<org>:<site>:<meter>:<ts_iso>

    Truncated to 128 chars to match typical DB column limits.
    """
    org_part = str(organization_id) if organization_id is not None else "none"
    ts_norm = ts.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    key = f"auto:{org_part}:{site_id}:{meter_id}:{ts_norm}"
    return key[:128]


def ingest_timeseries_batch(
    records: List[Dict[str, Any]],
    organization_id: Optional[int],
    source: Optional[str] = None,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    """
    Ingest a batch of timeseries records directly into TimeseriesRecord.

    Correctness guardrails (central, applies to ALL ingest paths):
    - timestamp_utc must be timezone-aware UTC ISO8601 (Z or +00:00)
    - reject future timestamps beyond FUTURE_SKEW_SECONDS
    - (optional) reject overly old timestamps beyond MAX_PAST_DAYS
    - value must be numeric, finite, non-negative, and within MAX_VALUE_KWH (optional)
    - unit must be 'kWh' (if provided; case-insensitive accepted + normalized)

    Idempotency guarantee:
    - If TimeseriesRecord supports idempotency_key, we enforce deterministic idempotency.
      If the client provides idempotency_key -> use it.
      Else -> we auto-generate a stable fallback key from (org, site, meter, timestamp).
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

    now_utc = datetime.now(timezone.utc).replace(microsecond=0)

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
            # --- schema/format validation first ---
            ok, errs = validate_batch_record(r)
            if not ok:
                failed += 1
                code_enum = _guess_code_from_validation_errors(errs)
                errors.append({"index": idx, "code": code_enum.value, "detail": "; ".join(errs)})
                continue

            # --- org/site scoping ---
            site_id_str = str(r["site_id"]).strip()
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

            meter_id_str = str(r["meter_id"]).strip()
            if not meter_id_str:
                failed += 1
                errors.append(
                    {
                        "index": idx,
                        "code": TimeseriesIngestErrorCode.INTERNAL_ERROR.value,
                        "detail": "meter_id missing",
                    }
                )
                continue

            # --- correctness parsing (timestamp/value/unit) ---
            unit_canonical = CANONICAL_UNIT_KWH  # default if omitted
            try:
                ts_raw = r.get("timestamp_utc") or r.get("timestamp")
                ts = _parse_timestamp_utc(ts_raw)
                _validate_timestamp_guardrails(ts, now_utc=now_utc)

                v = _parse_value_kwh(r.get("value"))

                # Unit is optional: if provided, accept any casing and normalize to canonical.
                if r.get("unit") is not None and str(r.get("unit")).strip():
                    unit_canonical = normalize_unit(r.get("unit"))
            except Exception as exc:
                failed += 1
                code_enum = _guess_code_from_validation_errors([str(exc)])
                errors.append({"index": idx, "code": code_enum.value, "detail": str(exc)})
                continue

            # --- idempotency key normalization + fallback (pilot guardrail) ---
            idem_key = _normalize_idempotency_key(r.get("idempotency_key"))
            if model_has_idem and not idem_key:
                idem_key = _build_fallback_idempotency_key(
                    organization_id=organization_id,
                    site_id=site_id_str,
                    meter_id=meter_id_str,
                    ts=ts,
                )

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
                    logger.warning("idempotency pre-check failed (idx=%s): %s", idx, exc)

            # --- build ORM row ---
            record_kwargs: Dict[str, Any] = {
                "site_id": site_id_str,
                "meter_id": meter_id_str,
                "value": float(v),
            }

            # timestamp field name drift across snapshots
            if hasattr(TimeseriesRecord, "timestamp_utc"):
                record_kwargs["timestamp_utc"] = ts
            elif hasattr(TimeseriesRecord, "timestamp"):
                record_kwargs["timestamp"] = ts

            if model_has_org:
                _set_org_field(record_kwargs, organization_id)

            record = TimeseriesRecord(**record_kwargs)

            if hasattr(TimeseriesRecord, "unit"):
                setattr(record, "unit", unit_canonical)

            if model_has_idem and idem_key:
                setattr(record, "idempotency_key", idem_key)

            if hasattr(TimeseriesRecord, "source"):
                if source:
                    setattr(record, "source", source)

            # --- insert with integrity handling ---
            try:
                with db.begin_nested():
                    db.add(record)
                    db.flush()
            except IntegrityError as exc:
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
                    {
                        "index": idx,
                        "code": TimeseriesIngestErrorCode.INTERNAL_ERROR.value,
                        "detail": str(exc),
                    }
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
