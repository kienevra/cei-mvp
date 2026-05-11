# backend/app/services/production_correlation.py
"""
Production Correlation Service
-------------------------------
Computes kWh per unit produced — the ISO 50001 energy intensity metric.

Two public functions:
  ingest_production_csv()      — parse + upsert a CSV into production_record
  get_production_correlation() — join energy + production data, return daily
                                 kWh/unit, trend, and anomalies
"""
from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Dict, List, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.models import ProductionRecord, TimeseriesRecord

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REQUIRED_CSV_COLUMNS = {"date", "units_produced"}
ANOMALY_ZSCORE_THRESHOLD = 1.5   # flag days > mean + 1.5σ kWh/unit
MIN_DAYS_FOR_TREND = 3           # minimum coverage days before we compute slope


# ---------------------------------------------------------------------------
# Result dataclasses (pure Python — no Pydantic in the service layer)
# ---------------------------------------------------------------------------

@dataclass
class CorrelationDay:
    date: date
    kwh: float
    units_produced: float
    kwh_per_unit: float
    unit_label: str
    is_anomaly: bool = False
    anomaly_reason: Optional[str] = None


@dataclass
class CorrelationResult:
    site_id: int
    start: date
    end: date
    unit_label: str
    days: List[CorrelationDay]
    trend_slope: Optional[float]        # kWh/unit change per day (negative = improving)
    trend_direction: str                # "improving" | "worsening" | "stable" | "insufficient_data"
    mean_kwh_per_unit: Optional[float]
    best_day: Optional[CorrelationDay]  # lowest kWh/unit (most efficient)
    worst_day: Optional[CorrelationDay] # highest kWh/unit (least efficient)
    anomaly_count: int
    coverage_days: int                  # days with BOTH energy + production data
    total_days_requested: int


@dataclass
class IngestResult:
    inserted: int
    updated: int
    skipped: int
    errors: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# CSV Ingestion
# ---------------------------------------------------------------------------

def ingest_production_csv(
    db: Session,
    organization_id: int,
    site_id: int,
    file_bytes: bytes,
) -> IngestResult:
    """
    Parse and upsert a production CSV into the production_record table.

    Expected CSV columns:
      date            — ISO 8601  (YYYY-MM-DD)          [required]
      units_produced  — positive float                   [required]
      unit_label      — string e.g. "tonnes", "pezzi"   [optional, default: "units"]
      notes           — free text                        [optional]

    Conflict behaviour (site_id, date unique):
      existing row → update units_produced, unit_label, notes
      new row      → insert

    Returns an IngestResult with counts and any per-row error messages.
    """
    inserted = updated = skipped = 0
    errors: List[str] = []

    # --- Decode ---
    try:
        text = file_bytes.decode("utf-8-sig")  # strip BOM if Excel-exported
    except UnicodeDecodeError:
        return IngestResult(0, 0, 0, ["File is not valid UTF-8. Save as UTF-8 CSV and retry."])

    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        return IngestResult(0, 0, 0, ["CSV file is empty or missing a header row."])

    # Normalize headers (strip whitespace, lowercase)
    headers = {h.strip().lower() for h in reader.fieldnames if h}
    missing = REQUIRED_CSV_COLUMNS - headers
    if missing:
        return IngestResult(
            0, 0, 0,
            [f"Missing required column(s): {', '.join(sorted(missing))}. "
             f"Expected: date, units_produced"],
        )

    for row_num, raw_row in enumerate(reader, start=2):
        row: Dict[str, str] = {
            k.strip().lower(): (v.strip() if v else "")
            for k, v in raw_row.items()
            if k
        }

        # --- Validate date ---
        raw_date = row.get("date", "")
        try:
            record_date = date.fromisoformat(raw_date)
        except ValueError:
            errors.append(f"Row {row_num}: invalid date '{raw_date}' — use YYYY-MM-DD.")
            skipped += 1
            continue

        # --- Validate units_produced ---
        raw_units = row.get("units_produced", "")
        try:
            units = float(raw_units)
            if units < 0:
                raise ValueError("negative value")
        except ValueError:
            errors.append(
                f"Row {row_num}: invalid units_produced '{raw_units}' — must be a non-negative number."
            )
            skipped += 1
            continue

        unit_label: str = row.get("unit_label") or "units"
        notes: Optional[str] = row.get("notes") or None

        # --- Upsert ---
        existing = (
            db.query(ProductionRecord)
            .filter(
                ProductionRecord.site_id == site_id,
                ProductionRecord.date == record_date,
            )
            .first()
        )

        if existing:
            existing.units_produced = units
            existing.unit_label = unit_label
            existing.notes = notes
            updated += 1
        else:
            db.add(
                ProductionRecord(
                    organization_id=organization_id,
                    site_id=site_id,
                    date=record_date,
                    units_produced=units,
                    unit_label=unit_label,
                    notes=notes,
                )
            )
            inserted += 1

    # --- Commit ---
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("production_csv: commit failed org=%s site=%s", organization_id, site_id)
        return IngestResult(0, 0, skipped, [f"Database error during commit: {exc}"])

    logger.info(
        "production_csv: org=%s site=%s inserted=%s updated=%s skipped=%s errors=%s",
        organization_id, site_id, inserted, updated, skipped, len(errors),
    )
    return IngestResult(inserted=inserted, updated=updated, skipped=skipped, errors=errors)


# ---------------------------------------------------------------------------
# Correlation Query
# ---------------------------------------------------------------------------

