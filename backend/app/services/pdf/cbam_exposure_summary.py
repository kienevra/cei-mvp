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
from .i18n import fmt_date, t


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _eur(value: float, decimals: int = 0) -> str:
    """Format a euro value: €1,234 or €1,234.56"""
    if decimals == 0:
        return f"€{value:,.0f}"
    return f"€{value:,.{decimals}f}"


def _tco2(value: float, decimals: int = 1) -> str:
    return f"{value:,.{decimals}f} tCO2"


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

    if annualised:
        lines.append(t("cbam_exec_subject_cbam", lang).format(
            org=f"<b>{org}</b>", sector=f"<b>{sector}</b>", year=year, tco2=f"<b>{_tco2(annualised)}</b>"
        ))
    else:
        lines.append(t("cbam_exec_subject_no_data", lang).format(
            org=f"<b>{org}</b>", sector=f"<b>{sector}</b>"
        ))

    if deficit is not None:
        if deficit < 0:
            lines.append(t("cbam_exec_deficit", lang).format(
                tco2=f"<b>{_tco2(abs(deficit))}</b>", eur=f"<b>{_eur(abs(cost or 0))}</b>"
            ))
        else:
            lines.append(t("cbam_exec_surplus", lang).format(tco2=f"<b>{_tco2(deficit)}</b>"))

    if default_delta and default_delta > 0:
        lines.append(t("cbam_exec_default_penalty", lang).format(eur=f"<b>{_eur(default_delta)}</b>"))

    if gap_pct is not None:
        if gap_pct > 0:
            lines.append(t("cbam_exec_above_benchmark", lang).format(
                sector=sector.lower(), pct=f"<b>{gap_pct:.1f}</b>"
            ))
        else:
            lines.append(t("cbam_exec_below_benchmark", lang).format(
                sector=sector.lower(), pct=f"<b>{abs(gap_pct):.1f}</b>"
            ))

    lines.append(t("cbam_exec_action", lang))

    elements = section_title(t("cbam_exec_summary_title", lang))
    for line in lines:
        elements.append(Paragraph(line, s["body"]))
        elements.append(Spacer(1, 3 * mm))
    return elements


def _section_cbam_position(data: Dict, s: dict, lang: str = "en") -> list:
    """Key numbers: emissions, ETS position, financial exposure."""
    elements = section_title(t("cbam_position_title", lang))

    total = data.get("total_tco2", 0.0)
    annualised = data.get("annualised_tco2")
    free_alloc = data.get("free_allocation_tonnes")
    deficit = data.get("ets_surplus_deficit")
    cost = data.get("ets_credit_cost_eur")
    price = data.get("ets_carbon_price_eur", 65.0)
    confidence = data.get("cbam_confidence", "none")
    days = data.get("data_window_days", 0)

    rows = [
        (t("cbam_pos_verified_co2", lang),       _tco2(total)),
        (t("cbam_pos_projected_co2", lang),      _tco2(annualised) if annualised else t("cbam_pos_insufficient", lang)),
        (t("cbam_pos_free_alloc", lang),         _tco2(free_alloc) if free_alloc else t("cbam_pos_not_configured", lang)),
        (t("cbam_pos_surplus_deficit", lang),    (
            f"+{_tco2(deficit)}" if deficit and deficit > 0
            else _tco2(deficit) if deficit is not None
            else t("cbam_pos_not_configured", lang)
        )),
        (t("cbam_pos_financial_exposure", lang), (
            _eur(abs(cost)) if cost and cost < 0
            else (t("cbam_pos_surplus_no_purchase", lang) if deficit and deficit > 0 else t("cbam_pos_not_configured", lang))
        )),
        (t("cbam_pos_carbon_price", lang),       f"€{price:.2f}"),
        (t("cbam_pos_confidence", lang),         _confidence_label(confidence)),
        (t("cbam_pos_days", lang),               t("cbam_pos_days_unit", lang).format(n=days)),
    ]
    elements.append(kv_table(rows))
    elements.append(spacer(4))

    if deficit is not None and deficit < 0 and cost:
        elements.append(result_box(
            label=t("cbam_liability_label", lang),
            value=_eur(abs(cost)),
            unit=t("cbam_liability_unit", lang),
            sub=t("cbam_liability_sub", lang).format(tco2=_tco2(abs(deficit)), price=f"{price:.0f}"),
        ))
        elements.append(spacer(4))

    return elements


