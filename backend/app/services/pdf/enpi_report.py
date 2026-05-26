"""
EnPI Baseline Report Builder
==============================
Generates an ISO 50001:2018 Energy Performance Indicator (EnPI) Baseline
Report comparing a baseline period against a current period for a single site.

Usage::

    from app.services.pdf.enpi_report import generate_enpi_pdf
    pdf_buf = generate_enpi_pdf(data, lang="it")
    return StreamingResponse(pdf_buf, media_type="application/pdf")

Input dict keys
---------------
Installation:
    site_name           str
    site_address        str | None
    country_code        str
    sector_code         str
    installation_id     int

Periods:
    baseline_start      str   — "YYYY-MM-DD"
    baseline_end        str   — "YYYY-MM-DD"
    current_start       str   — "YYYY-MM-DD"
    current_end         str   — "YYYY-MM-DD"

Production:
    production_volume   float  — annual volume (scaled per period internally)
    production_unit     str

Baseline metrics:
    baseline_kwh        float
    baseline_tco2       float
    baseline_enpi       float  — kWh / production unit
    baseline_months     list[str]
    baseline_monthly_kwh list[float]

Current metrics:
    current_kwh         float
    current_tco2        float
    current_enpi        float
    current_months      list[str]
    current_monthly_kwh list[float]

Derived:
    enpi_change_pct     float  — negative = improvement
    r_squared           float  — 0–1
    trend_slope         float  — kWh/month (negative = improving)
    ef_value            float
    ef_source           str

Signatory:
    consultant_role     str
    report_date         str
"""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List

import numpy as np
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

