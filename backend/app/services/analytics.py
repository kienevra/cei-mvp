"""
Analytics service for CEI (Carbon Efficiency Intelligence).

- Implements rule-based benchmarking as the default behavior (no ML dependency required).
- Provides optional ML scaffolding (IsolationForest) if scikit-learn is installed.
- compute_kpis assumes Metric.value represents instantaneous power (kW) samples.
  Energy over a window is approximated as avg_power_kw * window_hours.

Public functions:
- compute_kpis(session, site_id, window_days=30) -> dict
- benchmark_against_industry(metric_name, value) -> dict
- detect_anomalies(values: Sequence[float]) -> dict
"""

import csv
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

# Optional sklearn import for future use
try:
    from sklearn.ensemble import IsolationForest  # type: ignore
    SKLEARN_AVAILABLE = True
except Exception:
    SKLEARN_AVAILABLE = False

from app.models import Metric  # adjust import path per your models module
from app.core.config import settings

# Path to benchmarks CSV (recommended). CSV format: metric_name,benchmark_value,units,notes
BENCHMARKS_CSV = os.path.join(os.path.dirname(__file__), "..", "data", "benchmarks.csv")

# Fallback builtin benchmarks if CSV missing (example entries)
BUILTIN_BENCHMARKS = {
    # metric_name: benchmark (kWh per unit or kW average depending on use)
    "manufacturing_energy_intensity": 1000.0,  # example kWh/unit/year
    "avg_power_kw_per_m2": 0.02,               # example kW/m^2
    # Add realistic benchmarks when you have domain data
}

def _load_benchmarks() -> Dict[str, float]:
    """Load benchmarks from CSV if available, else return builtin dict."""
    if os.path.exists(BENCHMARKS_CSV):
        out: Dict[str, float] = {}
        try:
            with open(BENCHMARKS_CSV, newline="", encoding="utf-8") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    key = row.get("metric_name") or row.get("name")
                    val = row.get("benchmark_value") or row.get("value")
                    if key and val:
                        try:
                            out[key] = float(val)
                        except ValueError:
                            continue
            if out:
                return out
        except Exception:
            # If CSV read fails, fall back to builtin
            pass
    return BUILTIN_BENCHMARKS.copy()

BENCHMARKS = _load_benchmarks()

def compute_kpis(db: Session, site_id: int, window_days: int = 30) -> Dict[str, Optional[float]]:
    """
    Compute basic KPIs for a site over the past `window_days`.
    Assumptions:
    - Metric.value is instantaneous power in kW sampled at regular intervals.
    - Energy_kwh ≈ avg_power_kw * total_hours_in_window

    Returns dict:
    {
        "energy_kwh": float,
        "avg_power_kw": float,
        "peak_kw": float,
        "load_factor": float  # ratio avg/peak (0..1)
    }
    """
    end_ts = datetime.utcnow()
    start_ts = end_ts - timedelta(days=window_days)
    # Use SQL aggregation to compute avg and max
    stmt_avg = select(func.avg(Metric.value)).where(
        Metric.site_id == site_id,
        Metric.ts >= start_ts,
        Metric.ts <= end_ts
    )
    stmt_max = select(func.max(Metric.value)).where(
        Metric.site_id == site_id,
        Metric.ts >= start_ts,
        Metric.ts <= end_ts
    )

    avg_res = db.execute(stmt_avg).scalar()
    max_res = db.execute(stmt_max).scalar()

    avg_power_kw = float(avg_res) if avg_res is not None else 0.0
    peak_kw = float(max_res) if max_res is not None else 0.0
    window_hours = window_days * 24.0
    energy_kwh = avg_power_kw * window_hours  # approximation

    load_factor = (avg_power_kw / peak_kw) if (peak_kw and peak_kw > 0) else None

    return {
        "energy_kwh": round(energy_kwh, 3),
        "avg_power_kw": round(avg_power_kw, 3),
        "peak_kw": round(peak_kw, 3),
        "load_factor": round(load_factor, 3) if load_factor is not None else None,
        "window_hours": window_hours,
        "window_start": start_ts.isoformat(),
        "window_end": end_ts.isoformat(),
    }

def benchmark_against_industry(metric_name: str, value: float) -> Dict[str, Optional[float]]:
    """
    Compare `value` against a benchmark for metric_name.
    Returns a dict:
    {
      "metric_name": str,
      "value": float,
      "benchmark": float,
      "percent_of_benchmark": float,
      "flagged": bool,
      "recommendation": str
    }
    Rule: flagged if value > 1.15 * benchmark
    """
    benchmark_value = BENCHMARKS.get(metric_name)
    if benchmark_value is None:
        # If we don't have a benchmark, return best-effort response
        return {
            "metric_name": metric_name,
            "value": value,
            "benchmark": None,
            "percent_of_benchmark": None,
            "flagged": False,
            "recommendation": "No benchmark available — collect more data or define industry baseline."
        }

    percent = (value / benchmark_value) * 100.0 if benchmark_value else None
    flagged = (value > 1.15 * benchmark_value) if benchmark_value else False
    recommendation = (
        "Significant deviation: investigate process inefficiencies, motors, compressed air leaks, "
        "and waste heat recovery options."
        if flagged else "Within expected range; monitor for trends."
    )

    return {
        "metric_name": metric_name,
        "value": value,
        "benchmark": benchmark_value,
        "percent_of_benchmark": round(percent, 2) if percent is not None else None,
        "flagged": flagged,
        "recommendation": recommendation
    }

def detect_anomalies(values: Sequence[float], z_thresh: float = 3.0) -> Dict[str, object]:
    """
    Basic anomaly detection:
    - Primary: z-score method (no extra deps)
    - Fallback/optional: IsolationForest if scikit-learn installed and user requests

    Returns:
    {
      "method": "zscore" or "isolation_forest",
      "anomaly_indices": [int,...],
      "anomalies": [value,...]
    }
    """
    out = {"method": None, "anomaly_indices": [], "anomalies": []}
    if not values:
        return out

    # z-score
    try:
        import math
        n = len(values)
        mean = sum(values) / n
        var = sum((x - mean) ** 2 for x in values) / n
        sd = math.sqrt(var)
        anomalies = []
        indices = []
        if sd == 0:
            # no variance, no anomalies by z-score
            out.update({"method": "zscore", "anomaly_indices": [], "anomalies": []})
            return out
        for i, v in enumerate(values):
            z = (v - mean) / sd
            if abs(z) >= z_thresh:
                indices.append(i)
                anomalies.append(v)
        out.update({"method": "zscore", "anomaly_indices": indices, "anomalies": anomalies})
        return out
    except Exception:
        # fall through to optional sklearn path below
        pass

    # Optional: IsolationForest if available
    if SKLEARN_AVAILABLE:
        try:
            import numpy as np  # type: ignore
            arr = np.array(values).reshape(-1, 1)
            clf = IsolationForest(random_state=0, contamination='auto')
            preds = clf.fit_predict(arr)
            indices = [i for i, p in enumerate(preds) if p == -1]
            anomalies = [values[i] for i in indices]
            out.update({"method": "isolation_forest", "anomaly_indices": indices, "anomalies": anomalies})
            return out
        except Exception:
            # If sklearn fails, return empty result
            return {"method": None, "anomaly_indices": [], "anomalies": []}

    return out
