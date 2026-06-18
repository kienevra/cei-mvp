"""
Compliance Readiness Assessment
=================================
A structured red/amber/green scorecard that tells a factory owner exactly
where they stand across five compliance dimensions:

  1. CBAM Baseline Readiness
  2. ETS Phase 4 Position
  3. ISO 50001 / EnPI Alignment
  4. Data Quality & Monitoring
  5. Regulatory Documentation

Each dimension gets a RAG status, a score, and a plain-language finding.
The document closes with a priority action matrix and sign-off block.

Designed to be handed by a commercialista to a factory owner as the
"where are you now" companion to the CBAM Exposure Summary's "what does
it cost you".

Input dict keys
---------------
# Organisation
org_name            str
org_id              int
sector_code         str
country_code        str
reporting_year      int

# CBAM readiness
cbam_confidence         str    -- "none"|"low"|"medium"|"high"
data_window_days        int
has_verified_baseline   bool
cbam_declaration_filed  bool   -- has the org filed a CBAM declaration before?

# ETS position
ets_configured          bool
free_allocation_tonnes  float | None
ets_surplus_deficit     float | None
benchmark_gap_pct       float | None

# ISO 50001 / EnPI
enpi_configured         bool
production_volume       float | None
production_unit         str | None
enpi_kwh_per_unit       float | None
has_iso50001            bool   -- certified?

# Data quality
data_points             int
has_interval_meter      bool   -- live interval meter or manual bills?
data_gaps_pct           float  -- % of expected readings missing (0-100)
last_data_date          str | None  -- ISO date of most recent reading

# Documentation
has_mrv_report          bool
has_ets_statement       bool
has_enpi_report         bool
has_correlation_report  bool

# Signatory
partner_name            str | None
partner_role            str | None
report_date             str | None

Usage
-----
    from app.services.pdf.compliance_readiness_assessment import generate_compliance_readiness_pdf
    buf = generate_compliance_readiness_pdf(data, lang="it", partner_name="Studio Pincelli & Associati")
    return StreamingResponse(buf, media_type="application/pdf")
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

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
# RAG status
# ---------------------------------------------------------------------------

@dataclass
class RAGItem:
    dimension:  str
    status:     str          # "green" | "amber" | "red"
    score:      int          # 0-100
    headline:   str          # one-line finding
    detail:     str          # 1-2 sentence explanation
    action:     str          # recommended next step
    priority:   str          # "immediate" | "q3 2026" | "q1 2027" | "ongoing"


def _rag_color(status: str) -> HexColor:
    return {"green": C_GREEN, "amber": C_AMBER, "red": C_RED}.get(status, C_AMBER)


def _rag_label(status: str) -> str:
    return {"green": "COMPLIANT", "amber": "ATTENTION", "red": "ACTION REQUIRED"}.get(status, status.upper())


def _score_bar_table(score: int, color: HexColor) -> Table:
    """A simple visual score bar: filled cells out of 10."""
    filled = round(score / 10)
    empty  = 10 - filled
    cell_w = 14 * mm
    cells  = []
    style_cmds = [
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 1),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 1),
        ("ROWHEIGHT",     (0, 0), (-1, -1), 5),
    ]
    for i in range(10):
        cells.append(Paragraph("", get_styles()["small"]))
        if i < filled:
            style_cmds.append(("BACKGROUND", (i, 0), (i, 0), color))
        else:
            style_cmds.append(("BACKGROUND", (i, 0), (i, 0), C_BORDER))
    t = Table([cells], colWidths=[cell_w] * 10)
    t.setStyle(TableStyle(style_cmds))
    return t


# ---------------------------------------------------------------------------
# Dimension evaluators
# ---------------------------------------------------------------------------

def _eval_cbam(data: Dict) -> RAGItem:
    confidence    = data.get("cbam_confidence", "none")
    days          = data.get("data_window_days", 0)
    has_baseline  = data.get("has_verified_baseline", False)
    filed_before  = data.get("cbam_declaration_filed", False)

    if confidence == "high" and has_baseline:
        return RAGItem(
            dimension="CBAM Baseline Readiness",
            status="green", score=90,
            headline="Verified baseline established — CBAM-ready",
            detail=(
                f"The organisation has {days} days of verified energy data producing a "
                f"high-confidence CBAM baseline. Regulatory filing can proceed with "
                f"verified emission factors rather than EU defaults."
            ),
            action="Maintain data continuity. File verified baseline with CBAM declaration.",
            priority="ongoing",
        )
    elif confidence == "medium":
        return RAGItem(
            dimension="CBAM Baseline Readiness",
            status="amber", score=55,
            headline="Partial baseline — extend to 90+ days for full confidence",
            detail=(
                f"The organisation has {days} days of data, producing a medium-confidence "
                f"CBAM baseline. A minimum of 90 days is recommended for a defensible "
                f"annual extrapolation under EU 2023/956."
            ),
            action="Continue data collection to reach 90-day threshold before Q1 2027.",
            priority="q3 2026",
        )
    elif confidence == "low":
        return RAGItem(
            dimension="CBAM Baseline Readiness",
            status="amber", score=30,
            headline="Insufficient data — low confidence baseline only",
            detail=(
                f"Only {days} days of data are available. A credible CBAM baseline "
                f"requires a minimum of 30 days; 90+ days for high confidence. "
                f"The organisation risks using EU default values for its declaration."
            ),
            action="Urgently provide 90 days of utility bills or meter data to CEI.",
            priority="immediate",
        )
    else:
        return RAGItem(
            dimension="CBAM Baseline Readiness",
            status="red", score=5,
            headline="No verified baseline — EU default values will apply",
            detail=(
                "No verified energy baseline exists. Without a baseline, the CBAM "
                "declaration must use EU default emission factors, which are typically "
                "less favourable than actual operational data and result in higher costs."
            ),
            action="Initiate CEI 30-day diagnostic immediately. Provide utility bills.",
            priority="immediate",
        )


def _eval_ets(data: Dict) -> RAGItem:
    configured  = data.get("ets_configured", False)
    deficit     = data.get("ets_surplus_deficit")
    gap_pct     = data.get("benchmark_gap_pct")
    free_alloc  = data.get("free_allocation_tonnes")

    if not configured or free_alloc is None:
        return RAGItem(
            dimension="ETS Phase 4 Position",
            status="amber", score=20,
            headline="ETS configuration incomplete",
            detail=(
                "Free allocation data has not been configured. Without this, it is "
                "not possible to calculate the organisation's ETS surplus or deficit "
                "position, or estimate financial exposure."
            ),
            action="Configure ETS free allocation in CEI emissions settings.",
            priority="immediate",
        )

    if deficit is None:
        return RAGItem(
            dimension="ETS Phase 4 Position",
            status="amber", score=25,
            headline="ETS position not calculated",
            detail="Emissions data is available but ETS position has not been computed.",
            action="Run ETS position calculation in CEI dashboard.",
            priority="q3 2026",
        )

    if deficit > 0 and (gap_pct is None or gap_pct <= 0):
        return RAGItem(
            dimension="ETS Phase 4 Position",
            status="green", score=85,
            headline=f"ETS surplus — {deficit:,.1f} tCO₂ available",
            detail=(
                f"The organisation holds a surplus of {deficit:,.1f} tCO₂ against its "
                f"free allocation. It is also at or below the EU sector benchmark, "
                f"providing protection against ETS Phase 4 ratcheting."
            ),
            action="Document surplus position. Monitor benchmark annually.",
            priority="ongoing",
        )
    elif deficit > 0:
        return RAGItem(
            dimension="ETS Phase 4 Position",
            status="amber", score=60,
            headline=f"ETS surplus but above benchmark",
            detail=(
                f"The organisation has a current surplus of {deficit:,.1f} tCO₂ but is "
                f"{gap_pct:.1f}% above the EU sector benchmark. As ETS Phase 4 ratchets "
                f"free allocations down 4.4%/year, this surplus will erode."
            ),
            action="Monitor benchmark gap. Initiate efficiency assessment before 2027.",
            priority="q3 2026",
        )
    else:
        score = max(10, 45 - int(abs(deficit) / 50))
        return RAGItem(
            dimension="ETS Phase 4 Position",
            status="red", score=score,
            headline=f"ETS deficit — {abs(deficit):,.1f} tCO₂ purchase required",
            detail=(
                f"The organisation has a deficit of {abs(deficit):,.1f} tCO₂ against its "
                f"free allocation. Carbon allowances must be purchased before the "
                f"compliance deadline, or energy reduction measures implemented."
            ),
            action="Quantify purchase cost. Evaluate energy reduction ROI vs. purchase cost.",
            priority="immediate",
        )


def _eval_iso50001(data: Dict) -> RAGItem:
    enpi_conf    = data.get("enpi_configured", False)
    prod_vol     = data.get("production_volume")
    enpi         = data.get("enpi_kwh_per_unit")
    has_cert     = data.get("has_iso50001", False)

    if has_cert:
        return RAGItem(
            dimension="ISO 50001 / EnPI Alignment",
            status="green", score=95,
            headline="ISO 50001 certified — full EnPI alignment",
            detail=(
                "The organisation holds ISO 50001 certification, demonstrating a "
                "structured energy management system. CEI EnPI metrics align with "
                "and supplement the existing certification framework."
            ),
            action="Ensure CEI EnPI baseline aligns with certified management system.",
            priority="ongoing",
        )
    elif enpi_conf and prod_vol and enpi:
        return RAGItem(
            dimension="ISO 50001 / EnPI Alignment",
            status="amber", score=65,
            headline="EnPI configured — ISO 50001 certification recommended",
            detail=(
                f"Energy Performance Indicators are configured with production data "
                f"({prod_vol:,.0f} units/year). The organisation is not ISO 50001 "
                f"certified, which would strengthen its compliance position and "
                f"support future CBAM benchmark documentation."
            ),
            action="Consider ISO 50001 certification pathway. CEI documentation supports audit.",
            priority="q1 2027",
        )
    elif enpi_conf:
        return RAGItem(
            dimension="ISO 50001 / EnPI Alignment",
            status="amber", score=35,
            headline="EnPI partially configured — production data missing",
            detail=(
                "The energy performance indicator framework is enabled but production "
                "volume data has not been provided. Without production data, "
                "energy intensity (kWh/unit) cannot be calculated."
            ),
            action="Provide annual production volume in CEI settings to complete EnPI setup.",
            priority="q3 2026",
        )
    else:
        return RAGItem(
            dimension="ISO 50001 / EnPI Alignment",
            status="red", score=10,
            headline="No EnPI configuration — energy intensity unmeasured",
            detail=(
                "Neither energy performance indicators nor production data have been "
                "configured. Without this, the organisation cannot demonstrate energy "
                "efficiency improvement, which is central to ISO 50001 and ETS benchmarking."
            ),
            action="Configure production data and EnPI baseline in CEI dashboard.",
            priority="q3 2026",
        )


def _eval_data_quality(data: Dict) -> RAGItem:
    points        = data.get("data_points", 0)
    has_meter     = data.get("has_interval_meter", False)
    gaps_pct      = data.get("data_gaps_pct", 0.0)
    last_date     = data.get("last_data_date")
    days          = data.get("data_window_days", 0)

    issues = []
    score  = 100

    if not has_meter:
        issues.append("manual bill entry (lower resolution than interval meter)")
        score -= 20

    if gaps_pct > 20:
        issues.append(f"{gaps_pct:.0f}% of expected readings missing")
        score -= 30
    elif gaps_pct > 5:
        issues.append(f"{gaps_pct:.0f}% minor data gaps")
        score -= 10

    if points < 100:
        issues.append(f"only {points} data points available")
        score -= 20

    if days < 30:
        issues.append(f"only {days} days of history")
        score -= 20

    score = max(5, score)

    if score >= 80:
        status = "green"
        headline = "Good data quality — suitable for regulatory filing"
    elif score >= 50:
        status = "amber"
        headline = "Acceptable data quality — improvements recommended"
    else:
        status = "red"
        headline = "Poor data quality — regulatory filing at risk"

    detail = (
        f"The organisation has {points} data points covering {days} days "
        f"({'interval meter' if has_meter else 'manual bill entry'})."
    )
    if issues:
        detail += f" Issues identified: {'; '.join(issues)}."

    action = (
        "Connect interval meter for real-time data." if not has_meter
        else "Resolve data gaps and ensure continuous monitoring."
    )

    priority = "immediate" if score < 50 else ("q3 2026" if score < 80 else "ongoing")

    return RAGItem(
        dimension="Data Quality & Monitoring",
        status=status, score=score,
        headline=headline,
        detail=detail,
        action=action,
        priority=priority,
    )


def _eval_documentation(data: Dict) -> RAGItem:
    has_mrv   = data.get("has_mrv_report", False)
    has_ets   = data.get("has_ets_statement", False)
    has_enpi  = data.get("has_enpi_report", False)
    has_corr  = data.get("has_correlation_report", False)

    count = sum([has_mrv, has_ets, has_enpi, has_corr])
    score = count * 25

    docs_present  = []
    docs_missing  = []

    for flag, name in [(has_mrv, "MRV Declaration"), (has_ets, "ETS Statement"),
                       (has_enpi, "EnPI Report"), (has_corr, "Correlation Report")]:
        (docs_present if flag else docs_missing).append(name)

    if count == 4:
        return RAGItem(
            dimension="Regulatory Documentation",
            status="green", score=100,
            headline="Full documentation suite — all 4 reports generated",
            detail=(
                "All four CEI compliance documents are available: MRV Declaration, "
                "ETS Position Statement, EnPI Baseline Report, and Correlation "
                "Assessment. The organisation is fully documented for regulatory review."
            ),
            action="Ensure documents are signed and filed before declaration deadline.",
            priority="ongoing",
        )
    elif count >= 2:
        missing_str = ", ".join(docs_missing)
        return RAGItem(
            dimension="Regulatory Documentation",
            status="amber", score=score,
            headline=f"{count}/4 compliance documents generated",
            detail=(
                f"Documents available: {', '.join(docs_present)}. "
                f"Missing: {missing_str}. Complete documentation is required for "
                f"a comprehensive CBAM/ETS compliance filing."
            ),
            action=f"Generate missing documents in CEI: {missing_str}.",
            priority="q3 2026",
        )
    else:
        return RAGItem(
            dimension="Regulatory Documentation",
            status="red", score=score,
            headline=f"Only {count}/4 compliance documents generated",
            detail=(
                "The organisation's compliance documentation is critically incomplete. "
                "Without the full suite of CEI regulatory reports, CBAM and ETS "
                "declarations cannot be supported with verified documentation."
            ),
            action="Generate all four CEI compliance reports immediately.",
            priority="immediate",
        )


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _section_overall_score(items: List[RAGItem], s: dict) -> list:
    """Overall readiness score and RAG summary table."""
    avg_score = sum(i.score for i in items) / len(items)

    if avg_score >= 75:
        overall_status = "green"
        overall_label  = "LARGELY COMPLIANT"
        overall_detail = "The organisation is well-positioned for CBAM/ETS compliance. Address amber items before declaration deadlines."
    elif avg_score >= 45:
        overall_status = "amber"
        overall_label  = "PARTIALLY READY"
        overall_detail = "Significant gaps exist that must be addressed before the September 2027 CBAM declaration deadline."
    else:
        overall_status = "red"
        overall_label  = "ACTION REQUIRED"
        overall_detail = "Critical compliance gaps identified. Immediate action is required across multiple dimensions."

    color = _rag_color(overall_status)

    elements = section_title("Overall Compliance Readiness")

    # Overall score result box
    elements.append(result_box(
        label="OVERALL READINESS SCORE",
        value=f"{avg_score:.0f}/100",
        unit=overall_label,
        sub=overall_detail,
    ))
    elements.append(spacer(5))

    # RAG summary table
    rows_data = []
    for item in items:
        status_label = _rag_label(item.status)
        rows_data.append([item.dimension, item.headline, status_label, str(item.score)])

    t = data_table(
        headers=["Dimension", "Finding", "Status", "Score"],
        rows=rows_data,
        col_widths=[52 * mm, 88 * mm, 25 * mm, 10 * mm],
        right_align_from=3,
    )
    elements.append(t)

    return elements


def _section_dimension(item: RAGItem, s: dict) -> list:
    """Full detail card for one RAG dimension."""
    color = _rag_color(item.status)
    elements = section_title(item.dimension)

    # Status banner
    banner_text = f"<b>{_rag_label(item.status)}</b>  —  Score: {item.score}/100"
    banner = Table([[Paragraph(banner_text, s["body_bold"])]], colWidths=[CONTENT_W])
    banner.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), color),
        ("TEXTCOLOR",     (0, 0), (-1, -1), C_TEXT_LT if item.status != "amber" else C_TEXT_DK),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    elements.append(banner)
    elements.append(spacer(2))

    # Score bar
    elements.append(_score_bar_table(item.score, color))
    elements.append(spacer(3))

    # Finding and action
    elements.append(kv_table([
        ("Finding",           item.detail),
        ("Recommended action", item.action),
        ("Priority",          item.priority.upper()),
    ]))

    return elements


def _section_priority_matrix(items: List[RAGItem], s: dict) -> list:
    """Prioritised action matrix — immediate items first."""
    elements = section_title("Priority Action Matrix")

    priority_order = {"immediate": 0, "q3 2026": 1, "q1 2027": 2, "ongoing": 3}
    sorted_items = sorted(items, key=lambda x: priority_order.get(x.priority.lower(), 99))

    rows_data = []
    for i, item in enumerate(sorted_items, 1):
        rows_data.append([
            str(i),
            item.dimension,
            item.action,
            item.priority.upper(),
            _rag_label(item.status),
        ])

    t = data_table(
        headers=["#", "Dimension", "Action", "Timeline", "Status"],
        rows=rows_data,
        col_widths=[8 * mm, 42 * mm, 90 * mm, 20 * mm, 15 * mm],
        right_align_from=3,
    )
    elements.append(t)
    elements.append(spacer(4))

    # Count immediate items
    immediate = [i for i in items if i.priority.lower() == "immediate"]
    if immediate:
        elements.append(info_box(
            f"{len(immediate)} item(s) require immediate attention before the next "
            f"CBAM reporting window. Delays increase financial exposure and reduce "
            f"the time available to establish a defensible verified baseline.",
            color=C_RED,
        ))

    return elements


def _section_next_steps(data: Dict, items: List[RAGItem], s: dict) -> list:
    """What the commercialista should propose to their client."""
    partner = data.get("partner_name")
    org     = data.get("org_name", "this organisation")

    elements = section_title("Proposed Next Steps")

    red_dims   = [i.dimension for i in items if i.status == "red"]
    amber_dims = [i.dimension for i in items if i.status == "amber"]

    text_parts = []

    if partner:
        text_parts.append(
            f"Based on this compliance readiness assessment, <b>{partner}</b> recommends "
            f"the following actions for <b>{org}</b>:"
        )
    else:
        text_parts.append(
            f"Based on this compliance readiness assessment, the following actions "
            f"are recommended for <b>{org}</b>:"
        )

    if red_dims:
        text_parts.append(
            f"<b>Critical (immediate):</b> {', '.join(red_dims)} require urgent attention. "
            f"These gaps directly impair the ability to file a compliant CBAM declaration."
        )

    if amber_dims:
        text_parts.append(
            f"<b>Important (next 90 days):</b> {', '.join(amber_dims)} should be resolved "
            f"before Q3 2026 to ensure full readiness for the September 2027 deadline."
        )

    text_parts.append(
        "The recommended first action is to initiate the CEI 30-day diagnostic, "
        "which produces the verified energy baseline required for all subsequent "
        "compliance steps. No hardware installation is required — only existing "
        "utility bills."
    )

    for part in text_parts:
        elements.append(Paragraph(part, s["body"]))
        elements.append(spacer(3))

    return elements


def _section_signature(data: Dict, s: dict) -> list:
    elements = section_title("Professional Sign-Off")

    partner     = data.get("partner_name", "")
    role        = data.get("partner_role", "Dottore Commercialista")
    report_date = data.get("report_date", "")
    org_name    = data.get("org_name", "")

    if partner:
        elements.append(Paragraph(
            f"This Compliance Readiness Assessment has been prepared by <b>{partner}</b> "
            f"using energy and configuration data analysed by Carbon Efficiency Intelligence "
            f"for <b>{org_name}</b>. Findings are based on available data at the time of "
            f"assessment and should be reviewed annually or when operational conditions change.",
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
            "This assessment has been generated by Carbon Efficiency Intelligence "
            "and is provided for informational purposes only."
        ))

    return elements


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_compliance_readiness_pdf(
    data: Dict[str, Any],
    lang: str = "it",
    partner_name: Optional[str] = None,
) -> BytesIO:
    """
    Generate a Compliance Readiness Assessment PDF.

    Parameters
    ----------
    data         : dict matching the schema in the module docstring
    lang         : "it" | "en"
    partner_name : commercialista studio name (triggers co-branding)

    Returns
    -------
    BytesIO containing the PDF
    """
    s = get_styles()

    pname = partner_name or data.get("partner_name")
    if pname and "partner_name" not in data:
        data = {**data, "partner_name": pname}

    org_name = data.get("org_name", "Organisation")
    year     = data.get("reporting_year", 2025)
    subtitle = f"{org_name}  ·  Compliance Readiness Assessment  ·  {year}"

    # Evaluate all five dimensions
    items = [
        _eval_cbam(data),
        _eval_ets(data),
        _eval_iso50001(data),
        _eval_data_quality(data),
        _eval_documentation(data),
    ]

    buf = BytesIO()
    doc = CEIDocTemplate(
        buf,
        doc_title="Compliance Readiness",
        doc_subtitle=subtitle,
        lang=lang,
        partner_name=pname,
    )

    story = []

    # ── Cover information ────────────────────────────────────────────────
    story.append(kv_table([
        ("Organisation",   org_name),
        ("Sector",         data.get("sector_code", "—").title()),
        ("Reporting year", str(year)),
        ("Country",        data.get("country_code", "—")),
        ("Report date",    data.get("report_date") or "—"),
        ("Prepared by",    pname or "Carbon Efficiency Intelligence"),
        ("Assessment scope", "CBAM · ETS Phase 4 · ISO 50001 · Data Quality · Documentation"),
    ]))
    story.append(spacer(6))

    # ── Overall score ────────────────────────────────────────────────────
    story += _section_overall_score(items, s)
    story.append(spacer(5))

    # ── Dimension detail cards ───────────────────────────────────────────
    for item in items:
        story += _section_dimension(item, s)
        story.append(spacer(4))

    # ── Priority matrix ──────────────────────────────────────────────────
    story += _section_priority_matrix(items, s)
    story.append(spacer(4))

    # ── Next steps ───────────────────────────────────────────────────────
    story += _section_next_steps(data, items, s)
    story.append(spacer(6))

    # ── Sign-off ─────────────────────────────────────────────────────────
    story += _section_signature(data, s)

    doc.build(story)
    buf.seek(0)
    return buf
