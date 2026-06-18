"""
CBAM Exposure Summary
======================
A non-technical, commercialista-facing document that translates the
CEI emissions engine output into plain business language:

  - Is this factory exposed to CBAM?
  - What is their estimated CO2 position in euros?
  - What is the gap vs the EU sector benchmark?
  - What happens if they use default values vs verified data?
  - What is the recommended next action?

Designed to be handed by a commercialista to a factory owner in a
client meeting. No kWh. No EnPI curves. Euros and risk, clearly stated.

Input dict keys
---------------
# Organisation
org_name            str
org_id              int
sector_code         str   -- "ceramics" | "cement" | "steel" | ...
country_code        str   -- ISO 3166-1 alpha-3
reporting_year      int

# Emissions (from EmissionsResult)
total_tco2          float  -- verified tCO2 from CEI engine
annualised_tco2     float  -- projected annual tCO2
free_allocation_tonnes  float | None
ets_surplus_deficit     float | None   -- positive=surplus, negative=deficit
ets_credit_cost_eur     float | None   -- cost if deficit
cbam_confidence     str    -- "none"|"low"|"medium"|"high"
data_window_days    int

# Benchmark
benchmark_value     float | None  -- tCO2/tonne sector benchmark
actual_intensity    float | None
benchmark_gap_pct   float | None  -- positive = above benchmark (worse)

# CBAM specifics
cbam_default_factor float | None  -- default EF if no verified data (kg CO2/kWh)
cbam_verified_factor float | None -- verified EF used by CEI
default_vs_verified_delta_eur float | None  -- extra cost from using defaults

# Carbon price
ets_carbon_price_eur  float  -- EUR/tCO2, e.g. 65.0

# Signatory (commercialista)
partner_name        str | None
partner_role        str | None   -- "Dottore Commercialista"
report_date         str | None   -- ISO date string

Usage
-----
    from app.services.pdf.cbam_exposure_summary import generate_cbam_exposure_pdf
    buf = generate_cbam_exposure_pdf(data, lang="it", partner_name="Studio Pincelli & Associati")
    return StreamingResponse(buf, media_type="application/pdf")
"""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, Optional

from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

from .base import (
    C_ACCENT, C_GREEN, C_GREEN_D, C_AMBER, C_RED,
    C_SURFACE, C_TEXT_LT, C_TEXT_DK, C_MUTED_DK,
    C_BORDER, C_ROW_ALT, C_BOX_BG, C_HIGHLIGHT,
    CONTENT_W,
    CEIDocTemplate,
    compliance_box,
    data_table,
    get_styles,
    info_box,
    kv_table,
    result_box,
    section_title,
    signature_block,
    spacer,
    _FONT_BOLD, _FONT_REGULAR, _FONT_SEMIBOLD,
)
from .i18n import fmt_date


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _eur(value: float, decimals: int = 0) -> str:
    """Format a euro value: €1,234 or €1,234.56"""
    if decimals == 0:
        return f"€{value:,.0f}"
    return f"€{value:,.{decimals}f}"


def _tco2(value: float, decimals: int = 1) -> str:
    return f"{value:,.{decimals}f} tCO₂"


def _pct(value: float) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.1f}%"


def _confidence_label(c: str) -> str:
    return {
        "none":   "Insufficient data",
        "low":    "Low  (< 30 days)",
        "medium": "Medium  (30–90 days)",
        "high":   "High  (90+ days)",
    }.get(c, c)


def _sector_display(code: str) -> str:
    return {
        "ceramics":    "Ceramics / Ceramic Products",
        "cement":      "Cement & Clinker",
        "steel":       "Iron, Steel & Ferro-alloys",
        "aluminium":   "Aluminium",
        "fertilizers": "Fertilizers",
        "hydrogen":    "Hydrogen",
        "glass":       "Glass",
        "chemicals":   "Chemicals",
    }.get((code or "").lower(), (code or "").title())


