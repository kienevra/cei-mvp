import pytest
from sqlalchemy.orm import Session
from app.services import analytics

class DummySession:
    def execute(self, stmt):
        class Result:
            avg_power = 10.0
            peak_power = 20.0
            sample_count = 5
        return Result()

def test_compute_kpis_basic():
    dummy_db = DummySession()
    service = analytics.AnalyticsService(dummy_db)
    # Use default window, no real DB
    result = service.compute_kpis(site_id=1, window_days=1)
    assert isinstance(result, dict)
    assert "energy_kwh" in result
    assert "avg_power_kw" in result
    assert "peak_kw" in result
    assert "load_factor" in result

def test_benchmark_against_industry_method():
    service = analytics.AnalyticsService(DummySession())
    res = service.benchmark_against_industry("manufacturing_energy_intensity", 1200.0)
    assert isinstance(res, dict)
    assert "flagged" in res
    assert "recommendation" in res

def test_detect_anomalies_method():
    service = analytics.AnalyticsService(DummySession())
    values = [1, 2, 3, 100, 2, 3, 2]
    res = service.detect_anomalies(values)
    assert isinstance(res, dict)
    assert "anomaly_indices" in res
    assert "anomalies" in res
    assert len(res["anomaly_indices"]) > 0
