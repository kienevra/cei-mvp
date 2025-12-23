# generate_test_timeseries_csvs.py
#
# Generate synthetic hourly timeseries CSVs for CEI:
# - 30 days of data (baseline-friendly)
# - 3 sites: site-19, site-20, site-21
# - 5 multi-site files WITH site_id
# - 5 per-site files WITHOUT site_id (for scoped /upload?site_id=... uploads)

from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

# --- CONFIG -----------------------------------------------------------------

DAYS = 30                   # <- increased from 5 to 30 days
FILES_PER_MODE = 5          # 5 with site_id, 5 without
SITES_WITH_IDS = ["site-1", "site-2", "site-23"]
METERS = ["meter-main-1"]   # keep simple; can add more if needed
UNIT = "kWh"

OUTPUT_DIR = Path("test_timeseries_data")

# Fix seed for reproducible values
random.seed(42)

# End at the current (UTC) hour, start DAYS back
NOW = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
START = NOW - timedelta(days=DAYS)


# --- CORE GENERATION LOGIC --------------------------------------------------

def generate_row(ts: datetime, site_id: str, meter_id: str) -> dict:
  """
  Build a single synthetic reading with:
  - Higher usage during day/evening
  - Lower baseline at night
  - Slightly different scale per site
  """
  hour = ts.hour

  # Different base intensity per site (index 0,1,2...)
  try:
    site_idx = SITES_WITH_IDS.index(site_id)
  except ValueError:
    site_idx = 0

  base = 600 + site_idx * 150  # site-19 < site-20 < site-21

  if 8 <= hour < 18:
    # daytime production window
    level = base * random.uniform(0.9, 1.3)
  elif 18 <= hour < 22:
    # evening / peak
    level = base * random.uniform(1.0, 1.5)
  else:
    # night baseline / idle losses
    level = base * random.uniform(0.10, 0.25)

  return {
    "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
    "value": round(level, 1),
    "unit": UNIT,
    "site_id": site_id,
    "meter_id": meter_id,
  }


def write_with_site_ids() -> None:
  """
  Generate FILES_PER_MODE CSV files that INCLUDE site_id.

  We slice the 30-day window into FILES_PER_MODE equal chunks.
  Upload all 5 and you’ll have a continuous 30-day history for
  site-19/20/21 with site_id present in the rows.
  """
  slice_len_days = DAYS // FILES_PER_MODE  # 30 / 5 = 6 days per file

  for file_idx in range(FILES_PER_MODE):
    slice_start = START + timedelta(days=file_idx * slice_len_days)
    slice_end = slice_start + timedelta(days=slice_len_days)

    fname = OUTPUT_DIR / f"cei_timeseries_with_siteids_slice{file_idx + 1}.csv"
    print(f"[with_site_id] Writing {fname} ({slice_start} → {slice_end})")

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
  Generate FILES_PER_MODE CSV files that OMIT site_id in the data.

  Each file is dedicated to one site (for per-site uploads):
  - Use filename to decide which site page to upload to
  - Backend `POST /upload-csv?site_id=site-XX` will route all rows there
  """
  slice_len_days = DAYS // FILES_PER_MODE  # 30 / 5 = 6 days per file

  for file_idx in range(FILES_PER_MODE):
    # Rotate sites for the no-site_id files
    site_id = SITES_WITH_IDS[file_idx % len(SITES_WITH_IDS)]
    slice_start = START + timedelta(days=file_idx * slice_len_days)
    slice_end = slice_start + timedelta(days=slice_len_days)

    # Make the target site explicit in the filename
    fname = OUTPUT_DIR / f"cei_timeseries_no_siteid_{site_id}_slice{file_idx + 1}.csv"
    print(f"[no_site_id]  Writing {fname} for {site_id} ({slice_start} → {slice_end})")

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
          # Drop site_id for this mode
          row.pop("site_id", None)
          writer.writerow(row)
        ts += timedelta(hours=1)


# --- MAIN -------------------------------------------------------------------

def main() -> None:
  OUTPUT_DIR.mkdir(exist_ok=True)
  print(f"Generating synthetic timeseries CSVs into: {OUTPUT_DIR.resolve()}")
  print(f"Time window: {START} → {NOW} ({DAYS} days, hourly)")

  write_with_site_ids()
  write_without_site_ids()

  print("Done. Upload the 'with_siteids' files via the generic upload,")
  print("and the 'no_siteid_...' files via per-site /upload?site_id=... endpoints.")


if __name__ == "__main__":
  main()


#to generate data, in powershell, run:
## From your repo root (where generate_test_timeseries_csvs.py lives)
#python .\generate_test_timeseries_csvs.py
