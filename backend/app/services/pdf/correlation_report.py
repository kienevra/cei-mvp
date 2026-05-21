"""
Correlation Assessment Report Builder
=======================================
Generates a statistical energy analysis report for a single site,
covering night/weekend idle consumption, spike frequency, peak demand
timing, and month-on-month trend.

Usage::

    from app.services.pdf.correlation_report import generate_correlation_pdf
    pdf_buf = generate_correlation_pdf(data, lang="it")

Input dict keys
---------------
Installation:
    site_name           str
    site_address        str | None
    country_code        str
    sector_code         str
    installation_id     int

Period:
    period_start        str   — "YYYY-MM-DD"
    period_end          str   — "YYYY-MM-DD"
    total_hours         int   — hours of data analysed

Idle analysis:
    night_kwh           float  — kWh between 22:00–06:00
    night_pct           float  — % of total
    weekend_kwh         float  — kWh on Sat/Sun
    weekend_pct         float  — % of total
    total_kwh           float
    electricity_price   float  — €/kWh for cost estimates
    idle_cost_eur       float  — estimated wasted cost

Spike analysis:
    critical_hours      int    — hours >2σ above baseline
    elevated_hours      int    — hours >1σ above baseline
    spike_rate_pct      float  — critical_hours / total_hours * 100

Peak demand:
    peak_hour           int    — 0–23
    peak_avg_kwh        float
    peak_day            str    — e.g. "Mon 2026-03-14"
    peak_day_kwh        float

Monthly trend:
    monthly_labels      list[str]
    monthly_kwh         list[float]
    trend_slope         float   — kWh/month
    trend_r2            float
    trend_direction     str     — "improving" | "stable" | "worsening"

Production correlation (optional):
    prod_correlation_available  bool
    prod_trend_direction        str | None
    prod_r2                     float | None
    prod_anomaly_days           int | None

Signatory:
    consultant_role     str
    report_date         str
"""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

from .base import (
    C_ACCENT, C_GREEN, C_GREEN_D, C_AMBER, C_RED,
    C_SURFACE, C_TEXT_LT, C_TEXT_DK, C_MUTED_DK,
    C_BORDER, C_ROW_ALT, C_HIGHLIGHT,
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
    _FONT_SEMIBOLD,
)
from .charts import bar_chart, line_chart
from .i18n import t, get_lang


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt(value: float, decimals: int = 2, suffix: str = "") -> str:
    fmt = f"{value:,.{decimals}f}"
    return f"{fmt} {suffix}".strip() if suffix else fmt


def _status_color(status: str) -> HexColor:
    return {
        "good":    C_GREEN,
        "warning": C_AMBER,
        "alert":   C_RED,
        "na":      C_ACCENT,
    }.get(status, C_ACCENT)


def _status_label(status: str, lang: str) -> str:
    return t(f"status_{status}", lang)


def _sector_display(code: str, lang: str) -> str:
    en = {"ceramics": "Ceramics", "cement": "Cement", "steel": "Steel",
          "aluminium": "Aluminium", "glass": "Glass", "chemicals": "Chemicals"}
    it = {"ceramics": "Ceramica", "cement": "Cemento", "steel": "Acciaio",
          "aluminium": "Alluminio", "glass": "Vetro", "chemicals": "Chimica"}
    return (it if lang == "it" else en).get(code.lower(), code.title())


def _trend_interp(direction: str, lang: str) -> str:
    key = {
        "improving": "trend_interp_improving",
        "worsening": "trend_interp_worsening",
        "stable":    "trend_interp_stable",
    }.get(direction, "trend_interp_stable")
    return t(key, lang)


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
        (t("analysis_window",   lang), f"{data.get('period_start','—')} → {data.get('period_end','—')}"),
        (t("total_hours_analysed", lang), f"{data.get('total_hours', 0):,} h"),
    ]
    story.append(kv_table(rows))


