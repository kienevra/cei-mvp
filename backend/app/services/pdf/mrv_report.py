"""
MRV Declaration Report Builder
================================
Generates a regulatory-grade Monitoring, Reporting and Verification (MRV)
declaration per EU CBAM Regulation (EU) 2023/956.
"""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List

from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

from .base import (
    C_ACCENT, C_GREEN, C_AMBER, C_RED, C_BORDER,
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
from .charts import bar_chart, pie_chart
from .i18n import t, get_lang


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt(value: float, decimals: int = 2, suffix: str = "") -> str:
    fmt = f"{value:,.{decimals}f}"
    return f"{fmt} {suffix}".strip() if suffix else fmt


def _period_str(data: Dict, lang: str) -> str:
    q = data.get("quarter")
    y = data.get("reporting_year", "")
    if q:
        return f"Q{q} {y}  ·  {data['period_start']} → {data['period_end']}"
    return f"{data['period_start']} → {data['period_end']}"


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
        "VCS":    "Verified Carbon Standard (Verra VCS)",
        "GS":     "Gold Standard",
        "CN_ETS": "China National ETS",
        "IN_PAT": "India PAT Scheme",
    }
    mapping_it = {
        "EU_ETS": "EU ETS Fase 4  (Direttiva 2003/87/CE)",
        "CBAM":   "EU CBAM  (Regolamento (UE) 2023/956)",
        "VCS":    "Verified Carbon Standard (Verra VCS)",
        "GS":     "Gold Standard",
        "CN_ETS": "China National ETS",
        "IN_PAT": "India PAT Scheme",
    }
    mapping = mapping_it if lang == "it" else mapping_en
    return mapping.get(code.upper(), code)


# ---------------------------------------------------------------------------
# Section builders — all accept lang as the final argument
# ---------------------------------------------------------------------------

def _s1_installation(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"1 · {t('s_installation', lang)}")
    rows = [
        (t("installation_name", lang), data.get("site_name", "—")),
        (t("address",           lang), data.get("site_address") or "—"),
        (t("country",           lang), data.get("country_code", "—")),
        (t("sector",            lang), _sector_display(data.get("sector_code", "—"), lang)),
        (t("framework",         lang), _framework_display(data.get("framework", "—"), lang)),
        (t("installation_id",   lang), str(data.get("installation_id", "—"))),
    ]
    story.append(kv_table(rows))


def _s2_period(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"2 · {t('s_period', lang)}")
    rows = [
        (t("reporting_year", lang), str(data.get("reporting_year", "—"))),
        (t("quarter",        lang), f"Q{data['quarter']}" if data.get("quarter") else t("full_year", lang)),
        (t("period_start",   lang), data.get("period_start", "—")),
        (t("period_end",     lang), data.get("period_end",   "—")),
    ]
    story.append(kv_table(rows))


def _s3_production(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"3 · {t('s_production', lang)}")
    vol  = data.get("production_volume", 0)
    unit = data.get("production_unit", "tonnes")
    rows = [
        (t("production_volume", lang), f"{_fmt(vol)} {unit}"),
        (t("production_unit",   lang), unit),
        (t("data_source",       lang), t("site_production_records", lang)),
    ]
    story.append(kv_table(rows))


