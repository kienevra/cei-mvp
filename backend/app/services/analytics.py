"""
Analytics service for CEI (Carbon Efficiency Intelligence).

This module provides core analytics functionality for processing and analyzing energy metrics:
- KPI computation with robust error handling and validation
- Industry benchmarking with configurable thresholds
- Anomaly detection using multiple algorithms (z-score and optional ML)

Key Features:
- Type-safe interfaces with comprehensive error handling
- Efficient SQL-based aggregation for large datasets
- Configurable benchmarking from CSV or builtin defaults
- Extensible anomaly detection framework

Usage:
    from app.services.analytics import (
        compute_kpis, 
        benchmark_against_industry,
        detect_anomalies
    )

"""

import csv
import logging
class KPIResult(TypedDict):
    energy_kwh: float
    avg_power_kw: float
    peak_kw: float
    load_factor: float | None
    window_hours: float
    window_start: str
    window_end: str

class BenchmarkResult(TypedDict):
    metric_name: str
    value: float
    benchmark: float | None
    percent_of_benchmark: float | None
    flagged: bool
    recommendation: str

class AnomalyResult(TypedDict):
    method: str
    anomaly_indices: List[int]
    anomalies: List[float]
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple, TypedDict, Union, cast

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

# Optional sklearn import for advanced anomaly detection
try:
    from sklearn.ensemble import IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    
from app.models import Metric, Sensor
import logging
logger = logging.getLogger(__name__)

def _load_benchmarks() -> Dict[str, float]:
    # Dummy implementation for now
    return {
        "manufacturing_energy_intensity": 1000.0,
        "avg_power_kw_per_m2": 0.02,
    }

BENCHMARKS = _load_benchmarks()

