from typing import List, Dict, Any
from app.core.config import settings

class OpportunityEngine:
    def __init__(self, emission_factor_kg_per_kwh: float = None):
        # Default emission factor (kg CO2 per kWh)
        self.emission_factor = emission_factor_kg_per_kwh or getattr(settings, "EMISSION_FACTOR_KG_PER_KWH", 0.4)

    def suggest_measures(self, kpis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Accepts KPI dicts and returns prioritized opportunity measures.
        """
        # Example measures (replace with real logic)
        measures = [
            {
                "id": 1,
                "name": "LED Lighting Upgrade",
                "description": "Replace all lighting with LED to reduce energy consumption.",
                "est_annual_kwh_saved": 5000,
                "est_capex_eur": 2000,
                "simple_roi_years": 2000 / (0.2 * 5000),
                "est_co2_tons_saved_per_year": (5000 * self.emission_factor) / 1000,
            },
            {
                "id": 2,
                "name": "HVAC Optimization",
                "description": "Optimize HVAC schedules and controls.",
                "est_annual_kwh_saved": 3000,
                "est_capex_eur": 1000,
                "simple_roi_years": 1000 / (0.2 * 3000),
                "est_co2_tons_saved_per_year": (3000 * self.emission_factor) / 1000,
            },
        ]
        # Prioritize by ROI
        return sorted(measures, key=lambda m: m["simple_roi_years"])
