"""
ETS Position Statement Builder
================================
Generates a regulatory-grade ETS Phase 4 Position Statement showing an
organisation's compliance position for a given reporting year.

Covers all sites within an organisation, aggregated to org level.

Usage::

    from app.services.pdf.ets_statement import generate_ets_pdf
    pdf_buf = generate_ets_pdf(data, lang="it")
    return StreamingResponse(pdf_buf, media_type="application/pdf")

Input dict keys
---------------
Organisation:
    org_name            str   — organisation display name
    org_id              int
    country_code        str
    framework           str   — "EU_ETS"
    sector_code         str

Period:
    reporting_year      int

Sites summary (list of per-site dicts):
    sites: [
        {
            "site_name":   str,
            "total_kwh":   float,
            "total_tco2":  float,
            "free_alloc":  float | None,
        },
        ...
    ]

Totals (pre-computed across all sites):
    total_kwh               float
    total_tco2              float
    free_allocation_tonnes  float
    surplus_deficit         float   — positive = surplus
    ets_carbon_price        float   — €/tCO₂, default 65.0
    financial_impact_eur    float   — surplus value or deficit cost

Benchmark:
    benchmark_value         float   — tCO₂/tonne sector benchmark
    production_volume       float   — total tonnes produced
    production_unit         str
    actual_intensity        float   — tCO₂/tonne actual
    benchmark_gap_pct       float   — % above/below benchmark

Monthly data (for chart — full year, all sites):
    monthly_labels          list[str]
    monthly_tco2            list[float]

ETS Phase 4 schedule (pre-computed):
    ets_schedule: [{"year": int, "quota": float}, ...]

Signatory:
    consultant_name     str
    consultant_org      str
    consultant_role     str
    report_date         str
"""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List

from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

from .base import (
    C_ACCENT, C_GREEN, C_GREEN_D, C_AMBER, C_RED,
    C_SURFACE, C_TEXT_LT, C_TEXT_DK, C_MUTED_DK,
    C_BORDER, C_ROW_ALT, C_HIGHLIGHT, C_BOX_BG,
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
)
from .charts import bar_chart, line_chart, dual_bar_chart
from .i18n import t, get_lang

ETS_CARBON_PRICE_DEFAULT = 65.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt(value: float, decimals: int = 2, suffix: str = "") -> str:
    fmt = f"{value:,.{decimals}f}"
    return f"{fmt} {suffix}".strip() if suffix else fmt


def _sector_display(code: str, lang: str) -> str:
    mapping_en = {
        "ceramics":    "Ceramics / Ceramic Products",
        "cement":      "Cement & Clinker",
        "steel":       "Iron, Steel & Ferro-alloys",
        "aluminium":   "Aluminium",
        "fertilizers": "Fertilizers",
        "hydrogen":    "Hydrogen",
        "glass":       "Glass",
        "chemicals":   "Chemicals",
    }
    mapping_it = {
        "ceramics":    "Ceramica / Prodotti Ceramici",
        "cement":      "Cemento e Clinker",
        "steel":       "Ferro, Acciaio e Ferro-leghe",
        "aluminium":   "Alluminio",
        "fertilizers": "Fertilizzanti",
        "hydrogen":    "Idrogeno",
        "glass":       "Vetro",
        "chemicals":   "Chimica",
    }
    mapping = mapping_it if lang == "it" else mapping_en
    return mapping.get(code.lower(), code.title())


def _framework_display(code: str, lang: str) -> str:
    mapping_en = {
        "EU_ETS": "EU ETS Phase 4  (Directive 2003/87/EC)",
        "CBAM":   "EU CBAM  (Regulation (EU) 2023/956)",
    }
    mapping_it = {
        "EU_ETS": "EU ETS Fase 4  (Direttiva 2003/87/CE)",
        "CBAM":   "EU CBAM  (Regolamento (UE) 2023/956)",
    }
    mapping = mapping_it if lang == "it" else mapping_en
    return mapping.get(code.upper(), code)


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _s1_org(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"1 · {t('s_installation', lang)}")
    rows = [
        (t("installation_name", lang), data.get("org_name", "—")),
        (t("country",           lang), data.get("country_code", "—")),
        (t("sector",            lang), _sector_display(data.get("sector_code", "—"), lang)),
        (t("framework",         lang), _framework_display(data.get("framework", "EU_ETS"), lang)),
        (t("reporting_year",    lang), str(data.get("reporting_year", "—"))),
    ]
    story.append(kv_table(rows))