def _risk_color(gap_pct: Optional[float]) -> HexColor:
    if gap_pct is None:
        return C_AMBER
    if gap_pct <= 0:
        return C_GREEN
    if gap_pct <= 10:
        return C_AMBER
    return C_RED


def _risk_label(gap_pct: Optional[float]) -> str:
    if gap_pct is None:
        return "Benchmark data unavailable"
    if gap_pct <= 0:
        return f"Below benchmark — {abs(gap_pct):.1f}% better than EU sector average"
    if gap_pct <= 10:
        return f"Marginally above benchmark — {gap_pct:.1f}% above EU sector average"
    return f"Significantly above benchmark — {gap_pct:.1f}% above EU sector average"


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _section_executive_summary(data: Dict, s: dict, lang: str) -> list:
    """One-paragraph plain-language summary of the CBAM position."""
    org = data.get("org_name", "This organisation")
    year = data.get("reporting_year", 2025)
    sector = _sector_display(data.get("sector_code", ""))
    annualised = data.get("annualised_tco2")
    deficit = data.get("ets_surplus_deficit")
    cost = data.get("ets_credit_cost_eur")
    gap_pct = data.get("benchmark_gap_pct")
    default_delta = data.get("default_vs_verified_delta_eur")

    lines = []

    # Opening statement
    if annualised:
        lines.append(
            f"<b>{org}</b> operates in the <b>{sector}</b> sector and is subject to EU CBAM "
            f"reporting obligations under Regulation (EU) 2023/956. Based on energy data "
            f"analysed by CEI, the organisation's projected annual CO₂ emissions for {year} "
            f"are estimated at <b>{_tco2(annualised)}</b>."
        )
    else:
        lines.append(
            f"<b>{org}</b> operates in the <b>{sector}</b> sector and is subject to EU CBAM "
            f"reporting obligations under Regulation (EU) 2023/956."
        )

    # ETS position
    if deficit is not None:
        if deficit < 0:
            lines.append(
                f"The organisation's current ETS position shows a <b>deficit of "
                f"{_tco2(abs(deficit))}</b>, representing an estimated liability of "
                f"<b>{_eur(abs(cost or 0))}</b> at current carbon prices."
            )
        else:
            lines.append(
                f"The organisation's current ETS position shows a <b>surplus of "
                f"{_tco2(deficit)}</b>, which may be banked or sold on the ETS market."
            )

    # Default vs verified penalty
    if default_delta and default_delta > 0:
        lines.append(
            f"If the organisation files its CBAM declaration using EU default emission "
            f"factors rather than its own verified baseline, it is estimated to pay "
            f"<b>{_eur(default_delta)} more</b> than necessary. Establishing a verified "
            f"baseline with CEI eliminates this unnecessary cost."
        )

    # Benchmark position
    if gap_pct is not None:
        if gap_pct > 0:
            lines.append(
                f"Against the EU sector benchmark for {sector.lower()}, the organisation "
                f"is currently <b>{gap_pct:.1f}% above</b> the reference efficiency level. "
                f"This gap will be subject to increasing scrutiny under ETS Phase 4 "
                f"benchmark ratcheting (−4.4%/year from 2026)."
            )
        else:
            lines.append(
                f"Against the EU sector benchmark for {sector.lower()}, the organisation "
                f"is <b>{abs(gap_pct):.1f}% below</b> the reference level — a competitive "
                f"advantage that should be preserved and documented."
            )

    # Action required
    lines.append(
        "A verified energy baseline, produced from existing utility bills with no hardware "
        "installation required, is the single most important action this organisation can "
        "take before the September 2027 CBAM declaration deadline."
    )

    elements = section_title("Executive Summary")
    for line in lines:
        elements.append(Paragraph(line, s["body"]))
        elements.append(Spacer(1, 3 * mm))
    return elements


