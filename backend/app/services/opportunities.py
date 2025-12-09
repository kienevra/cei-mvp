# backend/app/services/opportunities.py

from typing import List, Dict, Any

from app.core.config import settings


class OpportunityEngine:
    """
    Simple rule engine that turns KPI dictionaries into concrete opportunity measures.

    This is deliberately conservative:
    - It always returns a small, stable list of measures.
    - Each measure is a dict with the fields your frontend expects:
      id, name, description, est_annual_kwh_saved, est_capex_eur,
      simple_roi_years, est_co2_tons_saved_per_year.
    """

    def __init__(self, emission_factor_kg_per_kwh: float | None = None):
        # Default emission factor (kg CO2 per kWh)
        self.emission_factor: float = (
            emission_factor_kg_per_kwh
            or getattr(settings, "EMISSION_FACTOR_KG_PER_KWH", 0.4)
        )

    def suggest_measures(self, kpis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Accepts KPI dicts and returns prioritized opportunity measures.

        Current stub logic:
        - Ignores most KPI fields and returns a small static set, but keeps
          the shape stable so the frontend can evolve without breaking.
        - You can gradually wire kpi["deviation_pct_7d"], etc., into thresholds
          to make this smarter over time.
        """

        # Example assumptions for the stub (can be replaced by real logic):
        # - Assume 0.20 €/kWh blended cost.
        energy_price_eur_per_kwh = 0.20

        measures: List[Dict[str, Any]] = [
            {
                "id": 1,
                "name": "LED lighting upgrade",
                "description": "Replace legacy lighting with LED and tighten night-time switching.",
                "est_annual_kwh_saved": 5_000,
                "est_capex_eur": 2_000,
                "simple_roi_years": 2_000
                / (energy_price_eur_per_kwh * 5_000),
                "est_co2_tons_saved_per_year": (5_000 * self.emission_factor)
                / 1_000.0,
            },
            {
                "id": 2,
                "name": "HVAC schedule optimization",
                "description": "Reduce off-shift HVAC runtime and align setpoints with actual occupancy.",
                "est_annual_kwh_saved": 3_000,
                "est_capex_eur": 1_000,
                "simple_roi_years": 1_000
                / (energy_price_eur_per_kwh * 3_000),
                "est_co2_tons_saved_per_year": (3_000 * self.emission_factor)
                / 1_000.0,
            },
        ]

        # Prioritize by simple ROI (shortest payback first)
        return sorted(measures, key=lambda m: m["simple_roi_years"])