def _s2_key_findings(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"2 · {t('s_key_findings', lang)}")

    night_pct   = data.get("night_pct",      0)
    weekend_pct = data.get("weekend_pct",    0)
    spike_rate  = data.get("spike_rate_pct", 0)
    trend_dir   = data.get("trend_direction", "stable")

    idle_status  = "alert" if night_pct > 25 else ("warning" if night_pct > 15 else "good")
    spike_status = "alert" if spike_rate > 10 else ("warning" if spike_rate > 5 else "good")
    trend_status = "alert" if trend_dir == "worsening" else ("good" if trend_dir == "improving" else "warning")

    rows = [
        [t("night_ratio",      lang), f"{_fmt(night_pct, 1)}%",  _status_label(idle_status,  lang)],
        [t("weekend_ratio",    lang), f"{_fmt(weekend_pct, 1)}%", _status_label(idle_status,  lang)],
        [t("spike_rate",       lang), f"{_fmt(spike_rate, 1)}%",  _status_label(spike_status, lang)],
        [t("trend_direction",  lang), t(f"{'improving' if trend_dir == 'improving' else 'worsening' if trend_dir == 'worsening' else 'stable'}", lang),
         _status_label(trend_status, lang)],
    ]

    col_w = [CONTENT_W * 0.45, CONTENT_W * 0.30, CONTENT_W * 0.25]
    t_obj = Table(
        [[Paragraph(f"<b>{t('finding', lang)}</b>", s["small"]),
          Paragraph(f"<b>{t('result',  lang)}</b>", s["small"]),
          Paragraph(f"<b>{t('status',  lang)}</b>", s["small"])]] +
        [[Paragraph(r[0], s["body"]),
          Paragraph(r[1], s["body"]),
          Paragraph(r[2], s["body_bold"])] for r in rows],
        colWidths=col_w,
    )

    # Build row colors based on status
    status_colors = [idle_status, idle_status, spike_status, trend_status]
    style_cmds = [
        ("BACKGROUND",    (0, 0), (-1, 0),  C_SURFACE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  C_TEXT_LT),
        ("FONTNAME",      (0, 0), (-1, 0),  _FONT_SEMIBOLD),
        ("FONTSIZE",      (0, 0), (-1, 0),  8),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [C_ROW_ALT, HexColor("#ffffff")]),
        ("BOX",           (0, 0), (-1, -1), 0.4, C_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, C_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("ALIGN",         (1, 0), (-1, -1), "RIGHT"),
    ]
    for i, st in enumerate(status_colors):
        color = _status_color(st)
        style_cmds.append(("TEXTCOLOR", (2, i + 1), (2, i + 1), color))
    t_obj.setStyle(TableStyle(style_cmds))
    story.append(t_obj)


def _s3_idle(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"3 · {t('s_idle_analysis', lang)}")

    night_kwh   = data.get("night_kwh",    0)
    night_pct   = data.get("night_pct",    0)
    weekend_kwh = data.get("weekend_kwh",  0)
    weekend_pct = data.get("weekend_pct",  0)
    total_kwh   = data.get("total_kwh",    0)
    price       = data.get("electricity_price", 0.15)
    idle_cost   = data.get("idle_cost_eur", (night_kwh + weekend_kwh) * price)

    rows = [
        (t("night_hours",   lang), f"{night_kwh:,.1f} kWh  ({_fmt(night_pct, 1)}%)"),
        (t("weekend_hours", lang), f"{weekend_kwh:,.1f} kWh  ({_fmt(weekend_pct, 1)}%)"),
        (t("idle_kwh",      lang), f"{(night_kwh + weekend_kwh):,.1f} kWh"),
        (t("idle_cost",     lang), f"€{idle_cost:,.0f}"),
        (t("electricity_price", lang), f"€{price:.4f} / kWh"),
    ]
    story.append(kv_table(rows))
    story.append(spacer(3))

    idle_pct = (night_kwh + weekend_kwh) / total_kwh * 100 if total_kwh > 0 else 0
    is_high  = idle_pct > 20
    story.append(info_box(
        t("idle_interp_high" if is_high else "idle_interp_low", lang),
        color=C_RED if is_high else C_GREEN,
    ))


def _s4_spikes(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"4 · {t('s_spike_analysis', lang)}")

    critical = data.get("critical_hours", 0)
    elevated = data.get("elevated_hours", 0)
    total_h  = data.get("total_hours",    1)
    spike_rt = data.get("spike_rate_pct", critical / total_h * 100 if total_h > 0 else 0)

    rows = [
        (t("critical_hours", lang), f"{critical:,} h  ({_fmt(critical / total_h * 100, 1)}% of total)"),
        (t("elevated_hours", lang), f"{elevated:,} h  ({_fmt(elevated / total_h * 100, 1)}% of total)"),
        (t("spike_rate",     lang), f"{_fmt(spike_rt, 1)}%"),
        (t("total_hours_analysed", lang), f"{total_h:,} h"),
    ]
    story.append(kv_table(rows))
    story.append(spacer(3))

    is_high = spike_rt > 10
    story.append(info_box(
        t("spike_interp_high" if is_high else "spike_interp_low", lang),
        color=C_RED if is_high else C_GREEN,
    ))


