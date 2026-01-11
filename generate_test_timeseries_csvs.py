# C:\dev\cei-mvp\generate_test_timeseries_csvs.py
# generate_test_timeseries_csvs.py
#
# Generate synthetic hourly timeseries CSVs for CEI:
# - 30 days of data (baseline-friendly)
# - 3 sites: site-30, site-31, site-32
# - 5 multi-site files WITH site_id
# - 5 per-site files WITHOUT site_id PER SITE (so 15 no-site-id files total)
#
# IMPORTANT (prod guardrail):
# CEI rejects timestamps that are in the future (>5m skew).
# This generator therefore:
#   - anchors "NOW" to UTC minus a safety margin
#   - optionally shifts the entire window backward in time (never forward)
#   - can optionally add a deterministic per-run offset to avoid duplicates

from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

# --- CONFIG -----------------------------------------------------------------

DAYS = 30
FILES_PER_MODE = 5

SITES_WITH_IDS = ["site-30", "site-31", "site-32"]
METERS = ["meter-main-1"]
UNIT = "kWh"

OUTPUT_DIR = Path("test_timeseries_data")

# Must be > 5 to clear the backend's "future (>5m skew)" guardrail.
FUTURE_SAFETY_MARGIN_MINUTES = 10

# Shift the generated window by N days.
#  - Positive values would create future timestamps (will FAIL in prod) -> blocked.
#  - Negative values generate older data.
#  - 0 generates a window ending "near now" (minus safety margin).
TIME_SHIFT_DAYS = -40

# Optional deterministic offset (in hours) to make "new" timestamps without going future.
# Applied AFTER TIME_SHIFT_DAYS and still respects future safety margin.
UNIQUE_RUN_OFFSET_HOURS: int = 0

# Reproducible synthetic values
random.seed(42)

# --- TIME WINDOW ------------------------------------------------------------

def _utc_now_floor_hour_with_margin(margin_minutes: int) -> datetime:
    """
    Returns an aware UTC datetime rounded down to the hour, but shifted back by margin_minutes.
    Prevents "future timestamps" failures in production ingestion.
    """
    if margin_minutes < 0:
        raise ValueError("margin_minutes must be >= 0")

    now_utc = datetime.now(timezone.utc) - timedelta(minutes=margin_minutes)
    return now_utc.replace(minute=0, second=0, microsecond=0)


def _compute_now_and_start(
    *,
    days: int,
    time_shift_days: int,
    unique_run_offset_hours: int,
    safety_margin_minutes: int,
) -> tuple[datetime, datetime]:
    """
    Compute the [START, NOW] window.
    - Always uses UTC-aware datetimes.
    - Never allows shifting into the future (positive time_shift_days).
    - Applies safety margin and optional per-run offset without producing future timestamps.
    """
    if time_shift_days > 0:
        raise ValueError(
            f"TIME_SHIFT_DAYS={time_shift_days} would generate future timestamps. "
            "Production ingestion rejects timestamps >5m in the future. "
            "Use 0 or negative values."
        )

    base_now = _utc_now_floor_hour_with_margin(safety_margin_minutes)

    # Apply shifts (still in the past direction)
    now = base_now + timedelta(days=time_shift_days) + timedelta(hours=unique_run_offset_hours)

    # Clamp again to ensure final NOW is not later than base_now (never future relative to margin)
    if now > base_now:
        now = base_now

    start = now - timedelta(days=days)
    return now, start


NOW, START = _compute_now_and_start(
    days=DAYS,
    time_shift_days=TIME_SHIFT_DAYS,
    unique_run_offset_hours=UNIQUE_RUN_OFFSET_HOURS,
    safety_margin_minutes=FUTURE_SAFETY_MARGIN_MINUTES,
)

# --- CORE GENERATION LOGIC --------------------------------------------------