def _section_default_vs_verified(data: Dict, s: dict, lang: str = "en") -> list:
    """The cost of filing with default values vs verified baseline."""
    elements = section_title(t("cbam_default_vs_verified_title", lang))

    default_factor = data.get("cbam_default_factor")
    verified_factor = data.get("cbam_verified_factor")
    delta = data.get("default_vs_verified_delta_eur")
    annualised = data.get("annualised_tco2")

    if default_factor is None and delta is None:
        elements.append(info_box(t("cbam_dvv_no_config", lang), color=C_AMBER))
        return elements

    rows = []
    if default_factor:
        rows.append((t("cbam_dvv_default_ef", lang), f"{default_factor:.4f} kg CO2/kWh"))
    if verified_factor:
        rows.append((t("cbam_dvv_verified_ef", lang), f"{verified_factor:.4f} kg CO2/kWh"))
    if annualised and default_factor and verified_factor:
        default_tco2 = annualised * (default_factor / verified_factor) if verified_factor else annualised
        rows.append((t("cbam_dvv_default_tco2", lang), _tco2(default_tco2)))
        rows.append((t("cbam_dvv_verified_tco2", lang), _tco2(annualised)))
    if delta is not None:
        rows.append((t("cbam_dvv_extra_cost", lang), _eur(delta)))

    if rows:
        elements.append(kv_table(rows))
        elements.append(spacer(3))

    if delta and delta > 0:
        elements.append(compliance_box(
            t("cbam_dvv_saving", lang).format(
                org=data.get("org_name", "this organisation"), eur=f"<b>{_eur(delta)}</b>"
            )
        ))

    return elements


def _section_benchmark(data: Dict, s: dict, lang: str = "en") -> list:
    """ETS Phase 4 benchmark position."""
    elements = section_title(t("cbam_benchmark_title", lang))

    gap_pct = data.get("benchmark_gap_pct")
    benchmark = data.get("benchmark_value")
    actual = data.get("actual_intensity")
    sector = _sector_display(data.get("sector_code", ""))

    if benchmark is None:
        elements.append(info_box(t("cbam_bm_no_production", lang), color=C_AMBER))
        return elements

    rows = [
        (t("cbam_bm_eu_benchmark", lang),     f"{benchmark:.4f}"),
        (t("cbam_bm_actual_intensity", lang),  f"{actual:.4f}" if actual else t("cbam_bm_not_calculated", lang)),
        (t("cbam_bm_gap", lang),              _pct(gap_pct) if gap_pct is not None else t("cbam_bm_na", lang)),
        (t("cbam_bm_sector", lang),           sector),
    ]
    elements.append(kv_table(rows))
    elements.append(spacer(3))

    color = _risk_color(gap_pct)
    elements.append(info_box(_risk_label(gap_pct), color=color))
    elements.append(spacer(3))

    elements.append(compliance_box(t("cbam_bm_ets_context", lang)))

    return elements


def _section_cbam_timeline(s: dict, year: int, lang: str = "en") -> list:
    """CBAM key deadlines."""
    elements = section_title(t("cbam_timeline_title", lang))

    milestones = [
        ("January 2026",   t("cbam_tl_jan2026", lang)),
        ("Q1 2026",        t("cbam_tl_q12026", lang)),
        ("January 2027",   t("cbam_tl_jan2027", lang)),
        ("September 2027", t("cbam_tl_sep2027", lang)),
        ("2028 onwards",   t("cbam_tl_2028", lang)),
    ]

    rows_data = []
    for date_str, desc in milestones:
        is_critical = "September 2027" in date_str
        rows_data.append([date_str, desc, t("cbam_tl_critical", lang) if is_critical else ""])

    tbl = data_table(
        headers=[t("cbam_tl_deadline", lang), t("cbam_tl_obligation", lang), t("cbam_tl_priority", lang)],
        rows=rows_data,
        col_widths=[38 * mm, 115 * mm, 22 * mm],
        right_align_from=2,
    )
    elements.append(tbl)
    elements.append(spacer(4))

    elements.append(info_box(t("cbam_tl_note", lang), color=C_ACCENT))

    return elements


