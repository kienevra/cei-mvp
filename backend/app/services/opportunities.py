# backend/app/services/opportunities.py

from typing import List, Dict, Any, Optional

from app.core.config import settings


class OpportunityEngine:
    """
    Level B opportunity engine:

    - Savings are derived from measured "excess vs baseline" over a recent window.
    - Costs use org tariff (electricity_price_per_kwh) when available.
    - CO2 uses a fixed emission factor (kg/kWh), configurable via settings.

    Output fields remain stable for the frontend:
      id, name, description, est_annual_kwh_saved, est_capex_eur,
      simple_roi_years, est_co2_tons_saved_per_year
    Plus (additive):
      est_annual_cost_saved, currency_code
    """

    def __init__(self, emission_factor_kg_per_kwh: float | None = None):
        self.emission_factor: float = (
            emission_factor_kg_per_kwh
            or getattr(settings, "EMISSION_FACTOR_KG_PER_KWH", 0.4)
        )

        # Conservative default if org tariff is missing (keeps UI non-empty)
        # But Level B requires org tariff to be set for accuracy.
        self.fallback_price_eur_per_kwh: float = float(
            getattr(settings, "DEFAULT_ELECTRICITY_PRICE_PER_KWH", 0.20)
        )

    def _as_float(self, v: Any) -> Optional[float]:
        try:
            if v is None:
                return None
            return float(v)
        except Exception:
            return None

    def suggest_measures(self, kpis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        kpis expected (best-effort):
          - excess_kwh_window: float (>=0)
          - window_hours: int
          - electricity_price_per_kwh: float | None
          - currency_code: str | None
        """
        window_hours = int(kpis.get("window_hours") or 168)

        excess_kwh_window = self._as_float(kpis.get("excess_kwh_window"))
        if excess_kwh_window is None or excess_kwh_window <= 0:
            # No measurable "waste" vs baseline => no auto opportunities.
            return []

        price = self._as_float(kpis.get("electricity_price_per_kwh"))
        if price is None or price <= 0:
            price = self.fallback_price_eur_per_kwh

        currency_code = kpis.get("currency_code")
        currency_code = str(currency_code) if currency_code else "EUR"

        # Annualize based on observed window
        hours_per_year = 365.0 * 24.0
        annual_factor = hours_per_year / float(max(window_hours, 1))

        # Base annual "waste" estimate
        annual_excess_kwh = excess_kwh_window * annual_factor

        # Conservative capture rates per measure (Level B: not guessing too aggressively)
        measures_spec = [
            {
                "id": 1,
                "name": "LED lighting upgrade",
                "description": "Replace legacy lighting with LED and tighten night-time switching.",
                "capture_rate": 0.08,  # capture 8% of measured excess
                "capex_eur": 2000.0,
            },
            {
                "id": 2,
                "name": "HVAC schedule optimization",
                "description": "Reduce off-shift HVAC runtime and align setpoints with actual occupancy.",
                "capture_rate": 0.06,  # capture 6% of measured excess
                "capex_eur": 1000.0,
            },
            {
                "id": 3,
                "name": "Compressed air leak program",
                "description": "Survey and fix leaks; tune pressure bands; enforce shutoff off-shift.",
                "capture_rate": 0.10,  # capture 10% of measured excess
                "capex_eur": 1500.0,
            },
        ]

        measures: List[Dict[str, Any]] = []
        for spec in measures_spec:
            capture = float(spec["capture_rate"])
            capex = float(spec["capex_eur"])

            est_annual_kwh_saved = annual_excess_kwh * capture

            # Floor tiny numbers (noise) to avoid silly outputs
            if est_annual_kwh_saved < 100.0:
                continue

            est_annual_cost_saved = est_annual_kwh_saved * price

            # Payback: capex / annual savings (years)
            if est_annual_cost_saved > 0:
                simple_roi_years = capex / est_annual_cost_saved
            else:
                simple_roi_years = None

            est_co2_tons_saved = (est_annual_kwh_saved * self.emission_factor) / 1000.0

            measures.append(
                {
                    "id": int(spec["id"]),
                    "name": str(spec["name"]),
                    "description": str(spec["description"]),
                    "est_annual_kwh_saved": float(round(est_annual_kwh_saved, 0)),
                    "est_capex_eur": float(round(capex, 0)),
                    "simple_roi_years": float(round(simple_roi_years, 2))
                    if simple_roi_years is not None
                    else None,
                    "est_co2_tons_saved_per_year": float(round(est_co2_tons_saved, 2)),
                    # Additive fields (frontend-safe)
                    "est_annual_cost_saved": float(round(est_annual_cost_saved, 0)),
                    "currency_code": currency_code,
                }
            )

        # Prioritize by simple ROI (shortest payback first); keep None at end
        def _roi_key(m: Dict[str, Any]) -> float:
            v = m.get("simple_roi_years")
            try:
                return float(v)
            except Exception:
                return 1e9

        return sorted(measures, key=_roi_key)