def generate_row(ts: datetime, site_id: str, meter_id: str) -> dict:
    """
    Build a single synthetic reading with:
    - Higher usage during day/evening
    - Lower baseline at night
    - Slightly different scale per site

    `ts` should be UTC-aware; we write it as a naive timestamp string to match CEI CSV format.
    """
    hour = ts.hour

    try:
        site_idx = SITES_WITH_IDS.index(site_id)
    except ValueError:
        site_idx = 0

    base = 600 + site_idx * 150  # site-30 < site-31 < site-32

    if 8 <= hour < 18:
        level = base * random.uniform(0.9, 1.3)
    elif 18 <= hour < 22:
        level = base * random.uniform(1.0, 1.5)
    else:
        level = base * random.uniform(0.10, 0.25)

    return {
        # Backend treats this as UTC in your ingestion flow.
        "timestamp": ts.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        "value": round(level, 1),
        "unit": UNIT,
        "site_id": site_id,
        "meter_id": meter_id,
    }

# --- WRITERS ----------------------------------------------------------------

def _slice_bounds(file_idx: int, slice_len_days: int) -> tuple[datetime, datetime]:
    slice_start = START + timedelta(days=file_idx * slice_len_days)
    slice_end = slice_start + timedelta(days=slice_len_days)

    if slice_start >= NOW:
        return NOW, NOW
    if slice_end > NOW:
        slice_end = NOW

    return slice_start, slice_end


def write_with_site_ids() -> None:
    """
    Generate FILES_PER_MODE CSV files that INCLUDE site_id.
    Each file contains ALL sites for its time slice.
    """
    slice_len_days = max(1, DAYS // FILES_PER_MODE)

    for file_idx in range(FILES_PER_MODE):
        slice_start, slice_end = _slice_bounds(file_idx, slice_len_days)
        if slice_start >= slice_end:
            break

        fname = OUTPUT_DIR / f"cei_timeseries_with_siteids_slice{file_idx + 1}.csv"
        print(f"[with_site_id] Writing {fname} ({slice_start.isoformat()} → {slice_end.isoformat()})")

        with fname.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["timestamp", "value", "unit", "site_id", "meter_id"],
            )
            writer.writeheader()

            ts = slice_start
            while ts < slice_end:
                for site_id in SITES_WITH_IDS:
                    for meter_id in METERS:
                        writer.writerow(generate_row(ts, site_id, meter_id))
                ts += timedelta(hours=1)


def write_without_site_ids() -> None:
    """
    Generate FILES_PER_MODE CSV files that OMIT site_id PER SITE.
    Result: (len(SITES_WITH_IDS) * FILES_PER_MODE) files total.
    """
    slice_len_days = max(1, DAYS // FILES_PER_MODE)

    for site_id in SITES_WITH_IDS:
        for file_idx in range(FILES_PER_MODE):
            slice_start, slice_end = _slice_bounds(file_idx, slice_len_days)
            if slice_start >= slice_end:
                break

            fname = OUTPUT_DIR / f"cei_timeseries_no_siteid_{site_id}_slice{file_idx + 1}.csv"
            print(f"[no_site_id]  Writing {fname} for {site_id} ({slice_start.isoformat()} → {slice_end.isoformat()})")

            with fname.open("w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(
                    f,
                    fieldnames=["timestamp", "value", "unit", "meter_id"],
                )
                writer.writeheader()

                ts = slice_start
                while ts < slice_end:
                    for meter_id in METERS:
                        row = generate_row(ts, site_id, meter_id)
                        row.pop("site_id", None)
                        writer.writerow(row)
                    ts += timedelta(hours=1)

# --- MAIN -------------------------------------------------------------------

def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    print(f"Generating synthetic timeseries CSVs into: {OUTPUT_DIR.resolve()}")
    print(f"Time window (UTC): {START.isoformat()} → {NOW.isoformat()} ({DAYS} days, hourly)")
    print(f"Safety margin: {FUTURE_SAFETY_MARGIN_MINUTES} minutes")
    print(f"TIME_SHIFT_DAYS: {TIME_SHIFT_DAYS} (must be <= 0)")
    print(f"UNIQUE_RUN_OFFSET_HOURS: {UNIQUE_RUN_OFFSET_HOURS}")
    print(f"Sites: {SITES_WITH_IDS} | Files per mode: {FILES_PER_MODE}")

    write_with_site_ids()
    write_without_site_ids()

    print("Done.")
    print("Upload the 'with_siteids' files via the generic upload endpoint,")
    print("and the 'no_siteid_...' files via per-site /upload?site_id=... endpoints.")


if __name__ == "__main__":
    main()
