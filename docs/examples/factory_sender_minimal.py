#!/usr/bin/env python3
"""
CEI Minimal Factory Sender (Pilot-grade)
- Sends timeseries batches to CEI: POST /timeseries/batch
- Uses deterministic per-record idempotency_key for safe retries
- Spools unsent payloads to disk and replays later
- Retries with exponential backoff on 429/5xx/timeouts

Modes:
  - csv:  reads a CSV with columns:
          site_id,meter_id,timestamp_utc,value,unit
  - ramp: generates synthetic hourly data for a window

Environment variables:
  CEI_BASE_URL   e.g. https://api.carbonefficiencyintel.com/api/v1
  CEI_TOKEN      integration token (Bearer)
Optional env:
  CEI_SPOOL_DIR  default: ./cei_spool
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import random
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests


# -----------------------------
# Helpers
# -----------------------------

def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_iso_utc(ts: str) -> dt.datetime:
    # Accept "...Z" or "+00:00"
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return dt.datetime.fromisoformat(ts).astimezone(dt.timezone.utc)


def iso_z(d: dt.datetime) -> str:
    d = d.astimezone(dt.timezone.utc)
    # Keep seconds; strip microseconds
    d = d.replace(microsecond=0)
    return d.isoformat().replace("+00:00", "Z")


def deterministic_idempotency_key(site_id: str, meter_id: str, timestamp_utc: str) -> str:
    # Human-readable deterministic key. Keep stable.
    return f"{site_id}|{meter_id}|{timestamp_utc}"


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def chunked(lst: List[Any], size: int) -> List[List[Any]]:
    return [lst[i:i + size] for i in range(0, len(lst), size)]


# -----------------------------
# Data model
# -----------------------------

@dataclass
class Record:
    site_id: str
    meter_id: str
    timestamp_utc: str
    value: float
    unit: str

    def to_api(self) -> Dict[str, Any]:
        ik = deterministic_idempotency_key(self.site_id, self.meter_id, self.timestamp_utc)
        return {
            "site_id": self.site_id,
            "meter_id": self.meter_id,
            "timestamp_utc": self.timestamp_utc,
            "value": float(self.value),
            "unit": self.unit,
            "idempotency_key": ik,
        }


# -----------------------------
# Spool
# -----------------------------

def spool_write(spool_dir: str, payload: Dict[str, Any]) -> str:
    ensure_dir(spool_dir)
    stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    suffix = uuid.uuid4().hex[:8]
    path = os.path.join(spool_dir, f"batch_{stamp}_{suffix}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    return path


def spool_list(spool_dir: str) -> List[str]:
    if not os.path.isdir(spool_dir):
        return []
    files = [os.path.join(spool_dir, f) for f in os.listdir(spool_dir) if f.endswith(".json")]
    files.sort()
    return files


def spool_read(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def spool_delete(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


# -----------------------------
# HTTP client
# -----------------------------

def post_batch(
    base_url: str,
    token: str,
    payload: Dict[str, Any],
    timeout_s: int,
) -> Tuple[bool, str]:
    """
    Returns: (ok, message)
    ok=True means payload can be removed from spool.

    CEI may return HTTP 200 even when some records failed; we treat failed>0 as fatal
    so pilot ops never silently succeed.
    """
    url = base_url.rstrip("/") + "/timeseries/batch"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        r = requests.post(url, headers=headers, json=payload, timeout=timeout_s)
    except requests.RequestException as e:
        return False, f"network_error: {e}"

    resp_text = r.text or ""
    resp_json = None
    try:
        resp_json = r.json()
    except Exception:
        resp_json = None

    if 200 <= r.status_code < 300:
        if isinstance(resp_json, dict):
            ing = resp_json.get("ingested")
            skp = resp_json.get("skipped_duplicate")
            fail = resp_json.get("failed")
            errs = resp_json.get("errors")

            summary = f"ingested={ing} skipped_duplicate={skp} failed={fail}"

            # Fail-fast if any record failed (operator must fix inputs)
            if isinstance(fail, int) and fail > 0:
                return False, f"fatal_ingest_failed_records: {summary} errors={json.dumps(errs)[:1500]}"

            return True, f"ok: {r.status_code} {summary}"

        return True, f"ok: {r.status_code} {resp_text[:1000]}"

    # Retryable (rate limits / server errors)
    if r.status_code == 429 or 500 <= r.status_code < 600:
        body = json.dumps(resp_json) if resp_json is not None else resp_text
        return False, f"retryable_http_{r.status_code}: {body[:1500]}"

    # Fatal (validation/auth)
    body = json.dumps(resp_json) if resp_json is not None else resp_text
    return False, f"fatal_http_{r.status_code}: {body[:1500]}"


def retry_send(
    base_url: str,
    token: str,
    payload: Dict[str, Any],
    timeout_s: int,
    max_attempts: int,
    base_backoff_s: float,
    max_backoff_s: float,
) -> Tuple[bool, str]:
    attempt = 0
    while True:
        attempt += 1
        ok, msg = post_batch(base_url, token, payload, timeout_s=timeout_s)

        if ok:
            return True, msg

        # Fatal means: stop retrying this payload forever.
        if msg.startswith("fatal_http_") or msg.startswith("fatal_ingest_failed_records"):
            return False, msg

        if attempt >= max_attempts:
            return False, f"exhausted_attempts: {msg}"

        sleep_s = min(max_backoff_s, base_backoff_s * (2 ** (attempt - 1)))
        jitter = random.uniform(0, 0.25 * sleep_s)
        time.sleep(sleep_s + jitter)


# -----------------------------
# Modes
# -----------------------------

def load_records_from_csv(path: str) -> List[Record]:
    records: List[Record] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"site_id", "meter_id", "timestamp_utc", "value", "unit"}
        missing = required - set((reader.fieldnames or []))
        if missing:
            raise ValueError(f"CSV missing columns: {sorted(missing)}. Found: {reader.fieldnames}")

        for _, row in enumerate(reader, start=1):
            ts = row["timestamp_utc"].strip()
            ts_norm = iso_z(parse_iso_utc(ts))
            records.append(
                Record(
                    site_id=row["site_id"].strip(),
                    meter_id=row["meter_id"].strip(),
                    timestamp_utc=ts_norm,
                    value=float(row["value"]),
                    unit=row["unit"].strip(),
                )
            )
    return records


def generate_ramp_records(
    site_id: str,
    meter_id: str,
    unit: str,
    hours: int,
    start_utc: Optional[str],
    base_value: float,
    noise_pct: float,
) -> List[Record]:
    if start_utc:
        start = parse_iso_utc(start_utc)
    else:
        now = utc_now().replace(minute=0, second=0, microsecond=0)
        start = now - dt.timedelta(hours=hours)

    out: List[Record] = []
    for h in range(hours):
        t = start + dt.timedelta(hours=h)
        hour = t.hour
        day_factor = 1.15 if 7 <= hour <= 18 else 0.85
        val = base_value * day_factor
        val *= 1.0 + random.uniform(-noise_pct, noise_pct) / 100.0
        out.append(
            Record(
                site_id=site_id,
                meter_id=meter_id,
                timestamp_utc=iso_z(t),
                value=val,
                unit=unit,
            )
        )
    return out


# -----------------------------
# Main
# -----------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["csv", "ramp"], required=True)

    parser.add_argument("--base-url", default=os.getenv("CEI_BASE_URL", "").strip())
    parser.add_argument("--token", default=os.getenv("CEI_TOKEN", "").strip())
    parser.add_argument("--spool-dir", default=os.getenv("CEI_SPOOL_DIR", "./cei_spool"))

    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--timeout-s", type=int, default=30)
    parser.add_argument("--max-attempts", type=int, default=6)
    parser.add_argument("--base-backoff-s", type=float, default=1.5)
    parser.add_argument("--max-backoff-s", type=float, default=60.0)

    # csv mode
    parser.add_argument("--csv-path", default="")

    # ramp mode
    parser.add_argument("--site-id", default="")
    parser.add_argument("--meter-id", default="main")
    parser.add_argument("--unit", default="kWh")  # IMPORTANT: CEI validates exact casing
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--start-utc", default="")
    parser.add_argument("--base-value", type=float, default=120.0)
    parser.add_argument("--noise-pct", type=float, default=5.0)

    args = parser.parse_args()

    if not args.base_url:
        print("ERROR: CEI_BASE_URL missing (env or --base-url).", file=sys.stderr)
        return 2
    if not args.token:
        print("ERROR: CEI_TOKEN missing (env or --token).", file=sys.stderr)
        return 2

    # 1) Replay spooled batches first (oldest first)
    spooled = spool_list(args.spool_dir)
    if spooled:
        print(f"[spool] replaying {len(spooled)} file(s) from {args.spool_dir}")
    for path in spooled:
        payload = spool_read(path)
        ok, msg = retry_send(
            args.base_url, args.token, payload,
            timeout_s=args.timeout_s,
            max_attempts=args.max_attempts,
            base_backoff_s=args.base_backoff_s,
            max_backoff_s=args.max_backoff_s,
        )
        if ok:
            spool_delete(path)
            print(f"[spool] sent+deleted {os.path.basename(path)} ({msg})")
        else:
            print(f"[spool] FAILED {os.path.basename(path)} ({msg})")
            print("[spool] stopping replay; will try again next run.")
            return 1

    # 2) Build new records
    records: List[Record] = []
    if args.mode == "csv":
        if not args.csv_path:
            print("ERROR: --csv-path required for mode=csv", file=sys.stderr)
            return 2
        records = load_records_from_csv(args.csv_path)
        print(f"[csv] loaded {len(records)} record(s) from {args.csv_path}")

    if args.mode == "ramp":
        if not args.site_id:
            print("ERROR: --site-id required for mode=ramp", file=sys.stderr)
            return 2
        records = generate_ramp_records(
            site_id=args.site_id,
            meter_id=args.meter_id,
            unit=args.unit,
            hours=args.hours,
            start_utc=args.start_utc or None,
            base_value=args.base_value,
            noise_pct=args.noise_pct,
        )
        print(f"[ramp] generated {len(records)} record(s) for {args.site_id}/{args.meter_id}")

    # 3) Send in batches; spool any batch that can’t be delivered
    api_records = [r.to_api() for r in records]
    batches = chunked(api_records, args.batch_size)

    sent = 0
    spooled_new = 0

    for b in batches:
        payload = {"records": b}
        ok, msg = retry_send(
            args.base_url, args.token, payload,
            timeout_s=args.timeout_s,
            max_attempts=args.max_attempts,
            base_backoff_s=args.base_backoff_s,
            max_backoff_s=args.max_backoff_s,
        )
        if ok:
            sent += len(b)
            print(f"[send] ok batch size={len(b)} ({msg})")
        else:
            path = spool_write(args.spool_dir, payload)
            spooled_new += 1
            print(f"[send] FAILED -> spooled {os.path.basename(path)} ({msg})")

            if msg.startswith("fatal_http_") or msg.startswith("fatal_ingest_failed_records"):
                print("[send] fatal error; stopping.")
                break

    print(f"[done] sent={sent} spooled_new={spooled_new} spool_dir={args.spool_dir}")
    return 0 if spooled_new == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