from .base import (
    C_ACCENT, C_GREEN, C_GREEN_D, C_AMBER, C_RED,
    C_SURFACE, C_TEXT_LT, C_BORDER, C_ROW_ALT,
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
from .charts import bar_chart, dual_bar_chart, line_chart
from .i18n import t, get_lang, fmt_date


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt(value: float, decimals: int = 2, suffix: str = "") -> str:
    fmt = f"{value:,.{decimals}f}"
    return f"{fmt} {suffix}".strip() if suffix else fmt


def _sector_display(code: str, lang: str) -> str:
    en = {
        "ceramics": "Ceramics", "cement": "Cement", "steel": "Steel",
        "aluminium": "Aluminium", "glass": "Glass", "chemicals": "Chemicals",
    }
    it = {
        "ceramics": "Ceramica", "cement": "Cemento", "steel": "Acciaio",
        "aluminium": "Alluminio", "glass": "Vetro", "chemicals": "Chimica",
    }
    if not code:
        return "—"
    return (it if lang == "it" else en).get(code.lower(), code.title())


def compute_r_squared(monthly_kwh: List[float]) -> tuple[float, float, float]:
    """
    Fits a linear trend to monthly kWh values using SciPy linregress.
    Returns (r_squared, slope_kwh_per_month, p_value).
    slope < 0 means consumption is falling (improving).
    p_value < 0.05 means the trend is statistically significant.
    """
    if len(monthly_kwh) < 3:
        return 0.0, 0.0, 1.0
    from scipy.stats import linregress
    x = np.arange(len(monthly_kwh), dtype=float)
    y = np.array(monthly_kwh, dtype=float)
    result  = linregress(x, y)
    r2      = result.rvalue ** 2
    slope   = float(result.slope)
    p_value = float(result.pvalue)
    return round(max(0.0, min(1.0, r2)), 4), round(slope, 2), round(p_value, 4)


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _s1_installation(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"1 · {t('s_installation', lang)}")
    rows = [
        (t("installation_name", lang), data.get("site_name", "—")),
        (t("address",           lang), data.get("site_address") or "—"),
        (t("country",           lang), data.get("country_code", "—")),
        (t("sector",            lang), _sector_display(data.get("sector_code", "—"), lang)),
        (t("installation_id",   lang), str(data.get("installation_id", "—"))),
    ]
    story.append(kv_table(rows))


def _s2_config(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"2 · {t('s_analysis_config', lang)}")
    vol  = data.get("production_volume", 0)
    unit = data.get("production_unit", "tonne")
    rows = [
        (t("baseline_start",    lang), fmt_date(data.get("baseline_start", "—"), lang)),
        (t("baseline_end",      lang), fmt_date(data.get("baseline_end",   "—"), lang)),
        (t("current_start",     lang), fmt_date(data.get("current_start",  "—"), lang)),
        (t("current_end",       lang), fmt_date(data.get("current_end",    "—"), lang)),
        (t("production_volume", lang), f"{_fmt(vol)} {unit} / {t('reporting_year', lang).lower()}"),
        (t("production_unit",   lang), unit),
        (t("emission_factor",   lang), f"{data.get('ef_value', 0):.4f} {t('ef_unit', lang)}  ({data.get('ef_source', '—')})"),
    ]
    story.append(kv_table(rows))


def _s3_baseline(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"3 · {t('s_baseline_summary', lang)}")
    rows = [
        (t("baseline_kwh",   lang), _fmt(data.get("baseline_kwh",  0)) + " kWh"),
        (t("baseline_tco2",  lang), _fmt(data.get("baseline_tco2", 0)) + f" {t('tco2_unit', lang)}"),
        (t("baseline_enpi",  lang), _fmt(data.get("baseline_enpi", 0), 3) + f" {t('kwh_per_unit', lang)}"),
        (t("data_source",    lang), t("metering_value", lang)),
    ]
    story.append(kv_table(rows))


def _s4_current(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"4 · {t('s_current_summary', lang)}")
    rows = [
        (t("current_kwh",    lang), _fmt(data.get("current_kwh",  0)) + " kWh"),
        (t("current_tco2",   lang), _fmt(data.get("current_tco2", 0)) + f" {t('tco2_unit', lang)}"),
        (t("current_enpi",   lang), _fmt(data.get("current_enpi", 0), 3) + f" {t('kwh_per_unit', lang)}"),
        (t("data_source",    lang), t("metering_value", lang)),
    ]
    story.append(kv_table(rows))


def _s5_comparison(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"5 · {t('s_enpi_comparison', lang)}")

    b_enpi   = data.get("baseline_enpi", 0)
    c_enpi   = data.get("current_enpi",  0)
    chg_pct  = data.get("enpi_change_pct", 0)
    unit     = data.get("production_unit", "tonne")
    is_improvement = chg_pct <= 0

    # Comparison table
    col_w = [CONTENT_W * 0.40, CONTENT_W * 0.30, CONTENT_W * 0.30]
    story.append(data_table(
        headers=["", t("baseline_period", lang), t("current_period", lang)],
        rows=[
            [
                t("enpi_result_label" if is_improvement else "enpi_regression_label", lang),
                f"{_fmt(b_enpi, 3)} {t('kwh_per_unit', lang)}",
                f"{_fmt(c_enpi, 3)} {t('kwh_per_unit', lang)}",
            ],
            [
                t("monthly_kwh", lang),
                _fmt(data.get("baseline_kwh", 0)) + " kWh",
                _fmt(data.get("current_kwh",  0)) + " kWh",
            ],
            [
                t("monthly_tco2", lang),
                _fmt(data.get("baseline_tco2", 0)) + f" {t('tco2_unit', lang)}",
                _fmt(data.get("current_tco2",  0)) + f" {t('tco2_unit', lang)}",
            ],
        ],
        col_widths=col_w,
        right_align_from=1,
    ))
    story.append(spacer(4))

    # Result box
    sign  = "" if chg_pct > 0 else ""
    label = t("enpi_improvement" if is_improvement else "enpi_regression", lang).upper()
    story.append(result_box(
        label=label,
        value=f"{'+' if chg_pct > 0 else ''}{_fmt(chg_pct, 1)}%",
        unit=t("enpi_change", lang),
        sub=(
            f"{t('baseline_enpi', lang)}: {_fmt(b_enpi, 3)}  →  "
            f"{t('current_enpi', lang)}: {_fmt(c_enpi, 3)} {t('kwh_per_unit', lang)}"
        ),
    ))

    story.append(spacer(3))
    colour = C_GREEN if is_improvement else C_RED
    story.append(info_box(
        f"{t('enpi_change', lang)}: {'+' if chg_pct > 0 else ''}{_fmt(chg_pct, 1)}%  ·  "
        f"{t('baseline_enpi', lang)}: {_fmt(b_enpi, 3)} → {t('current_enpi', lang)}: {_fmt(c_enpi, 3)} "
        f"{t('kwh_per_unit', lang)}",
        color=colour,
    ))


def _s6_chart(story: List, data: Dict, s: Dict, lang: str) -> None:
    b_months = data.get("baseline_months",     [])
    b_kwh    = data.get("baseline_monthly_kwh", [])
    c_months = data.get("current_months",      [])
    c_kwh    = data.get("current_monthly_kwh",  [])

    story += section_title(f"6 · {t('s_monthly_trend', lang)}")

    # Dual bar chart if both periods have same number of months
    if b_months and c_months and len(b_months) == len(c_months):
        chart = dual_bar_chart(
            labels=c_months,
            values_a=b_kwh,
            values_b=c_kwh,
            label_a=t("baseline_period", lang),
            label_b=t("current_period",  lang),
            title=t("chart_enpi_compare", lang),
            color_a="#94a3b8",
            color_b="#38bdf8",
            width_pt=580,
            height_pt=250,
            label_fontsize=6,
            rotate_labels=True,
            legend_outside=False,
        )
        story.append(chart)
        story.append(spacer(3))
    elif c_months and c_kwh:
        # Single period bar chart
        chart = bar_chart(
            labels=c_months,
            values=c_kwh,
            title=t("chart_enpi_compare", lang),
            y_label="kWh",
            color="#38bdf8",
            width_pt=450,
            height_pt=190,
            label_fontsize=7,
            rotate_labels=True,
        )
        story.append(chart)
        story.append(spacer(3))

    # Monthly data table — current period
    if c_months and c_kwh:
        rows = [[lbl, _fmt(kwh)] for lbl, kwh in zip(c_months, c_kwh)]
        rows.append([t("total", lang), _fmt(sum(c_kwh))])
        story.append(data_table(
            headers=[t("month", lang), t("current_kwh", lang)],
            rows=rows,
            col_widths=[CONTENT_W * 0.45, CONTENT_W * 0.55],
            highlight_last=True,
            right_align_from=1,
        ))


def _s7_trend(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"7 · {t('s_trend_analysis', lang)}")

    r2    = data.get("r_squared",   0.0)
    slope = data.get("trend_slope", 0.0)

    if slope < -50:
        direction = t("improving", lang)
        d_color   = C_GREEN
    elif slope > 50:
        direction = t("worsening", lang)
        d_color   = C_RED
    else:
        direction = t("stable", lang)
        d_color   = C_AMBER

    rows = [
        (t("r_squared",       lang), f"{r2:.4f}  ({'strong' if r2 > 0.7 else 'moderate' if r2 > 0.4 else 'weak'} fit)"),
        (t("trend_slope",     lang), f"{slope:+.1f} kWh/month"),
        (t("trend_direction", lang), direction),
    ]
    story.append(kv_table(rows))
    story.append(spacer(3))
    story.append(info_box(t("r_squared_note", lang), color=C_ACCENT))


def _s8_methodology(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"8 · {t('s_iso_compliance', lang)}")
    story.append(compliance_box(t("iso_compliance_text", lang)))


def _s9_signatory(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"9 · {t('s_declaration', lang)}")
    story.append(compliance_box(t("iso_declaration_text", lang)))
    story.append(spacer(5))
    story.append(signature_block(
        name="",
        organisation="",
        date_str="",
        role=data.get("consultant_role", "Certified Energy Manager"),
    ))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_enpi_pdf(data: Dict[str, Any], lang: str = "en") -> BytesIO:
    """
    Build a complete EnPI Baseline Report PDF.

    Args:
        data: Dict as documented in the module docstring.
        lang: "en" or "it"

    Returns:
        BytesIO positioned at offset 0, ready for streaming.
    """
    lang      = get_lang(lang)
    site_name = data.get("site_name", "Installation")
    subtitle  = f"{fmt_date(data.get('baseline_start',''), lang)} → {fmt_date(data.get('current_end',''), lang)}"

    buf = BytesIO()
    doc = CEIDocTemplate(
        buf,
        doc_title=t("enpi_title", lang),
        doc_subtitle=f"{site_name}  ·  {subtitle}",
        lang=lang,
    )

    s     = get_styles()
    story: List = []

    # Cover block
    story.append(Paragraph(t("enpi_title",    lang), s["doc_title"]))
    story.append(Paragraph(t("enpi_subtitle", lang), s["doc_subtitle"]))
    story.append(Spacer(1, 3))

    # Sections
    _s1_installation(story, data, s, lang)
    _s2_config(story,       data, s, lang)
    _s3_baseline(story,     data, s, lang)
    _s4_current(story,      data, s, lang)
    _s5_comparison(story,   data, s, lang)
    _s6_chart(story,        data, s, lang)
    _s7_trend(story,        data, s, lang)
    _s8_methodology(story,  data, s, lang)
    _s9_signatory(story,    data, s, lang)

    doc.build(story)
    buf.seek(0)
    return buf