def _s2_ets_summary(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"2 · {t('s_ets_summary', lang)}")

    free_alloc = data.get("free_allocation_tonnes", 0)
    total_tco2 = data.get("total_tco2", 0)
    surplus    = data.get("surplus_deficit", 0)
    price      = data.get("ets_carbon_price", ETS_CARBON_PRICE_DEFAULT)
    fin_impact = data.get("financial_impact_eur", abs(surplus) * price)

    rows = [
        (t("free_allocation",  lang), f"{_fmt(free_alloc)} {t('tco2_unit', lang)}"),
        (t("actual_emissions", lang), f"{_fmt(total_tco2)} {t('tco2_unit', lang)}"),
        (t("surplus_deficit",  lang), f"{'+' if surplus >= 0 else ''}{_fmt(surplus)} {t('tco2_unit', lang)}"),
        (t("ets_carbon_price", lang), f"€{_fmt(price, 0)} / {t('tco2_unit', lang)}"),
        (t("financial_impact", lang), f"€{_fmt(fin_impact, 0)}"),
    ]
    story.append(kv_table(rows))
    story.append(spacer(3))

    # Result box — surplus or deficit
    is_surplus = surplus >= 0
    label = t("surplus" if is_surplus else "deficit", lang).upper()
    color_hint = "(+)" if is_surplus else "(!)"
    story.append(result_box(
        label=f"ETS {label} {color_hint}",
        value=f"{'+' if surplus >= 0 else ''}{_fmt(abs(surplus))}",
        unit=t("tco2_unit", lang),
        sub=(
            f"{t('credit_value', lang)}: €{_fmt(fin_impact, 0)}"
            if is_surplus else
            f"{t('purchase_cost', lang)}: €{_fmt(fin_impact, 0)}"
        ),
    ))


def _s3_sites(story: List, data: Dict, s: Dict, lang: str) -> None:
    sites = data.get("sites", [])
    if not sites:
        return

    story += section_title(f"3 · {t('s_trajectory', lang)} — Sites")

    headers = [
        t("installation_name", lang),
        t("monthly_kwh",       lang),
        t("monthly_tco2",      lang),
        t("free_allocation",   lang),
    ]
    rows = []
    for site in sites:
        alloc = site.get("free_alloc")
        rows.append([
            site.get("site_name", "—"),
            _fmt(site.get("total_kwh",  0)),
            _fmt(site.get("total_tco2", 0)),
            _fmt(alloc) if alloc is not None else "—",
        ])

    col_w = [CONTENT_W * 0.32, CONTENT_W * 0.23, CONTENT_W * 0.23, CONTENT_W * 0.22]
    story.append(data_table(
        headers=headers,
        rows=rows,
        col_widths=col_w,
        right_align_from=1,
    ))


def _s4_monthly_trajectory(story: List, data: Dict, s: Dict, lang: str) -> None:
    labels = data.get("monthly_labels", [])
    m_tco2 = data.get("monthly_tco2",  [])
    if not labels:
        return

    story += section_title(f"4 · {t('s_trajectory', lang)}")

    chart = bar_chart(
        labels=labels,
        values=m_tco2,
        title=t("chart_monthly_tco2", lang),
        y_label=t("tco2_unit", lang),
        color="#38bdf8",
        width_pt=340,
        height_pt=150,
        label_fontsize=6,
        rotate_labels=True,
    )
    story.append(chart)
    story.append(spacer(3))

    # Monthly table
    free_alloc_total = data.get("free_allocation_tonnes", 0)
    n_months = len(labels)
    monthly_alloc = free_alloc_total / 12 if free_alloc_total else None

    rows = []
    for lbl, tco2_v in zip(labels, m_tco2):
        alloc_str = _fmt(monthly_alloc) if monthly_alloc else "—"
        gap       = (tco2_v - monthly_alloc) if monthly_alloc else None
        gap_str   = f"{'+' if gap and gap >= 0 else ''}{_fmt(gap)}" if gap is not None else "—"
        rows.append([lbl, _fmt(tco2_v), alloc_str, gap_str])

    rows.append([
        t("total", lang),
        _fmt(sum(m_tco2)),
        _fmt(free_alloc_total) if free_alloc_total else "—",
        f"{'+' if data.get('surplus_deficit', 0) >= 0 else ''}{_fmt(data.get('surplus_deficit', 0))}",
    ])

    col_w = [CONTENT_W * 0.25, CONTENT_W * 0.25, CONTENT_W * 0.25, CONTENT_W * 0.25]
    story.append(data_table(
        headers=[
            t("month",           lang),
            t("monthly_tco2",    lang),
            t("free_allocation", lang),
            t("surplus_deficit", lang),
        ],
        rows=rows,
        col_widths=col_w,
        highlight_last=True,
        right_align_from=1,
    ))


