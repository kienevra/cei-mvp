"""
Simple CEI factory client for pushing timeseries batches into CEI.

Usage (from PowerShell, with env vars set):

  # Ramp/synthetic mode (current behavior):
  $env:CEI_BASE_URL = "https://cei-mvp.onrender.com"
  $env:CEI_INT_TOKEN = "cei_int_...."
  python .\docs\factory_client.py site-22 main-incomer 24

  # CSV mode (new):
  python .\docs\factory_client.py site-22 main-incomer 24 --csv "C:\path\to\scada_export.csv"

CSV expectations (flexible, but minimum is):
  - timestamp_utc  (ISO8601-like, e.g. 2025-12-05T10:00:00Z)
  - value          (numeric)

Optional columns:
  - site_id        (if present, overrides CLI site_id)
  - meter_id       (if present, overrides CLI meter_id)
  - unit           (defaults to "kWh" if missing)
  - idempotency_key (if present, used as-is)
"""

import csv
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

import requests
from requests import RequestException

logger = logging.getLogger("cei.factory_client")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# --- Tunables for flaky networks / slow cold starts ---

HTTP_TIMEOUT_SECONDS = float(os.getenv("CEI_HTTP_TIMEOUT", "60"))  # was 15
HTTP_MAX_RETRIES = int(os.getenv("CEI_HTTP_RETRIES", "3"))
HTTP_RETRY_SLEEP_SECONDS = float(os.getenv("CEI_HTTP_RETRY_SLEEP", "5"))


def build_ramp_records(
    site_id: str,
    meter_id: str,
    hours_back: int,
    base_value: float = 150.0,
) -> List[Dict[str, Any]]:
    """
    Build a simple ramp profile for the last N hours.
    """
    records: List[Dict[str, Any]] = []
    now = datetime.utcnow()

    for i in range(hours_back):
        ts = now - timedelta(hours=i)
        ts_iso = ts.replace(minute=0, second=0, microsecond=0).isoformat() + "Z"
        value = base_value + i

        records.append(
            {
                "site_id": site_id,
                "meter_id": meter_id,
                "timestamp_utc": ts_iso,
                "value": value,
                "unit": "kWh",
                "idempotency_key": f"factory-{site_id}-{meter_id}-{ts_iso}",
            }
        )

    return records


def _parse_timestamp_utc(raw: str) -> Optional[datetime]:
    """
    Parse a timestamp from CSV into a naive UTC datetime.

    Assumes ISO8601-like input. Examples:
      - 2025-12-05T10:00:00Z
      - 2025-12-05T10:00:00
    """
    if not raw:
        return None
    raw = raw.strip()
    if raw.endswith("Z"):
        raw = raw[:-1]
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def build_records_from_csv(
    csv_path: str,
    default_site_id: str,
    default_meter_id: str,
    hours_back: int,
) -> List[Dict[str, Any]]:
    """
    Build records from a CSV file for the last N hours.

    - If the CSV has site_id/meter_id columns, they override the CLI defaults.
    - Only rows whose timestamp_utc is within the last `hours_back` are used.
    """
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=hours_back)

    records: List[Dict[str, Any]] = []
    total_rows = 0
    used_rows = 0
    skipped_rows = 0

    logger.info("Loading CSV: %s", csv_path)

    try:
        with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                logger.error("CSV has no header row – aborting.")
                raise SystemExit(1)

            for row in reader:
                total_rows += 1

                raw_ts = (
                    row.get("timestamp_utc")
                    or row.get("timestamp")
                    or row.get("ts")
                )
                ts = _parse_timestamp_utc(raw_ts or "")
                if ts is None:
                    skipped_rows += 1
                    logger.debug(
                        "Skipping row %d: invalid timestamp %r", total_rows, raw_ts
                    )
                    continue

                if ts < cutoff:
                    # older than requested window
                    skipped_rows += 1
                    continue

                raw_value = row.get("value")
                try:
                    value = float(raw_value)
                except (TypeError, ValueError):
                    skipped_rows += 1
                    logger.debug(
                        "Skipping row %d: invalid value %r", total_rows, raw_value
                    )
                    continue

                site_id = (row.get("site_id") or default_site_id or "").strip()
                meter_id = (row.get("meter_id") or default_meter_id or "").strip()
                unit = (row.get("unit") or "kWh").strip() or "kWh"

                ts_iso = ts.isoformat() + "Z"

                idem = row.get("idempotency_key")
                if not idem:
                    idem = f"csv-{site_id}-{meter_id}-{ts_iso}-{value}"

                record = {
                    "site_id": site_id,
                    "meter_id": meter_id,
                    "timestamp_utc": ts_iso,
                    "value": value,
                    "unit": unit,
                    "idempotency_key": idem,
                }
                records.append(record)
                used_rows += 1

    except FileNotFoundError:
        logger.error("CSV file not found: %s", csv_path)
        raise SystemExit(1)

    logger.info(
        "CSV rows: total=%d used=%d skipped=%d (window=%d hours)",
        total_rows,
        used_rows,
        skipped_rows,
        hours_back,
    )

    if not records:
        logger.error("No usable rows found in CSV within the last %d hours.", hours_back)
        raise SystemExit(1)

    return records