def _s5_peak(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"5 · {t('s_peak_demand', lang)}")

    peak_h   = data.get("peak_hour",    0)
    peak_kwh = data.get("peak_avg_kwh", 0)
    peak_day = data.get("peak_day",     "—")
    peak_d_k = data.get("peak_day_kwh", 0)

    am_pm = "AM" if peak_h < 12 else "PM"
    hour_12 = peak_h % 12 or 12

    rows = [
        (t("peak_hour",     lang), f"{hour_12}:00 {am_pm}  ({peak_h:02d}:00–{(peak_h+1)%24:02d}:00)"),
        (t("peak_avg_kwh",  lang), f"{_fmt(peak_kwh)} kWh"),
        (t("peak_day",      lang), peak_day),
        (t("monthly_kwh",   lang), f"{_fmt(peak_d_k)} kWh"),
    ]
    story.append(kv_table(rows))


def _s6_trend(story: List, data: Dict, s: Dict, lang: str) -> None:
    labels  = data.get("monthly_labels", [])
    m_kwh   = data.get("monthly_kwh",    [])
    slope   = data.get("trend_slope",    0)
    r2      = data.get("trend_r2",       0)
    dir_    = data.get("trend_direction","stable")

    story += section_title(f"6 · {t('s_monthly_trend', lang)}")

    if labels and m_kwh:
        chart = line_chart(
            labels=labels,
            values=m_kwh,
            title=t("chart_monthly_emissions", lang).replace("tCO₂", "kWh"),
            y_label="kWh",
            color="#38bdf8",
            width_pt=520,
            height_pt=240,
        )
        story.append(chart)
        story.append(spacer(3))

    p_value   = data.get("trend_p_value", 1.0)
    sig_label = ("statistically significant (p < 0.05)" if p_value < 0.05
                 else "not statistically significant") if lang == "en" else (
                 "statisticamente significativo (p < 0,05)" if p_value < 0.05
                 else "non statisticamente significativo")
    rows = [
        (t("trend_slope_label", lang), f"{slope:+.1f} kWh/month"),
        (t("trend_r2",          lang), f"{r2:.4f}  ({sig_label})"),
        (t("trend_direction",   lang), t(dir_, lang)),
        (t("months_analysed",   lang), str(len(labels))),
    ]
    story.append(kv_table(rows))
    story.append(spacer(3))
    color = C_GREEN if dir_ == "improving" else (C_RED if dir_ == "worsening" else C_AMBER)
    story.append(info_box(_trend_interp(dir_, lang), color=color))


def _s7_production(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"7 · {t('s_prod_correlation', lang)}")

    available = data.get("prod_correlation_available", False)
    if not available:
        story.append(info_box(t("no_prod_data", lang), color=C_AMBER))
        return

    rows = [
        (t("trend_direction",  lang), t(data.get("prod_trend_direction", "stable"), lang)),
        (t("trend_r2",         lang), f"{data.get('prod_r2', 0):.4f}"),
        (t("spike_count",      lang), str(data.get("prod_anomaly_days", 0))),
    ]
    story.append(kv_table(rows))


def _s8_methodology(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"8 · {t('s_methodology', lang)}")
    story.append(compliance_box(t("corr_methodology", lang)))


def _s9_signatory(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"9 · {t('s_declaration', lang)}")
    story.append(compliance_box(t("corr_declaration", lang)))
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

def generate_correlation_pdf(data: Dict[str, Any], lang: str = "en") -> BytesIO:
    """
    Build a complete Correlation Assessment PDF.

    Args:
        data: Dict as documented in the module docstring.
        lang: "en" or "it"

    Returns:
        BytesIO positioned at offset 0, ready for streaming.
    """
    lang      = get_lang(lang)
    site_name = data.get("site_name", "Installation")
    period    = f"{data.get('period_start','—')} → {data.get('period_end','—')}"

    buf = BytesIO()
    doc = CEIDocTemplate(
        buf,
        doc_title=t("correlation_title",    lang),
        doc_subtitle=f"{site_name}  ·  {period}",
        lang=lang,
    )

    s     = get_styles()
    story: List = []

    story.append(Paragraph(t("correlation_title",    lang), s["doc_title"]))
    story.append(Paragraph(t("correlation_subtitle", lang), s["doc_subtitle"]))
    story.append(Spacer(1, 3))

    _s1_installation(story, data, s, lang)
    _s2_key_findings(story, data, s, lang)
    _s3_idle(story,         data, s, lang)
    _s4_spikes(story,       data, s, lang)
    _s5_peak(story,         data, s, lang)
    _s6_trend(story,        data, s, lang)
    _s7_production(story,   data, s, lang)
    _s8_methodology(story,  data, s, lang)
    _s9_signatory(story,    data, s, lang)

    doc.build(story)
    buf.seek(0)
    return buf