class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db

    def compute_kpis(
        self,
        site_id: int,
        window_days: int = 30,
        start_ts: Optional[datetime] = None,
        end_ts: Optional[datetime] = None
    ) -> KPIResult:
        """
        Compute key performance indicators for a site over a specified time window.

        This function calculates:
        - energy_kwh: Total energy consumed (approximated from power readings)
        - avg_power_kw: Mean power draw across all sensors
        - peak_kw: Maximum power draw observed
        - load_factor: Ratio of average to peak power (efficiency metric)

        Args:
            site_id: ID of the site to analyze
            window_days: Number of days to look back (default: 30)
            start_ts: Optional custom start time (overrides window_days)
            end_ts: Optional custom end time (defaults to now)
            arr = np.array(series)
            result = {"method": method, "anomaly_indices": [], "anomalies": []}
        Returns:
            KPIResult: Dictionary containing computed KPIs and metadata
            flagged = value > (threshold * benchmark) if benchmark else False
        # Set time window
        end_ts = end_ts or datetime.utcnow()
        start_ts = start_ts or (end_ts - timedelta(days=window_days))
        if start_ts >= end_ts:
            raise ValueError("start_ts must be before end_ts")

        try:
            # Get all active sensor IDs for the site in one query
            sensor_ids_query = (
                select(Sensor.id)
                .where(
                    Sensor.site_id == site_id,
                    Sensor.is_active == True  # Only include active sensors
                )
            )

            return {
                "energy_kwh": round(energy_kwh, 3),
                "avg_power_kw": round(avg_power_kw, 3),
                "peak_kw": round(peak_kw, 3),
                "load_factor": round(load_factor, 3) if load_factor is not None else None,
                "window_hours": round(window_hours, 2),
                "window_start": start_ts.isoformat(),
                "window_end": end_ts.isoformat()
            }

        except SQLAlchemyError as e:
            logger.error("Database error in compute_kpis: %s", str(e))
            raise

    def _empty_kpi_result(self, start_ts: datetime, end_ts: datetime) -> KPIResult:
        window_hours = (end_ts - start_ts).total_seconds() / 3600
        return {
            "energy_kwh": 0.0,
            "avg_power_kw": 0.0,
            "peak_kw": 0.0,
            "load_factor": None,
            "window_hours": round(window_hours, 2),
            "window_start": start_ts.isoformat(),
            "window_end": end_ts.isoformat()
        }

    def benchmark_against_industry(
        self,
        metric_name: str,
        value: float,
        threshold: float = 1.15
    ) -> BenchmarkResult:
        if not isinstance(value, (int, float)) or value < 0:
            raise ValueError(f"Invalid metric value: {value}")
        if not isinstance(threshold, (int, float)) or threshold <= 1:
            raise ValueError(f"Invalid threshold: {threshold}. Must be > 1")
        
        try:
            benchmark = BENCHMARKS.get(metric_name)
            if benchmark is None:
                logger.warning("No benchmark found for metric: %s", metric_name)
                return {
                    "metric_name": metric_name,
                    "value": value,
                    "benchmark": None,
                    "percent_of_benchmark": None,
                    "flagged": False,
                    "recommendation": (
                        "No industry benchmark available. Consider collecting "
                        "historical data to establish baseline."
                    )
                }

            # Calculate comparison metrics
            percent = (value / benchmark) * 100.0 if benchmark else None
                        flagged = value > (threshold * benchmark) if benchmark else False
                        
                        # Generate detailed recommendations based on severity
                        if flagged:
                            percent_over = ((value / benchmark) - 1) * 100
                            if percent_over > 50:
                                recommendation = (
                                    f"Critical: {percent_over:.1f}% above benchmark. "
                                    "Immediate investigation recommended. Check for: "
                                    "1) Equipment malfunction "
                                    "2) Process inefficiencies "
                                    "3) Calibration errors"
                                )
                            else:
                                recommendation = (
                                    f"Warning: {percent_over:.1f}% above benchmark. "
                                    "Consider efficiency improvements: "
                                    "1) Equipment maintenance "
                                    "2) Operating procedures review "
                                    "3) Energy audit"
                                )
                        else:
                            recommendation = (
                                "Performance within expected range. "
                                "Continue monitoring for trends."
                            )

                        # Log the comparison
                        logger.info(
                            "Benchmark comparison for %s: %.2f vs benchmark %.2f (%.1f%%)",
                            metric_name, value, benchmark, percent or 0.0
                        )

            return {
                "metric_name": metric_name,
                "value": round(value, 3),
                "benchmark": round(benchmark, 3),
                "percent_of_benchmark": round(percent, 2) if percent else None,
                "flagged": flagged,
                "recommendation": recommendation
            }
        except Exception as e:
            logger.error("Error in benchmark comparison: %s", str(e))
            raise

    def detect_anomalies(
        self,
        series: Sequence[float],
        method: str = "zscore",
        z_thresh: float = 3.0,
        contamination: float = 0.1
    ) -> AnomalyResult:

        Returns:
            AnomalyResult with detection method and anomaly indices/values

        Raises:
            ValueError: If method invalid or series empty
        """
        if not series:
            raise ValueError("Empty input series")
        if not isinstance(z_thresh, (int, float)) or z_thresh <= 0:
            raise ValueError(f"Invalid z-score threshold: {z_thresh}")
        if not isinstance(contamination, float) or not 0 < contamination < 0.5:
            raise ValueError(f"Invalid contamination rate: {contamination}")

        try:
                        arr = np.array(series)
                        result = {"method": method, "anomaly_indices": [], "anomalies": []}

                        if method.lower() in ["zscore", "both"]:
                            z_scores = np.abs((arr - arr.mean()) / arr.std())
                            z_indices = np.where(z_scores > z_thresh)[0]
                            result["anomaly_indices"].extend(z_indices.tolist())
                            result["anomalies"].extend(arr[z_indices].tolist())

                        if method.lower() in ["isolation_forest", "both"]:
                            if not SKLEARN_AVAILABLE:
                                logger.warning(
                                    "IsolationForest requested but scikit-learn not available. "
                                    "Falling back to z-score method."
                                )
                                if method == "isolation_forest":
                                    # Only use z-score if IsolationForest was specifically requested
                                    z_scores = np.abs((arr - arr.mean()) / arr.std())
                                    z_indices = np.where(z_scores > z_thresh)[0]
                                    result["anomaly_indices"].extend(z_indices.tolist())
                                    result["anomalies"].extend(arr[z_indices].tolist())
                            else:
                                # Use IsolationForest
                                reshaped = arr.reshape(-1, 1)
                                iso = IsolationForest(
                                    contamination=contamination,
                                    random_state=42
                                )
                                preds = iso.fit_predict(reshaped)
                                iso_indices = np.where(preds == -1)[0]
                                result["anomaly_indices"].extend(iso_indices.tolist())
                                result["anomalies"].extend(arr[iso_indices].tolist())

                        # Remove duplicates if both methods were used
                        result["anomaly_indices"] = sorted(list(set(result["anomaly_indices"])))
                        result["anomalies"] = sorted(list(set(result["anomalies"])))

                        # Log detection results
                        logger.info(
                            "Anomaly detection (%s) found %d anomalies in series of length %d",
                            method, len(result["anomaly_indices"]), len(series)
                        )

                        return cast(AnomalyResult, result)

        except Exception as e:
            logger.error("Error in anomaly detection: %s", str(e))
            raise
    # End of AnalyticsService

def energy_metrics_for_window(db: Session, site_id: int, window_days: int = 30) -> dict:
    """
    Calculate energy metrics for a given time window.
    Returns a dict with energy_kwh, avg_power_kw, peak_kw, load_factor, window_hours, window_start, window_end.
    """
    end_ts = datetime.utcnow()
    start_ts = end_ts - timedelta(days=window_days)
    # Use SQL aggregation to compute avg and max
    # Get all sensor IDs for the site
    sensor_ids = (
        select(Sensor.id)
        .where(Sensor.site_id == site_id)
        .scalar_subquery()
    )
    
    stmt_avg = select(func.avg(Metric.value)).where(
        Metric.sensor_id.in_(sensor_ids),
        Metric.ts >= start_ts,
        Metric.ts <= end_ts
    )
    stmt_max = select(func.max(Metric.value)).where(
        Metric.sensor_id.in_(sensor_ids),
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