def _section_cbam_position(data: Dict, s: dict) -> list:
    """Key numbers: emissions, ETS position, financial exposure."""
    elements = section_title("CBAM & ETS Position")

    total = data.get("total_tco2", 0.0)
    annualised = data.get("annualised_tco2")
    free_alloc = data.get("free_allocation_tonnes")
    deficit = data.get("ets_surplus_deficit")
    cost = data.get("ets_credit_cost_eur")
    price = data.get("ets_carbon_price_eur", 65.0)
    confidence = data.get("cbam_confidence", "none")
    days = data.get("data_window_days", 0)

    rows = [
        ("Verified CO₂ (measurement period)", _tco2(total)),
        ("Projected annual CO₂", _tco2(annualised) if annualised else "Insufficient data"),
        ("EU free allocation", _tco2(free_alloc) if free_alloc else "Not configured"),
        ("ETS surplus / (deficit)", (
            f"+{_tco2(deficit)}" if deficit and deficit > 0
            else _tco2(deficit) if deficit is not None
            else "Not configured"
        )),
        ("Estimated financial exposure", (
            _eur(abs(cost)) if cost and cost < 0
            else ("Surplus — no purchase required" if deficit and deficit > 0 else "Not configured")
        )),
        ("Carbon price used (EUR/tCO₂)", f"€{price:.2f}"),
        ("Data confidence level", _confidence_label(confidence)),
        ("Days of energy data analysed", f"{days} days"),
    ]
    elements.append(kv_table(rows))
    elements.append(spacer(4))

    # Financial exposure result box if deficit
    if deficit is not None and deficit < 0 and cost:
        elements.append(result_box(
            label="ESTIMATED ETS LIABILITY",
            value=_eur(abs(cost)),
            unit="at current carbon prices",
            sub=f"Based on {_tco2(abs(deficit))} deficit × €{price:.0f}/tCO₂",
        ))
        elements.append(spacer(4))

    return elements


def _section_default_vs_verified(data: Dict, s: dict) -> list:
    """The cost of filing with default values vs verified baseline."""
    elements = section_title("Default vs. Verified Baseline: Cost Impact")

    default_factor = data.get("cbam_default_factor")
    verified_factor = data.get("cbam_verified_factor")
    delta = data.get("default_vs_verified_delta_eur")
    annualised = data.get("annualised_tco2")

    if default_factor is None and delta is None:
        elements.append(info_box(
            "Default vs. verified comparison requires emission factor configuration. "
            "Contact CEI to complete your emissions baseline setup.",
            color=C_AMBER,
        ))
        return elements

    rows = []
    if default_factor:
        rows.append(("EU default emission factor", f"{default_factor:.4f} kg CO₂/kWh"))
    if verified_factor:
        rows.append(("CEI verified emission factor", f"{verified_factor:.4f} kg CO₂/kWh"))
    if annualised and default_factor and verified_factor:
        default_tco2 = annualised * (default_factor / verified_factor) if verified_factor else annualised
        rows.append(("Emissions using default factor (projected)", _tco2(default_tco2)))
        rows.append(("Emissions using verified baseline (projected)", _tco2(annualised)))
    if delta is not None:
        rows.append(("Additional cost from using default values", _eur(delta)))

    if rows:
        elements.append(kv_table(rows))
        elements.append(spacer(3))

    if delta and delta > 0:
        elements.append(compliance_box(
            f"By establishing a verified energy baseline with CEI, {data.get('org_name', 'this organisation')} "
            f"avoids an estimated <b>{_eur(delta)}</b> in unnecessary CBAM compliance costs. "
            f"The baseline requires only existing utility bills — no hardware, no site visits."
        ))

    return elements


