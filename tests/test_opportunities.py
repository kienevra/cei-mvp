import pytest
from app.services.opportunities import OpportunityEngine

@pytest.fixture
def kpis():
    return {
        "energy_kwh": 10000,
        "avg_power_kw": 20,
        "peak_kw": 40,
        "load_factor": 0.5,
    }

def test_suggest_measures_returns_list(kpis):
    engine = OpportunityEngine()
    measures = engine.suggest_measures(kpis)
    assert isinstance(measures, list)
    assert all("id" in m for m in measures)
    assert all("simple_roi_years" in m for m in measures)
    assert all("est_co2_tons_saved_per_year" in m for m in measures)