def _section_recommended_actions(data: Dict, s: dict, lang: str = "en") -> list:
    """Actionable next steps."""
    elements = section_title(t("cbam_actions_title", lang))

    confidence = data.get("cbam_confidence", "none")
    deficit = data.get("ets_surplus_deficit")
    gap_pct = data.get("benchmark_gap_pct")

    actions = []

    actions.append(("1", t("cbam_act_1_title", lang), t("cbam_act_1_desc", lang), t("cbam_act_1_timeline", lang)))

    if confidence in ("none", "low"):
        actions.append((str(len(actions) + 1), t("cbam_act_2_title", lang), t("cbam_act_2_desc", lang), t("cbam_act_2_timeline", lang)))

    if deficit is not None and deficit < 0:
        actions.append((str(len(actions) + 1), t("cbam_act_3_title", lang), t("cbam_act_3_desc", lang), t("cbam_act_3_timeline", lang)))

    if gap_pct is not None and gap_pct > 5:
        actions.append((
            str(len(actions) + 1),
            t("cbam_act_4_title", lang),
            t("cbam_act_4_desc", lang).format(pct=f"{gap_pct:.1f}"),
            t("cbam_act_4_timeline", lang),
        ))

    actions.append((str(len(actions) + 1), t("cbam_act_5_title", lang), t("cbam_act_5_desc", lang), t("cbam_act_5_timeline", lang)))

    rows_data = [[a[0], a[1], a[2], a[3]] for a in actions]
    tbl = data_table(
        headers=[t("cbam_act_hash", lang), t("cbam_act_action", lang), t("cbam_act_description", lang), t("cbam_act_timeline", lang)],
        rows=rows_data,
        col_widths=[8 * mm, 42 * mm, 100 * mm, 25 * mm],
        right_align_from=3,
    )
    elements.append(tbl)

    return elements


def _section_signature(data: Dict, s: dict, lang: str = "en") -> list:
    """Sign-off block."""
    elements = section_title("Professional Sign-Off")

    partner = data.get("partner_name", "")
    role = data.get("partner_role") or ("Dottore Commercialista" if lang == "it" else "Chartered Accountant")
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
            role=role or ("Dottore Commercialista" if lang == "it" else "Chartered Accountant"),
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
        (t("cbam_org_label", lang),         org_name),
        (t("cbam_sector_label", lang),      _sector_display(data.get("sector_code", ""))),
        (t("cbam_year_label", lang),        str(year)),
        (t("cbam_country_label", lang),     data.get("country_code", "—")),
        (t("cbam_date_label", lang),        data.get("report_date", fmt_date("", lang) or "—")),
        (t("cbam_prepared_by_label", lang), pname or "Carbon Efficiency Intelligence"),
        (t("cbam_confidence_label", lang),  _confidence_label(data.get("cbam_confidence", "none"))),
    ]))
    story.append(spacer(6))

    # ── Sections ─────────────────────────────────────────────────────────
    story += _section_executive_summary(data, s, lang)
    story.append(spacer(4))

    story += _section_cbam_position(data, s, lang)
    story.append(spacer(4))

    story += _section_default_vs_verified(data, s, lang)
    story.append(spacer(4))

    story += _section_benchmark(data, s, lang)
    story.append(spacer(4))

    story += _section_cbam_timeline(s, year, lang)
    story.append(spacer(4))

    story += _section_recommended_actions(data, s, lang)
    story.append(spacer(6))

    story += _section_signature(data, s, lang)

    doc.build(story)
    buf.seek(0)
    return buf