def _section_benchmark(data: Dict, s: dict) -> list:
    """ETS Phase 4 benchmark position."""
    elements = section_title("EU Sector Benchmark Position")

    gap_pct = data.get("benchmark_gap_pct")
    benchmark = data.get("benchmark_value")
    actual = data.get("actual_intensity")
    sector = _sector_display(data.get("sector_code", ""))

    if benchmark is None:
        elements.append(info_box(
            "Benchmark comparison requires production volume data. "
            "Contact CEI to configure your production baseline.",
            color=C_AMBER,
        ))
        return elements

    rows = [
        ("EU sector benchmark (tCO₂/tonne product)", f"{benchmark:.4f}"),
        ("Organisation actual intensity (tCO₂/tonne)", f"{actual:.4f}" if actual else "Not calculated"),
        ("Gap vs. benchmark", _pct(gap_pct) if gap_pct is not None else "N/A"),
        ("Sector", sector),
    ]
    elements.append(kv_table(rows))
    elements.append(spacer(3))

    color = _risk_color(gap_pct)
    elements.append(info_box(_risk_label(gap_pct), color=color))
    elements.append(spacer(3))

    # ETS Phase 4 ratchet context
    elements.append(compliance_box(
        "Under EU ETS Phase 4 (2021–2030), free allocations are reduced by 4.4% per year "
        "from 2026 onwards. Organisations above the sector benchmark receive fewer free "
        "allowances, increasing their financial exposure annually. Organisations below the "
        "benchmark are protected and may accumulate surplus allowances."
    ))

    return elements


def _section_cbam_timeline(s: dict, year: int) -> list:
    """CBAM key deadlines."""
    elements = section_title("CBAM Compliance Timeline")

    milestones = [
        ("January 2026",      "CBAM transitional period ends. Full obligations begin."),
        ("Q1 2026",           "First annual CBAM declaration due for goods imported in 2025."),
        ("January 2027",      "Free allocation reductions accelerate under ETS Phase 4."),
        ("September 2027",    "CBAM declaration deadline for 2026 reporting year. "
                              "Organisations without verified baselines must use EU defaults."),
        ("2028 onwards",      "Full CBAM pricing in effect. Verified baselines become "
                              "essential for cost optimisation."),
    ]

    # Highlight the critical 2027 deadline
    critical_year = year <= 2026

    rows_data = []
    for date_str, desc in milestones:
        is_critical = "September 2027" in date_str
        rows_data.append([date_str, desc, "⚠ CRITICAL" if is_critical else ""])

    t = data_table(
        headers=["Deadline", "Obligation", "Priority"],
        rows=rows_data,
        col_widths=[38 * mm, 115 * mm, 22 * mm],
        right_align_from=2,
    )
    elements.append(t)
    elements.append(spacer(4))

    elements.append(info_box(
        "The September 2027 CBAM declaration is the first filing where verified "
        "per-process emission data significantly impacts costs. Organisations that "
        "establish their baseline before this date avoid the default-value penalty.",
        color=C_ACCENT,
    ))

    return elements


def _section_recommended_actions(data: Dict, s: dict) -> list:
    """Actionable next steps."""
    elements = section_title("Recommended Actions")

    confidence = data.get("cbam_confidence", "none")
    deficit = data.get("ets_surplus_deficit")
    gap_pct = data.get("benchmark_gap_pct")

    actions = []

    # Always recommend baseline
    actions.append((
        "1",
        "Establish verified energy baseline",
        "Complete the 30-day CEI diagnostic to produce a per-process verified baseline "
        "from existing utility bills. Required for CBAM September 2027 declaration.",
        "Immediate",
    ))

    if confidence in ("none", "low"):
        actions.append((
            "2",
            "Extend data collection period",
            "Provide 90+ days of energy bills or meter data to achieve high-confidence "
            "CBAM extrapolation. Current data window is insufficient for regulatory filing.",
            "Within 30 days",
        ))

    if deficit is not None and deficit < 0:
        actions.append((
            "3" if confidence not in ("none", "low") else "3",
            "Review ETS position and purchase strategy",
            "The current ETS deficit requires either purchasing carbon allowances or "
            "implementing energy reduction measures before the compliance deadline.",
            "Q3 2026",
        ))

    if gap_pct is not None and gap_pct > 5:
        actions.append((
            str(len(actions) + 1),
            "Energy efficiency gap assessment",
            f"The organisation is {gap_pct:.1f}% above the EU sector benchmark. A CEI "
            "opportunity assessment will identify the highest-ROI efficiency measures "
            "to close this gap before ETS Phase 4 ratcheting increases the cost.",
            "Q4 2026",
        ))

    actions.append((
        str(len(actions) + 1),
        "Configure CBAM declaration parameters",
        "Align emission factor configuration with the EU CBAM Implementing Regulation "
        "to ensure declaration accuracy. CEI generates all required supporting documentation.",
        "Before Q1 2027",
    ))

    rows_data = [[a[0], a[1], a[2], a[3]] for a in actions]
    t = data_table(
        headers=["#", "Action", "Description", "Timeline"],
        rows=rows_data,
        col_widths=[8 * mm, 42 * mm, 100 * mm, 25 * mm],
        right_align_from=3,
    )
    elements.append(t)

    return elements


