# backend/app/services/opportunities.py
"""
Pattern-matched opportunity engine (Level C).

Instead of generic measures, this engine reads the actual anomaly pattern
from compute_site_insights() output and generates opportunities tied directly
to the data — specific time windows, z-scores, costs, and actions.

Pattern detection hierarchy (checked in order, first match wins per pattern type):
  1. Night overconsumption  — critical/elevated hours concentrated 22:00–05:00
  2. Weekend excess         — weekend hours show higher deviation than weekday hours
  3. Spike cluster          — few hours with extreme z-score (>= 3.0)
  4. Morning ramp creep     — 06:00–09:00 start-up takes longer than baseline
  5. Sustained baseline drift — deviation_pct > 15% spread across all hours
  6. Shoulder hours waste   — lunchtime / shift-change (11:00–13:00, 17:00–19:00) excess
  7. Generic fallback       — used only when no pattern is detectable
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger("cei")

# ── Constants ────────────────────────────────────────────────────────────────

HOURS_PER_YEAR = 8_760.0
DEFAULT_EMISSION_FACTOR = 0.4          # kg CO2 per kWh (Italian grid average)
DEFAULT_PRICE_EUR_PER_KWH = 0.23       # fallback when org tariff not configured

# Hour bands
NIGHT_HOURS: set = {22, 23, 0, 1, 2, 3, 4, 5}
MORNING_RAMP_HOURS: set = {6, 7, 8, 9}
SHOULDER_HOURS: set = {11, 12, 13, 17, 18, 19}
PRODUCTION_HOURS: set = {6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18}


# ── Data classes ─────────────────────────────────────────────────────────────

class _Pattern:
    """Internal match result — not exposed to callers."""
    def __init__(
        self,
        pattern_id: str,
        excess_kwh_window: float,
        affected_hours: List[int],
        peak_z: float,
        description_detail: str,
    ):
        self.pattern_id = pattern_id
        self.excess_kwh_window = excess_kwh_window
        self.affected_hours = affected_hours
        self.peak_z = peak_z
        self.description_detail = description_detail


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hour_label(hour: int) -> str:
    return f"{hour:02d}:00"


def _hour_range_label(hours: List[int]) -> str:
    if not hours:
        return "unknown"
    hours = sorted(hours)
    return f"{_hour_label(hours[0])}–{_hour_label((hours[-1] + 1) % 24)}"


def _cost(kwh: float, price: float) -> float:
    return round(kwh * price, 0)


def _co2(kwh: float, emission_factor: float) -> float:
    return round((kwh * emission_factor) / 1000.0, 2)


def _roi(capex: float, annual_saving: float) -> Optional[float]:
    if annual_saving <= 0:
        return None
    return round(capex / annual_saving, 2)


def _annualize(kwh_in_window: float, window_hours: int) -> float:
    return kwh_in_window * (HOURS_PER_YEAR / max(window_hours, 1))


# ── Pattern detection ─────────────────────────────────────────────────────────

def _detect_patterns(
    hours_data: List[Dict[str, Any]],
    window_hours: int,
    total_actual: float,
    total_expected: float,
    deviation_pct: float,
) -> List[_Pattern]:
    """
    Scan the hourly insight output and identify anomaly patterns.
    Returns a list of _Pattern objects ordered by excess kWh descending.
    """
    patterns: List[_Pattern] = []

    if not hours_data:
        return patterns

    # Index hourly data by hour-of-day (for 24h windows use "hour" directly as 0-23)
    # For multi-day windows "hour" is a sequential index — map to hour-of-day via modulo
    is_24h = window_hours <= 24

    def hod(entry: Dict[str, Any]) -> int:
        """hour-of-day 0–23"""
        if is_24h:
            return int(entry.get("hour", 0))
        return int(entry.get("hour", 0)) % 24

    # Only look at hours where we have a real expected value (baseline exists)
    valid = [h for h in hours_data if float(h.get("expected_kwh", 0) or 0) > 0]
    if not valid:
        return patterns

    # ── 1. Night overconsumption ──────────────────────────────────────────────
    night_entries = [h for h in valid if hod(h) in NIGHT_HOURS]
    night_excess_hours = [
        h for h in night_entries
        if float(h.get("delta_kwh", 0) or 0) > 0
        and (float(h.get("delta_pct", 0) or 0) >= 20 or float(h.get("z_score", 0) or 0) >= 1.5)
    ]
    if len(night_excess_hours) >= 2:
        excess_kwh = sum(float(h.get("delta_kwh", 0) or 0) for h in night_excess_hours)
        if excess_kwh > 5:
            peak_z = max(float(h.get("z_score", 0) or 0) for h in night_excess_hours)
            affected = sorted({hod(h) for h in night_excess_hours})
            avg_actual = sum(float(h.get("actual_kwh", 0) or 0) for h in night_excess_hours) / len(night_excess_hours)
            avg_expected = sum(float(h.get("expected_kwh", 0) or 0) for h in night_excess_hours) / len(night_excess_hours)
            pct_over = ((avg_actual - avg_expected) / avg_expected * 100) if avg_expected > 0 else 0
            patterns.append(_Pattern(
                pattern_id="night_overconsumption",
                excess_kwh_window=excess_kwh,
                affected_hours=affected,
                peak_z=peak_z,
                description_detail=(
                    f"Off-shift hours {_hour_range_label(affected)} are running at "
                    f"{pct_over:.0f}% above the learned baseline (peak z-score {peak_z:.1f}). "
                    f"Average actual: {avg_actual:.1f} kWh/h vs expected {avg_expected:.1f} kWh/h. "
                    f"Likely cause: compressed air leaks, furnace standby mode, or HVAC left running. "
                    f"Action: audit loads active during {_hour_range_label(affected)} and implement "
                    f"auto-shutoff timers or machine interlocks."
                ),
            ))

    # ── 2. Weekend excess ─────────────────────────────────────────────────────
    # For 24h windows we can't separate weekend from weekday — skip
    if window_hours >= 48:
        # hours_data sequential: approximate weekend as hours at indexes that
        # fall on Sat/Sun. Without actual timestamps we use the band labelling.
        # Use band="critical"/"elevated" as proxy for anomaly.
        weekend_elevated = [
            h for h in valid
            if h.get("band") in ("critical", "elevated")
            and hod(h) in PRODUCTION_HOURS
        ]
        weekday_avg_z = (
            sum(float(h.get("z_score", 0) or 0) for h in valid if hod(h) in PRODUCTION_HOURS)
            / max(len([h for h in valid if hod(h) in PRODUCTION_HOURS]), 1)
        )
        weekend_avg_z = (
            sum(float(h.get("z_score", 0) or 0) for h in weekend_elevated)
            / max(len(weekend_elevated), 1)
        )
        if weekend_avg_z > weekday_avg_z * 1.3 and len(weekend_elevated) >= 3:
            excess_kwh = sum(float(h.get("delta_kwh", 0) or 0) for h in weekend_elevated if float(h.get("delta_kwh", 0) or 0) > 0)
            if excess_kwh > 5:
                peak_z = max(float(h.get("z_score", 0) or 0) for h in weekend_elevated)
                affected = sorted({hod(h) for h in weekend_elevated})
                patterns.append(_Pattern(
                    pattern_id="weekend_excess",
                    excess_kwh_window=excess_kwh,
                    affected_hours=affected,
                    peak_z=peak_z,
                    description_detail=(
                        f"Weekend production hours show elevated consumption vs weekday baseline "
                        f"(peak z-score {peak_z:.1f}). {len(weekend_elevated)} hours above expected levels. "
                        f"Typical cause: equipment left running over the weekend, or weekend shifts not "
                        f"reflected in the baseline. Action: verify weekend staffing schedules match "
                        f"HVAC/compressed-air profiles and enforce machine-off procedures at shift end."
                    ),
                ))

    # ── 3. Spike cluster ──────────────────────────────────────────────────────
    spike_hours = [
        h for h in valid
        if float(h.get("z_score", 0) or 0) >= 3.0
        and float(h.get("delta_kwh", 0) or 0) > 0
    ]
    if len(spike_hours) >= 1:
        excess_kwh = sum(float(h.get("delta_kwh", 0) or 0) for h in spike_hours)
        if excess_kwh > 5:
            peak_z = max(float(h.get("z_score", 0) or 0) for h in spike_hours)
            affected = sorted({hod(h) for h in spike_hours})
            patterns.append(_Pattern(
                pattern_id="spike_cluster",
                excess_kwh_window=excess_kwh,
                affected_hours=affected,
                peak_z=peak_z,
                description_detail=(
                    f"Extreme energy spikes detected at hours {_hour_range_label(affected)} "
                    f"(z-score {peak_z:.1f} — {len(spike_hours)} spike events in this window). "
                    f"This level of deviation suggests an equipment fault, an unscheduled batch run, "
                    f"or a process not shutting down correctly. "
                    f"Action: check SCADA logs for {_hour_range_label(affected)} — look for motors, "
                    f"kilns, or compressors that did not follow their scheduled shutoff."
                ),
            ))

    # ── 4. Morning ramp creep ─────────────────────────────────────────────────
    ramp_entries = [h for h in valid if hod(h) in MORNING_RAMP_HOURS]
    ramp_excess = [
        h for h in ramp_entries
        if float(h.get("delta_pct", 0) or 0) >= 15
        and float(h.get("delta_kwh", 0) or 0) > 0
    ]
    if len(ramp_excess) >= 2:
        excess_kwh = sum(float(h.get("delta_kwh", 0) or 0) for h in ramp_excess)
        if excess_kwh > 5:
            peak_z = max(float(h.get("z_score", 0) or 0) for h in ramp_excess)
            affected = sorted({hod(h) for h in ramp_excess})
            patterns.append(_Pattern(
                pattern_id="morning_ramp_creep",
                excess_kwh_window=excess_kwh,
                affected_hours=affected,
                peak_z=peak_z,
                description_detail=(
                    f"Morning start-up hours {_hour_range_label(affected)} are consistently "
                    f"overshooting the baseline by {sum(float(h.get('delta_pct',0) or 0) for h in ramp_excess)/len(ramp_excess):.0f}% on average. "
                    f"This is a demand-charge risk: if your tariff has a peak demand component, "
                    f"this ramp pattern may be inflating your monthly capacity charges. "
                    f"Action: stagger machine start-up sequences to spread load over 30–45 minutes "
                    f"rather than starting all equipment simultaneously."
                ),
            ))

    # ── 5. Sustained baseline drift ───────────────────────────────────────────
    if deviation_pct >= 15 and total_expected > 0:
        # Spread across all hours — not concentrated in a specific band
        concentrated = len(patterns) > 0  # already caught a specific pattern
        if not concentrated:
            excess_kwh = max(total_actual - total_expected, 0)
            if excess_kwh > 10:
                patterns.append(_Pattern(
                    pattern_id="sustained_drift",
                    excess_kwh_window=excess_kwh,
                    affected_hours=list(range(24)),
                    peak_z=float(max((float(h.get("z_score", 0) or 0) for h in valid), default=0)),
                    description_detail=(
                        f"Total consumption is {deviation_pct:.1f}% above the 30-day baseline across "
                        f"all hours — not concentrated in a specific time band. This type of systematic "
                        f"drift typically indicates a new persistent load (a new machine running "
                        f"continuously, a refrigeration unit added, or a compressed air leak that grew). "
                        f"Action: compare the list of active equipment against the baseline period and "
                        f"identify what changed. A full energy walk-down during a quiet production period "
                        f"is the fastest way to locate the source."
                    ),
                ))

    # ── 6. Shoulder hours waste ───────────────────────────────────────────────
    shoulder_entries = [h for h in valid if hod(h) in SHOULDER_HOURS]
    shoulder_excess = [
        h for h in shoulder_entries
        if float(h.get("delta_pct", 0) or 0) >= 20
        and float(h.get("delta_kwh", 0) or 0) > 0
    ]
    if len(shoulder_excess) >= 2:
        excess_kwh = sum(float(h.get("delta_kwh", 0) or 0) for h in shoulder_excess)
        if excess_kwh > 5:
            peak_z = max(float(h.get("z_score", 0) or 0) for h in shoulder_excess)
            affected = sorted({hod(h) for h in shoulder_excess})
            patterns.append(_Pattern(
                pattern_id="shoulder_waste",
                excess_kwh_window=excess_kwh,
                affected_hours=affected,
                peak_z=peak_z,
                description_detail=(
                    f"Lunch and shift-change hours {_hour_range_label(affected)} show excess consumption "
                    f"when production should be paused or reduced. "
                    f"Typical cause: HVAC, ventilation, and compressed air systems not ramping down "
                    f"during breaks. Action: configure BMS or SCADA to trigger a 'standby' mode "
                    f"during scheduled breaks — typically 15–20% savings on those hours."
                ),
            ))

    # Sort by excess kWh descending (biggest opportunity first)
    patterns.sort(key=lambda p: p.excess_kwh_window, reverse=True)
    return patterns


# ── Opportunity builder ───────────────────────────────────────────────────────

def _build_opportunity(
    opp_id: int,
    pattern: _Pattern,
    window_hours: int,
    price: float,
    currency: str,
    emission_factor: float,
) -> Dict[str, Any]:
    """Convert a _Pattern into the standard opportunity response dict."""

    annual_kwh = _annualize(pattern.excess_kwh_window, window_hours)

    # Pattern-specific capture rates and capex
    spec: Dict[str, Any] = _PATTERN_SPECS.get(pattern.pattern_id, _PATTERN_SPECS["_generic"])
    capture_rate: float = spec["capture_rate"]
    capex: float = spec["capex_eur"]
    name: str = spec["name"]

    est_annual_kwh_saved = round(annual_kwh * capture_rate, 0)
    if est_annual_kwh_saved < 50:
        return {}  # Below noise floor — don't show

    est_annual_cost_saved = _cost(est_annual_kwh_saved, price)
    est_co2 = _co2(est_annual_kwh_saved, emission_factor)
    roi = _roi(capex, est_annual_cost_saved)

    # Rich description including the data-driven detail
    window_label = f"last {window_hours}h"
    base_description = (
        f"{pattern.description_detail}\n\n"
        f"Measured excess in {window_label}: {pattern.excess_kwh_window:.0f} kWh "
        f"(peak z-score {pattern.peak_z:.1f}). "
        f"Estimated annual saving: {est_annual_kwh_saved:.0f} kWh / "
        f"{currency}{est_annual_cost_saved:.0f} at current tariff."
    )

    return {
        "id": opp_id,
        "name": name,
        "description": base_description,
        "pattern_id": pattern.pattern_id,
        "affected_hours": pattern.affected_hours,
        "peak_z_score": round(pattern.peak_z, 2),
        "excess_kwh_window": round(pattern.excess_kwh_window, 1),
        "est_annual_kwh_saved": float(est_annual_kwh_saved),
        "est_capex_eur": float(capex),
        "simple_roi_years": roi,
        "est_co2_tons_saved_per_year": float(est_co2),
        "est_annual_cost_saved": float(est_annual_cost_saved),
        "currency_code": currency,
        "source": "auto_pattern",
    }


# Pattern-specific specs: name, capture rate (fraction of annual excess), capex
_PATTERN_SPECS: Dict[str, Dict[str, Any]] = {
    "night_overconsumption": {
        "name": "Off-shift load management",
        "capture_rate": 0.65,   # high — targeted intervention on a known time window
        "capex_eur": 1_200.0,   # timer + interlock installation
    },
    "weekend_excess": {
        "name": "Weekend schedule enforcement",
        "capture_rate": 0.55,
        "capex_eur": 800.0,
    },
    "spike_cluster": {
        "name": "Equipment fault / unscheduled run investigation",
        "capture_rate": 0.70,   # spikes are often fully preventable
        "capex_eur": 500.0,     # mostly operational cost — investigation + correction
    },
    "morning_ramp_creep": {
        "name": "Staggered start-up programme",
        "capture_rate": 0.40,
        "capex_eur": 600.0,
    },
    "sustained_drift": {
        "name": "Systematic load audit",
        "capture_rate": 0.35,   # conservative — cause unknown until audited
        "capex_eur": 2_000.0,
    },
    "shoulder_waste": {
        "name": "Break-time standby mode",
        "capture_rate": 0.50,
        "capex_eur": 1_000.0,
    },
    "_generic": {
        "name": "Energy efficiency review",
        "capture_rate": 0.15,
        "capex_eur": 1_500.0,
    },
}


# ── Public API ────────────────────────────────────────────────────────────────

class OpportunityEngine:
    """
    Pattern-matched opportunity engine.

    Accepts the same kpis dict as the old generic engine for backwards
    compatibility, but also accepts an `insights` kwarg with the full
    compute_site_insights() output for pattern detection.
    """

    def __init__(self, emission_factor_kg_per_kwh: Optional[float] = None):
        self.emission_factor: float = (
            emission_factor_kg_per_kwh
            or getattr(settings, "EMISSION_FACTOR_KG_PER_KWH", DEFAULT_EMISSION_FACTOR)
        )
        self.fallback_price: float = float(
            getattr(settings, "DEFAULT_ELECTRICITY_PRICE_PER_KWH", DEFAULT_PRICE_EUR_PER_KWH)
        )

    def suggest_measures(
        self,
        kpis: Dict[str, Any],
        insights: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Generate pattern-matched (or fallback generic) opportunities.

        Args:
            kpis: dict with at minimum:
                  excess_kwh_window, window_hours,
                  electricity_price_per_kwh, currency_code
            insights: full compute_site_insights() output (optional but
                      required for pattern matching to work).
        """
        window_hours = int(kpis.get("window_hours") or 168)
        excess_kwh_window = kpis.get("excess_kwh_window")
        try:
            excess_kwh_window = float(excess_kwh_window) if excess_kwh_window is not None else None
        except Exception:
            excess_kwh_window = None

        if excess_kwh_window is None or excess_kwh_window <= 0:
            return []

        price = kpis.get("electricity_price_per_kwh")
        try:
            price = float(price) if price is not None and float(price) > 0 else self.fallback_price
        except Exception:
            price = self.fallback_price

        currency = str(kpis.get("currency_code") or "EUR")

        total_actual = float(kpis.get("total_actual_kwh") or 0.0)
        total_expected = float(kpis.get("total_expected_kwh") or 0.0)
        deviation_pct = float(kpis.get("deviation_pct") or 0.0)

        # ── Pattern-matched path ──────────────────────────────────────────────
        hours_data: List[Dict[str, Any]] = []
        if insights:
            try:
                hours_data = list(insights.get("hours") or [])
            except Exception:
                hours_data = []

        patterns = _detect_patterns(
            hours_data=hours_data,
            window_hours=window_hours,
            total_actual=total_actual,
            total_expected=total_expected,
            deviation_pct=deviation_pct,
        )

        if patterns:
            results: List[Dict[str, Any]] = []
            for idx, pattern in enumerate(patterns, start=1):
                opp = _build_opportunity(
                    opp_id=idx,
                    pattern=pattern,
                    window_hours=window_hours,
                    price=price,
                    currency=currency,
                    emission_factor=self.emission_factor,
                )
                if opp:
                    results.append(opp)
            if results:
                return results

        # ── Generic fallback (only when no pattern detected) ──────────────────
        logger.info(
            "No specific pattern detected for site — falling back to generic measures. "
            "excess_kwh=%.1f deviation_pct=%.1f",
            excess_kwh_window,
            deviation_pct,
        )
        return self._generic_fallback(
            excess_kwh_window=excess_kwh_window,
            window_hours=window_hours,
            price=price,
            currency=currency,
        )

    def _generic_fallback(
        self,
        excess_kwh_window: float,
        window_hours: int,
        price: float,
        currency: str,
    ) -> List[Dict[str, Any]]:
        """
        Original generic engine — used only when pattern detection finds nothing.
        Kept for backwards compatibility and as a safety net.
        """
        annual_excess = _annualize(excess_kwh_window, window_hours)

        specs = [
            {"id": 1, "name": "LED lighting upgrade",
             "description": "Replace legacy lighting with LED and tighten night-time switching.",
             "capture_rate": 0.08, "capex_eur": 2_000.0},
            {"id": 2, "name": "HVAC schedule optimisation",
             "description": "Reduce off-shift HVAC runtime and align setpoints with actual occupancy.",
             "capture_rate": 0.06, "capex_eur": 1_000.0},
            {"id": 3, "name": "Compressed air leak programme",
             "description": "Survey and fix leaks; tune pressure bands; enforce shutoff off-shift.",
             "capture_rate": 0.10, "capex_eur": 1_500.0},
        ]

        measures = []
        for s in specs:
            est_kwh = round(annual_excess * s["capture_rate"], 0)
            if est_kwh < 100:
                continue
            est_cost = _cost(est_kwh, price)
            roi = _roi(float(s["capex_eur"]), est_cost)
            measures.append({
                "id": int(s["id"]),
                "name": s["name"],
                "description": s["description"],
                "pattern_id": "generic",
                "affected_hours": [],
                "peak_z_score": None,
                "excess_kwh_window": round(excess_kwh_window, 1),
                "est_annual_kwh_saved": float(est_kwh),
                "est_capex_eur": float(s["capex_eur"]),
                "simple_roi_years": roi,
                "est_co2_tons_saved_per_year": _co2(est_kwh, self.emission_factor),
                "est_annual_cost_saved": float(est_cost),
                "currency_code": currency,
                "source": "auto_generic",
            })

        measures.sort(key=lambda m: m.get("simple_roi_years") or 1e9)
        return measures