def send_batch(
    base_url: str,
    token: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    POST the batch to CEI with retries and a generous timeout.
    """
    url = base_url.rstrip("/") + "/api/v1/timeseries/batch"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    logger.info(
        "Sending batch to %s (records=%d, source=%s)",
        url,
        len(payload.get("records", [])),
        payload.get("source"),
    )

    last_exc: Exception | None = None

    for attempt in range(1, HTTP_MAX_RETRIES + 1):
        try:
            resp = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=HTTP_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info(
                "CEI batch result: ingested=%s skipped_duplicate=%s failed=%s",
                data.get("ingested"),
                data.get("skipped_duplicate"),
                data.get("failed"),
            )
            return data
        except RequestException as exc:
            last_exc = exc
            logger.warning(
                "Attempt %d/%d failed talking to CEI: %s",
                attempt,
                HTTP_MAX_RETRIES,
                exc,
            )
            if attempt < HTTP_MAX_RETRIES:
                time.sleep(HTTP_RETRY_SLEEP_SECONDS)

    logger.error("Error sending batch after %d attempts: %s", HTTP_MAX_RETRIES, last_exc)
    raise SystemExit(2)


def main() -> None:
    # CLI shapes:
    #   1) Ramp mode (existing):
    #      python factory_client.py <site_id> <meter_id> <hours_back>
    #
    #   2) CSV mode (new):
    #      python factory_client.py <site_id> <meter_id> <hours_back> --csv <path>
    #
    if len(sys.argv) not in (4, 6):
        print(
            "Usage:\n"
            "  python factory_client.py <site_id> <meter_id> <hours_back>\n"
            "  python factory_client.py <site_id> <meter_id> <hours_back> --csv <path>",
            file=sys.stderr,
        )
        raise SystemExit(1)

    site_id = sys.argv[1]
    meter_id = sys.argv[2]
    hours_back = int(sys.argv[3])

    csv_path: Optional[str] = None
    if len(sys.argv) == 6:
        flag = sys.argv[4]
        csv_arg = sys.argv[5]
        if flag != "--csv":
            print(
                f"Unknown flag: {flag}\n"
                "Expected:\n"
                "  python factory_client.py <site_id> <meter_id> <hours_back> --csv <path>",
                file=sys.stderr,
            )
            raise SystemExit(1)
        csv_path = csv_arg

    base_url = os.getenv("CEI_BASE_URL")
    token = os.getenv("CEI_INT_TOKEN")

    if not base_url:
        print("CEI_BASE_URL env var is required", file=sys.stderr)
        raise SystemExit(1)

    if not token or not token.startswith("cei_int_"):
        print(
            "CEI_INT_TOKEN env var is required and must start with 'cei_int_'",
            file=sys.stderr,
        )
        raise SystemExit(1)

    print("=== CEI Python factory client ===")
    print(f"Base URL : {base_url}")
    print(f"Site ID  : {site_id}")
    print(f"Meter ID : {meter_id}")
    print(f"Hours    : {hours_back}")
    if csv_path:
        print(f"CSV     : {csv_path}")

    if csv_path:
        records = build_records_from_csv(
            csv_path=csv_path,
            default_site_id=site_id,
            default_meter_id=meter_id,
            hours_back=hours_back,
        )
        source = f"csv-{os.path.basename(csv_path) or site_id}"
    else:
        records = build_ramp_records(
            site_id=site_id,
            meter_id=meter_id,
            hours_back=hours_back,
        )
        source = f"sample-ramp-{site_id}"

    payload = {
        "records": records,
        "source": source,
    }

    result = send_batch(base_url=base_url, token=token, payload=payload)
    print("Batch result:", result)


if __name__ == "__main__":
    main()