def _section_signature(data: Dict, s: dict) -> list:
    """Sign-off block for the commercialista."""
    elements = section_title("Professional Sign-Off")

    partner = data.get("partner_name", "")
    role = data.get("partner_role", "Dottore Commercialista")
    report_date = data.get("report_date", "")
    org_name = data.get("org_name", "")

    if partner:
        elements.append(Paragraph(
            f"This report has been prepared by <b>{partner}</b> using energy data "
            f"analysed by Carbon Efficiency Intelligence for <b>{org_name}</b>. "
            f"The findings are based on available data and should be reviewed in "
            f"conjunction with the organisation's full compliance documentation.",
            s["small"],
        ))
        elements.append(spacer(4))
        elements.append(signature_block(
            name=partner,
            organisation=partner,
            date_str=report_date or "_______________",
            role=role or "Dottore Commercialista",
        ))
    else:
        elements.append(compliance_box(
            "This report has been generated by Carbon Efficiency Intelligence "
            "and is provided for informational purposes. It does not constitute "
            "legal or regulatory advice."
        ))

    return elements


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_cbam_exposure_pdf(
    data: Dict[str, Any],
    lang: str = "it",
    partner_name: Optional[str] = None,
) -> BytesIO:
    """
    Generate a CBAM Exposure Summary PDF.

    Parameters
    ----------
    data        : dict matching the schema described in the module docstring
    lang        : "it" | "en"
    partner_name: commercialista studio name (triggers co-branding)

    Returns
    -------
    BytesIO containing the PDF, ready for StreamingResponse
    """
    s = get_styles()

    # Resolve partner name from data or argument
    pname = partner_name or data.get("partner_name")

    # Also store in data for section builders
    if pname and "partner_name" not in data:
        data = {**data, "partner_name": pname}

    org_name  = data.get("org_name", "Organisation")
    year      = data.get("reporting_year", 2025)
    subtitle  = f"{org_name}  ·  CBAM Exposure Assessment  ·  {year}"

    buf = BytesIO()
    doc = CEIDocTemplate(
        buf,
        doc_title="CBAM Exposure Summary",
        doc_subtitle=subtitle,
        lang=lang,
        partner_name=pname,
    )

    story = []

    # ── Cover information ────────────────────────────────────────────────
    story.append(kv_table([
        ("Organisation",      org_name),
        ("Sector",            _sector_display(data.get("sector_code", ""))),
        ("Reporting year",    str(year)),
        ("Country",           data.get("country_code", "—")),
        ("Report date",       data.get("report_date", fmt_date("", lang) or "—")),
        ("Prepared by",       pname or "Carbon Efficiency Intelligence"),
        ("Data confidence",   _confidence_label(data.get("cbam_confidence", "none"))),
    ]))
    story.append(spacer(6))

    # ── Sections ─────────────────────────────────────────────────────────
    story += _section_executive_summary(data, s, lang)
    story.append(spacer(4))

    story += _section_cbam_position(data, s)
    story.append(spacer(4))

    story += _section_default_vs_verified(data, s)
    story.append(spacer(4))

    story += _section_benchmark(data, s)
    story.append(spacer(4))

    story += _section_cbam_timeline(s, year)
    story.append(spacer(4))

    story += _section_recommended_actions(data, s)
    story.append(spacer(6))

    story += _section_signature(data, s)

    doc.build(story)
    buf.seek(0)
    return buf