def get_production_correlation(
    db: Session,
    organization_id: int,
    site_id: int,  # integer Site.id
    start: date,
    end: date,
) -> CorrelationResult:
    """
    Compute daily kWh/unit for a site over the requested date range.

    Energy source  → TimeseriesRecord  (site_id string key: "site-{id}")
    Production src → ProductionRecord  (site_id integer FK)

    Only days that have BOTH energy readings and a production record are
    included in the output. Days with zero units_produced are excluded
    (avoids division by zero and distorts the metric).

    Anomaly signals:
      1. Statistical  — kWh/unit > mean + 1.5σ
      2. Directional  — energy increased day-over-day while production fell

    Trend:
      Linear regression (numpy.polyfit) on kWh/unit over the coverage window.
      Classified as improving / stable / worsening relative to the mean.
    """
    ts_site_key = f"site-{site_id}"
    total_days = (end - start).days + 1

    start_dt = datetime.combine(start, datetime.min.time())
    end_dt = datetime.combine(end, datetime.max.time())

    # --- Fetch production records ---
    production_rows: List[ProductionRecord] = (
        db.query(ProductionRecord)
        .filter(
            ProductionRecord.organization_id == organization_id,
            ProductionRecord.site_id == site_id,
            ProductionRecord.date >= start,
            ProductionRecord.date <= end,
        )
        .order_by(ProductionRecord.date)
        .all()
    )

    _empty = CorrelationResult(
        site_id=site_id,
        start=start,
        end=end,
        unit_label="units",
        days=[],
        trend_slope=None,
        trend_direction="insufficient_data",
        mean_kwh_per_unit=None,
        best_day=None,
        worst_day=None,
        anomaly_count=0,
        coverage_days=0,
        total_days_requested=total_days,
    )

    if not production_rows:
        return _empty

    unit_label = production_rows[0].unit_label
    prod_by_date: Dict[date, ProductionRecord] = {r.date: r for r in production_rows}

    # --- Fetch timeseries and aggregate to daily kWh ---
    ts_rows: List[TimeseriesRecord] = (
        db.query(TimeseriesRecord)
        .filter(
            TimeseriesRecord.organization_id == organization_id,
            TimeseriesRecord.site_id == ts_site_key,
            TimeseriesRecord.timestamp >= start_dt,
            TimeseriesRecord.timestamp <= end_dt,
        )
        .all()
    )

    daily_kwh: Dict[date, float] = {}
    for ts in ts_rows:
        d = ts.timestamp.date()
        daily_kwh[d] = daily_kwh.get(d, 0.0) + float(ts.value)

    # --- Build correlation days ---
    days: List[CorrelationDay] = []
    for d in sorted(prod_by_date.keys()):
        prod = prod_by_date[d]

        if d not in daily_kwh:
            continue  # no energy data for this day

        if prod.units_produced <= 0:
            continue  # zero production — metric undefined

        kwh = daily_kwh[d]
        kwh_per_unit = kwh / prod.units_produced

        days.append(
            CorrelationDay(
                date=d,
                kwh=round(kwh, 3),
                units_produced=prod.units_produced,
                kwh_per_unit=round(kwh_per_unit, 4),
                unit_label=prod.unit_label,
            )
        )

    if not days:
        _empty.unit_label = unit_label
        return _empty

    # --- Statistical anomaly detection ---
    kpu_values = np.array([d.kwh_per_unit for d in days], dtype=float)
    mean_kpu = float(np.mean(kpu_values))
    std_kpu = float(np.std(kpu_values)) if len(kpu_values) > 1 else 0.0
    anomaly_threshold = mean_kpu + ANOMALY_ZSCORE_THRESHOLD * std_kpu

    for day in days:
        if std_kpu > 0 and day.kwh_per_unit > anomaly_threshold:
            day.is_anomaly = True
            day.anomaly_reason = (
                f"kWh/{day.unit_label} ({day.kwh_per_unit:.3f}) exceeds "
                f"mean + 1.5σ threshold ({anomaly_threshold:.3f})."
            )

    # --- Directional anomaly: energy up, production down vs prior day ---
    for i in range(1, len(days)):
        prev, curr = days[i - 1], days[i]
        if curr.kwh > prev.kwh and curr.units_produced < prev.units_produced:
            curr.is_anomaly = True
            directional_note = "Energy increased while production fell."
            curr.anomaly_reason = (
                f"{curr.anomaly_reason} {directional_note}"
                if curr.anomaly_reason
                else directional_note
            )

    anomaly_count = sum(1 for d in days if d.is_anomaly)

    # --- Trend: linear regression ---
    trend_slope: Optional[float] = None
    trend_direction = "insufficient_data"

    if len(days) >= MIN_DAYS_FOR_TREND:
        x = np.arange(len(days), dtype=float)
        slope, _ = np.polyfit(x, kpu_values, 1)
        trend_slope = round(float(slope), 6)

        # Classify relative to mean — ignore noise below 0.5%
        relative_change = abs(trend_slope) / mean_kpu if mean_kpu > 0 else 0.0
        if relative_change < 0.005:
            trend_direction = "stable"
        elif trend_slope < 0:
            trend_direction = "improving"   # kWh/unit falling = more efficient
        else:
            trend_direction = "worsening"   # kWh/unit rising = less efficient

    best_day = min(days, key=lambda d: d.kwh_per_unit)
    worst_day = max(days, key=lambda d: d.kwh_per_unit)

    return CorrelationResult(
        site_id=site_id,
        start=start,
        end=end,
        unit_label=unit_label,
        days=days,
        trend_slope=trend_slope,
        trend_direction=trend_direction,
        mean_kwh_per_unit=round(mean_kpu, 4),
        best_day=best_day,
        worst_day=worst_day,
        anomaly_count=anomaly_count,
        coverage_days=len(days),
        total_days_requested=total_days,
    )