def _s4_energy(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"4 · {t('s_energy', lang)}")

    total = data.get("total_kwh", 0)
    elec  = data.get("electricity_kwh", 0)
    gas   = data.get("gas_kwh", 0)
    other = max(0.0, total - elec - gas)

    rows = [
        [t("electricity",   lang), _fmt(elec),  f"{elec  / total * 100:.1f}%" if total else "—"],
        [t("natural_gas",   lang), _fmt(gas),   f"{gas   / total * 100:.1f}%" if total else "—"],
    ]
    if other > 0:
        rows.append([t("other_sources", lang), _fmt(other), f"{other / total * 100:.1f}%"])
    rows.append([t("total", lang), _fmt(total), "100%"])

    col_w = [CONTENT_W * 0.40, CONTENT_W * 0.35, CONTENT_W * 0.25]
    story.append(data_table(
        headers=[t("energy_source", lang), t("consumption_kwh", lang), t("share", lang)],
        rows=rows,
        col_widths=col_w,
        highlight_last=True,
        right_align_from=1,
    ))
    story.append(spacer(3))

    sources, vals = [], []
    if elec  > 0: sources.append(t("electricity",   lang)); vals.append(elec)
    if gas   > 0: sources.append(t("natural_gas",   lang)); vals.append(gas)
    if other > 0: sources.append(t("other_sources", lang)); vals.append(other)

    if len(sources) > 1:
        chart = pie_chart(sources, vals, t("chart_energy_sources", lang), width_pt=200, height_pt=185)
        tbl = Table([[chart]], colWidths=[CONTENT_W])
        tbl.setStyle(TableStyle([
            ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(tbl)


def _s5_emission_factor(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"5 · {t('s_emission_factor', lang)}")
    ef_val  = data.get("emission_factor_value", 0)
    ef_src  = data.get("emission_factor_source", "—")
    ef_year = data.get("emission_factor_year",   "—")
    rows = [
        (t("emission_factor",  lang), f"{ef_val:.4f} {t('ef_unit', lang)}"),
        (t("source_citation",  lang), ef_src),
        (t("reference_year",   lang), str(ef_year)),
        (t("scope",            lang), t("scope_value", lang)),
    ]
    story.append(kv_table(rows))


def _s6_calculation(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"6 · {t('s_calculation', lang)}")

    total   = data.get("total_kwh",            0)
    ef_val  = data.get("emission_factor_value", 0)
    tco2    = data.get("total_tco2",            0)
    tonne   = data.get("production_volume",     1)
    unit    = data.get("production_unit",       "tonne")
    i_per_t = data.get("tco2_per_tonne",        0)
    tier    = data.get("methodology_tier", "Tier 2 — Calculation-based")

    story.append(data_table(
        headers=[t("step", lang), t("formula", lang), t("value", lang)],
        rows=[
            [f"1 — {t('energy_consumed', lang)}", t("metered",          lang), _fmt(total) + " kWh"],
            [f"2 — {t('ef_label',        lang)}", t("ef_unit",          lang), f"{ef_val:.4f}"],
            [f"3 — {t('total_emissions', lang)}", t("calc_formula",     lang), _fmt(tco2) + f" {t('tco2_unit', lang)}"],
            [f"4 — {t('prod_volume',     lang)}", f"{unit}",             _fmt(tonne) + f" {unit}"],
            [f"5 — {t('embedded_intensity', lang)}", t("intensity_formula", lang), _fmt(i_per_t, 4) + f" {t('tco2_per_tonne', lang)}"],
            [f"6 — {t('energy_intensity_label', lang)}", t("energy_intensity_formula", lang), _fmt(total / tonne if tonne > 0 else 0, 2) + f" kWh / {unit}"],
        ],
        col_widths=[CONTENT_W * 0.28, CONTENT_W * 0.40, CONTENT_W * 0.32],
        right_align_from=2,
    ))
    story.append(spacer(4))

    story.append(result_box(
        label=t("total_embedded", lang),
        value=_fmt(tco2),
        unit=t("tco2_unit", lang),
        sub=f"{t('embedded_sub', lang)}: {_fmt(i_per_t, 4)} {t('tco2_per_tonne', lang)}  ·  {t('methodology_tier', lang)}: {tier}",
    ))

    alloc   = data.get("free_allocation_tonnes")
    surplus = data.get("ets_surplus_deficit")
    if alloc is not None and surplus is not None:
        story.append(spacer(3))
        sign   = "+" if surplus >= 0 else ""
        colour = C_GREEN if surplus >= 0 else C_RED
        status = (
            "SURPLUS — eligible for credit sale"
            if surplus >= 0 else
            "DEFICIT — allowances must be purchased"
        )
        story.append(info_box(
            f"ETS Phase 4:  {t('free_allocation', lang)} {_fmt(alloc)} {t('tco2_unit', lang)}  ·  "
            f"{t('actual_emissions', lang)} {_fmt(tco2)} {t('tco2_unit', lang)}  ·  "
            f"{sign}{_fmt(surplus)} {t('tco2_unit', lang)} ({status})",
            color=colour,
        ))


def _s7_monthly_trend(story: List, data: Dict, s: Dict, lang: str) -> None:
    labels = data.get("monthly_labels", [])
    m_kwh  = data.get("monthly_kwh",    [])
    m_tco2 = data.get("monthly_tco2",   [])
    if not labels:
        return

    story += section_title(f"7 · {t('s_monthly_trend', lang)}")

    if m_kwh and m_tco2:
        chart = bar_chart(
            labels=labels,
            values=m_tco2,
            title=t("chart_monthly_emissions", lang),
            y_label=t("tco2_unit", lang),
            color="#38bdf8",
            width_pt=450,
            height_pt=195,
        )
        story.append(chart)
        story.append(spacer(3))

    rows = [
        [lbl, _fmt(kwh), _fmt(tco2_v)]
        for lbl, kwh, tco2_v in zip(labels, m_kwh, m_tco2)
    ]
    rows.append([t("total", lang), _fmt(sum(m_kwh)), _fmt(sum(m_tco2))])

    story.append(data_table(
        headers=[t("month", lang), t("monthly_kwh", lang), t("monthly_tco2", lang)],
        rows=rows,
        col_widths=[CONTENT_W * 0.30, CONTENT_W * 0.35, CONTENT_W * 0.35],
        highlight_last=True,
        right_align_from=1,
    ))


def _s8_methodology(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"8 · {t('s_methodology', lang)}")
    tier = data.get("methodology_tier", "Tier 2 — Calculation-based")
    ef   = data.get("emission_factor_source", "—")
    story.append(compliance_box(
        f"{t('methodology_tier', lang)}: {tier}\n\n{t('mrv_methodology', lang)}"
    ))


def _s9_data_quality(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"9 · {t('s_data_quality', lang)}")
    rows = [
        (t("energy_metering",     lang), t("metering_value",    lang)),
        (t("data_completeness",   lang), t("completeness_value", lang)),
        (t("production_records",  lang), t("prod_records_value", lang)),
        (t("emission_factor",     lang), data.get("emission_factor_source", "—")),
        (t("verification_status", lang), t("verif_value",        lang)),
        (t("monitoring_plan",     lang), t("monitoring_value",   lang)),
    ]
    story.append(kv_table(rows))


def _s10_signatory(story: List, data: Dict, s: Dict, lang: str) -> None:
    story += section_title(f"10 · {t('s_declaration', lang)}")
    story.append(compliance_box(t("mrv_declaration_text", lang)))
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

def generate_mrv_pdf(data: Dict[str, Any], lang: str = "en") -> BytesIO:
    """
    Build a complete MRV Declaration PDF from a pre-computed data dict.

    Args:
        data: Dict containing all input keys (see module docstring).
        lang: "en" or "it"

    Returns:
        BytesIO positioned at offset 0, ready for streaming.
    """
    lang       = get_lang(lang)
    site_name  = data.get("site_name", "Installation")
    period_str = _period_str(data, lang)

    buf = BytesIO()
    doc = CEIDocTemplate(
        buf,
        doc_title=t("mrv_title", lang),
        doc_subtitle=f"{site_name}  ·  {period_str}",
        lang=lang,
    )

    s     = get_styles()
    story: List = []

    # Cover block
    story.append(Paragraph(t("mrv_title",    lang), s["doc_title"]))
    story.append(Paragraph(t("mrv_subtitle", lang), s["doc_subtitle"]))
    story.append(Spacer(1, 3))

    # Sections
    _s1_installation(story,    data, s, lang)
    _s2_period(story,          data, s, lang)
    _s3_production(story,      data, s, lang)
    _s4_energy(story,          data, s, lang)
    _s5_emission_factor(story, data, s, lang)
    _s6_calculation(story,     data, s, lang)
    _s7_monthly_trend(story,   data, s, lang)
    _s8_methodology(story,     data, s, lang)
    _s9_data_quality(story,    data, s, lang)
    _s10_signatory(story,      data, s, lang)

    doc.build(story)
    buf.seek(0)
    return buf