def _s5_benchmark(story: List, data: Dict, s: Dict, lang: str) -> None:
    bmark      = data.get("benchmark_value")
    actual_int = data.get("actual_intensity")
    gap_pct    = data.get("benchmark_gap_pct")
    prod_vol   = data.get("production_volume", 0)
    prod_unit  = data.get("production_unit", "tonne")

    if bmark is None or actual_int is None:
        return

    story += section_title(f"5 · {t('s_benchmark', lang)}")

    rows = [
        (t("benchmark_value",   lang), f"{_fmt(bmark, 4)} {t('tco2_per_tonne', lang)}"),
        (t("actual_intensity",  lang), f"{_fmt(actual_int, 4)} {t('tco2_per_tonne', lang)}"),
        (t("production_volume", lang), f"{_fmt(prod_vol)} {prod_unit}"),
        (t("gap_vs_benchmark",  lang), f"{'+' if gap_pct and gap_pct >= 0 else ''}{_fmt(gap_pct or 0, 1)}%"),
    ]
    story.append(kv_table(rows))

    if gap_pct is not None:
        color  = C_GREEN if gap_pct < 0 else C_RED
        status = (
            f"{'Sotto' if lang == 'it' else 'Below'} benchmark ({abs(gap_pct):.1f}% {'migliore' if lang == 'it' else 'better'})"
            if gap_pct < 0 else
            f"{'Sopra' if lang == 'it' else 'Above'} benchmark ({abs(gap_pct):.1f}% {'peggiore' if lang == 'it' else 'worse'})"
        )
        story.append(spacer(3))
        story.append(info_box(f"{t('benchmark_position', lang)}: {status}", color=color))


def _s6_ets_schedule(story: List, data: Dict, s: Dict, lang: str) -> None:
    schedule = data.get("ets_schedule", [])
    if not schedule:
        return

    story += section_title(f"6 · {t('s_ets_schedule', lang)}")

    rows = [
        [str(row["year"]), _fmt(row["quota"])]
        for row in schedule
    ]
    col_w = [CONTENT_W * 0.3, CONTENT_W * 0.7]
    story.append(data_table(
        headers=[t("year", lang), t("projected_quota", lang)],
        rows=rows,
        col_widths=col_w,
        right_align_from=1,
    ))
    story.append(spacer(3))
    story.append(info_box(t("ets_schedule_note", lang), color=C_ACCENT))


def _s7_recommendation(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"7 · {t('s_recommendation', lang)}")
    is_surplus = data.get("surplus_deficit", 0) >= 0
    key = "recommendation_surplus" if is_surplus else "recommendation_deficit"
    story.append(compliance_box(t(key, lang)))


def _s8_methodology(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"8 · {t('s_methodology', lang)}")
    story.append(compliance_box(t("ets_methodology", lang)))


def _s9_signatory(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"9 · {t('s_declaration', lang)}")
    story.append(compliance_box(t("ets_declaration", lang)))
    story.append(spacer(5))
    story.append(signature_block(
        name="",
        organisation="",
        date_str="",
        role=data.get("consultant_role", "Certified Energy Manager"),
    ))


# ---------------------------------------------------------------------------
# ETS Phase 4 schedule calculator
# ---------------------------------------------------------------------------

def _build_ets_schedule(
    free_allocation: float,
    base_year: int = 2021,
    reporting_year: int = 2026,
    reduction_rate: float = 0.044,
) -> List[Dict]:
    """
    Project ETS Phase 4 quota for years reporting_year → 2030
    using the linear reduction factor of 4.4%/year from 2021 base.
    """
    schedule = []
    for yr in range(reporting_year, 2031):
        years_from_base = yr - base_year
        quota = free_allocation * ((1 - reduction_rate) ** years_from_base)
        schedule.append({"year": yr, "quota": round(quota, 2)})
    return schedule


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_ets_pdf(data: Dict[str, Any], lang: str = "en") -> BytesIO:
    """
    Build a complete ETS Position Statement PDF.

    Args:
        data: Dict as documented in the module docstring.
        lang: "en" or "it"

    Returns:
        BytesIO positioned at offset 0, ready for streaming.
    """
    lang     = get_lang(lang)
    org_name = data.get("org_name", "Organisation")
    year     = data.get("reporting_year", "")

    buf = BytesIO()
    doc = CEIDocTemplate(
        buf,
        doc_title=t("ets_title", lang),
        doc_subtitle=f"{org_name}  ·  {year}",
        lang=lang,
    )

    s     = get_styles()
    story: List = []

    # Cover block
    story.append(Paragraph(t("ets_title",    lang), s["doc_title"]))
    story.append(Paragraph(t("ets_subtitle", lang), s["doc_subtitle"]))
    story.append(Spacer(1, 3))

    # Sections
    _s1_org(story,              data, s, lang)
    _s2_ets_summary(story,      data, s, lang)
    _s3_sites(story,            data, s, lang)
    _s4_monthly_trajectory(story, data, s, lang)
    _s5_benchmark(story,        data, s, lang)
    _s6_ets_schedule(story,     data, s, lang)
    _s7_recommendation(story,   data, s, lang)
    _s8_methodology(story,      data, s, lang)
    _s9_signatory(story,        data, s, lang)

    doc.build(story)
    buf.seek(0)
    return buf