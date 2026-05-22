"""
CEI PDF Internationalisation
=============================
Translation strings for all CEI compliance PDF documents.
Supports English (en) and Italian (it).

Usage::

    from app.services.pdf.i18n import t, SUPPORTED_LANGS

    title = t("mrv_title", lang="it")
    # → "Dichiarazione MRV"

Adding a new language:
    1. Add a new key to TRANSLATIONS (e.g. "de")
    2. Copy the "en" block and translate all values
    3. Add the key to SUPPORTED_LANGS

Adding a new string:
    1. Add the key + English value to TRANSLATIONS["en"]
    2. Add the Italian translation to TRANSLATIONS["it"]
    3. Use t("your_key", lang) in the PDF builder
"""
from __future__ import annotations

SUPPORTED_LANGS = ("en", "it")
DEFAULT_LANG    = "en"

TRANSLATIONS: dict[str, dict[str, str]] = {

    # ── English ───────────────────────────────────────────────────────────
    "en": {
        # ── Document titles ──────────────────────────────────────────────
        "mrv_title":            "MRV Declaration",
        "mrv_subtitle":         "Monitoring, Reporting and Verification — EU CBAM Regulation (EU) 2023/956",
        "ets_title":            "ETS Position Statement",
        "ets_subtitle":         "EU Emissions Trading System Phase 4 — Directive 2003/87/EC",
        "enpi_title":           "EnPI Baseline Report",
        "enpi_subtitle":        "Energy Performance Indicator Report — ISO 50001:2018",
        "correlation_title":    "Correlation Assessment",
        "correlation_subtitle": "Statistical Energy Analysis Report",
        "benchmark_title":      "Benchmarking Report",
        "benchmark_subtitle":   "Sector Peer Comparison — Anonymised",

        # ── Common section headers ────────────────────────────────────────
        "s_installation":       "Installation Identification",
        "s_period":             "Reporting Period",
        "s_production":         "Production Data",
        "s_energy":             "Energy Consumed",
        "s_emission_factor":    "Emission Factor",
        "s_calculation":        "Embedded Emissions Calculation",
        "s_monthly_trend":      "Monthly Energy & Emissions Trend",
        "s_methodology":        "Methodology & Data Quality",
        "s_data_quality":       "Data Quality Statement",
        "s_declaration":        "Declaration & Signatory",
        "s_ets_summary":        "ETS Allocation Summary",
        "s_financial_impact":   "Financial Impact",
        "s_benchmark":          "Benchmark Comparison",
        "s_trajectory":         "Annual Emissions Trajectory",
        "s_ets_schedule":       "ETS Phase 4 Reduction Schedule",
        "s_recommendation":     "Recommendation",

        # ── Common field labels ───────────────────────────────────────────
        "installation_name":    "Installation Name",
        "address":              "Address / Location",
        "country":              "Country",
        "sector":               "Sector / Activity",
        "framework":            "Regulatory Framework",
        "installation_id":      "CEI Installation ID",
        "reporting_year":       "Reporting Year",
        "quarter":              "Quarter",
        "period_start":         "Period Start",
        "period_end":           "Period End",
        "full_year":            "Full year",
        "production_volume":    "Production Volume",
        "production_unit":      "Production Unit",
        "data_source":          "Data Source",
        "site_production_records": "Site production records / metering",
        "energy_source":        "Energy Source",
        "consumption_kwh":      "Consumption (kWh)",
        "share":                "Share",
        "total":                "TOTAL",
        "electricity":          "Electricity",
        "natural_gas":          "Natural Gas",
        "other_sources":        "Other Sources",
        "emission_factor":      "Emission Factor",
        "ef_unit":              "kg CO₂ / kWh",
        "source_citation":      "Source / Citation",
        "reference_year":       "Reference Year",
        "scope":                "Scope",
        "scope_value":          "Scope 2 — Market-based (location-adjusted)",
        "step":                 "Step",
        "formula":              "Formula",
        "value":                "Value",
        "energy_consumed":      "Energy consumed",
        "metered":              "kWh (metered)",
        "ef_label":             "Emission factor",
        "total_emissions":      "Total emissions",
        "calc_formula":         "kWh × EF ÷ 1,000",
        "prod_volume":          "Production volume",
        "embedded_intensity":   "Embedded intensity",
        "intensity_formula":    "tCO₂ ÷ production vol.",
        "methodology_tier":     "Tier",
        "total_embedded":       "TOTAL EMBEDDED EMISSIONS",
        "embedded_sub":         "Embedded intensity",
        "month":                "Month",
        "monthly_kwh":          "Energy Consumed (kWh)",
        "monthly_tco2":         "Embedded Emissions (tCO₂)",
        "energy_metering":      "Energy metering",
        "metering_value":       "Continuous sub-hourly smart meter data",
        "data_completeness":    "Data completeness",
        "completeness_value":   "≥ 99% uptime for the reporting period",
        "production_records":   "Production records",
        "prod_records_value":   "Operator-declared tonnage; not independently verified",
        "verification_status":  "Verification status",
        "verif_value":          "Prepared for third-party verification — not yet verified",
        "monitoring_plan":      "Monitoring plan",
        "monitoring_value":     "Available on request from the installation operator",
        "signatory":            "SIGNATORY / VERIFIER",
        "organisation":         "ORGANISATION",
        "date":                 "DATE",
        "generated_by":         "Generated by CEI Platform",

        # ── MRV-specific ──────────────────────────────────────────────────
        "mrv_declaration_text": (
            "I, the undersigned, declare that the information contained in this MRV Declaration is "
            "accurate and complete to the best of my knowledge, and that the embedded emissions have "
            "been calculated in accordance with the methodology stated herein and the requirements of "
            "Regulation (EU) 2023/956 (CBAM) and Regulation (EU) 2018/2066 (MRV)."
        ),
        "mrv_methodology": (
            "Energy consumption data is sourced from continuous sub-meter monitoring aggregated at "
            "hourly intervals and stored in the CEI platform timeseries database. No interpolation or "
            "gap-filling has been applied to periods exceeding 4 hours.\n\n"
            "The emission factor represents a national grid average for location-based Scope 2 "
            "accounting. Market-based adjustments (e.g. guarantees of origin) may be applied by the "
            "verifier where supporting documentation is available.\n\n"
            "This report has been produced in accordance with:\n"
            "  •  EU MRV Regulation (EU) 2018/2066 (as amended)\n"
            "  •  EU CBAM Regulation (EU) 2023/956, Annex III\n"
            "  •  ISO 14064-1:2018 — Quantification of GHG emissions\n"
            "  •  ISO 50001:2018 — Energy Management Systems"
        ),
        "footer_disclaimer": (
            "This document is generated from monitored operational data. "
            "It must be reviewed by a certified verifier before submission to any regulatory authority."
        ),

        # ── ETS-specific ──────────────────────────────────────────────────
        "free_allocation":      "Free Allocation Received",
        "actual_emissions":     "Actual Verified Emissions",
        "surplus_deficit":      "Surplus / Deficit",
        "surplus":              "Surplus",
        "deficit":              "Deficit",
        "ets_carbon_price":     "ETS Carbon Price (est.)",
        "credit_value":         "Estimated Credit Value",
        "purchase_cost":        "Estimated Purchase Cost",
        "financial_impact":     "Estimated Financial Impact",
        "benchmark_value":      "Sector Benchmark",
        "actual_intensity":     "Actual Emissions Intensity",
        "gap_vs_benchmark":     "Gap vs Benchmark",
        "benchmark_position":   "Benchmark Position",
        "year":                 "Year",
        "projected_quota":      "Projected Quota (tCO₂)",
        "reduction_rate":       "Annual Reduction Rate",
        "ets_schedule_note":    "EU ETS Phase 4 linear reduction factor: 4.4% per year to 2030.",
        "ets_declaration": (
            "I, the undersigned, declare that the ETS position data contained in this statement "
            "is accurate and complete to the best of my knowledge, calculated in accordance with "
            "EU ETS Phase 4 Directive 2003/87/EC and Commission Implementing Regulation (EU) 2018/2066."
        ),
        "ets_methodology": (
            "Actual verified emissions are calculated from metered energy consumption multiplied "
            "by the applicable national grid emission factor. Free allocations are as notified by "
            "the competent authority for the current ETS Phase 4 allocation period.\n\n"
            "Carbon price used for financial impact calculation: €65 / tCO₂ (market estimate, 2026).\n\n"
            "This statement has been produced in accordance with:\n"
            "  •  EU ETS Directive 2003/87/EC (Phase 4, 2021–2030)\n"
            "  •  Commission Implementing Regulation (EU) 2018/2066 — MRV\n"
            "  •  Commission Delegated Regulation (EU) 2019/331 — Free Allocation"
        ),
        "chart_monthly_tco2":   "Monthly Verified Emissions (tCO₂)",
        "chart_ets_trajectory": "ETS Trajectory vs Free Allocation",
        "chart_energy_sources": "Energy Source Breakdown",
        "chart_monthly_emissions": "Monthly Embedded Emissions (tCO₂)",
        "tco2_unit":            "tCO₂",
        "tco2_per_tonne":       "tCO₂ / tonne",
        "eur_per_tco2":         "€ / tCO₂",
        "recommendation_surplus": (
            "Based on the current ETS position, this installation holds a surplus of allowances. "
            "Options to consider: (1) retain surplus as a buffer against future production increases; "
            "(2) sell surplus allowances on the EU ETS market; (3) bank allowances for future phases. "
            "CEI recommends consulting a certified ETS trader before transacting."
        ),
        "recommendation_deficit": (
            "Based on the current ETS position, this installation faces an allowance deficit. "
            "Options to consider: (1) purchase allowances on the EU ETS market before the April "
            "surrender deadline; (2) invest in energy efficiency measures to reduce future emissions; "
            "(3) apply for additional free allocation if production volumes have increased significantly. "
            "CEI recommends immediate consultation with a certified ETS compliance advisor."
        ),
    },

    # ── Italian ───────────────────────────────────────────────────────────
    "it": {
        # ── Titoli dei documenti ─────────────────────────────────────────
        "mrv_title":            "Dichiarazione MRV",
        "mrv_subtitle":         "Monitoraggio, Rendicontazione e Verifica — Regolamento UE CBAM (UE) 2023/956",
        "ets_title":            "Dichiarazione di Posizione ETS",
        "ets_subtitle":         "Sistema EU di Scambio di Quote di Emissione Fase 4 — Direttiva 2003/87/CE",
        "enpi_title":           "Rapporto di Baseline EnPI",
        "enpi_subtitle":        "Rapporto sull'Indicatore di Prestazione Energetica — ISO 50001:2018",
        "correlation_title":    "Valutazione delle Correlazioni",
        "correlation_subtitle": "Rapporto di Analisi Statistica Energetica",
        "benchmark_title":      "Rapporto di Benchmarking",
        "benchmark_subtitle":   "Confronto con i Pari del Settore — Anonimizzato",

        # ── Intestazioni delle sezioni comuni ────────────────────────────
        "s_installation":       "Identificazione dell'Impianto",
        "s_period":             "Periodo di Riferimento",
        "s_production":         "Dati di Produzione",
        "s_energy":             "Energia Consumata",
        "s_emission_factor":    "Fattore di Emissione",
        "s_calculation":        "Calcolo delle Emissioni Incorporate",
        "s_monthly_trend":      "Andamento Mensile di Energia ed Emissioni",
        "s_methodology":        "Metodologia e Qualità dei Dati",
        "s_data_quality":       "Dichiarazione sulla Qualità dei Dati",
        "s_declaration":        "Dichiarazione e Firmatario",
        "s_ets_summary":        "Riepilogo delle Quote ETS",
        "s_financial_impact":   "Impatto Finanziario",
        "s_benchmark":          "Confronto con il Benchmark",
        "s_trajectory":         "Traiettoria Annuale delle Emissioni",
        "s_ets_schedule":       "Piano di Riduzione ETS Fase 4",
        "s_recommendation":     "Raccomandazione",

        # ── Etichette dei campi comuni ────────────────────────────────────
        "installation_name":    "Nome dell'Impianto",
        "address":              "Indirizzo / Ubicazione",
        "country":              "Paese",
        "sector":               "Settore / Attività",
        "framework":            "Quadro Normativo",
        "installation_id":      "ID Impianto CEI",
        "reporting_year":       "Anno di Riferimento",
        "quarter":              "Trimestre",
        "period_start":         "Inizio Periodo",
        "period_end":           "Fine Periodo",
        "full_year":            "Anno intero",
        "production_volume":    "Volume di Produzione",
        "production_unit":      "Unità di Produzione",
        "data_source":          "Fonte dei Dati",
        "site_production_records": "Registri di produzione / contatori del sito",
        "energy_source":        "Fonte Energetica",
        "consumption_kwh":      "Consumo (kWh)",
        "share":                "Quota",
        "total":                "TOTALE",
        "electricity":          "Energia Elettrica",
        "natural_gas":          "Gas Naturale",
        "other_sources":        "Altre Fonti",
        "emission_factor":      "Fattore di Emissione",
        "ef_unit":              "kg CO₂ / kWh",
        "source_citation":      "Fonte / Riferimento",
        "reference_year":       "Anno di Riferimento",
        "scope":                "Scope",
        "scope_value":          "Scope 2 — Market-based (adeguato alla localizzazione)",
        "step":                 "Fase",
        "formula":              "Formula",
        "value":                "Valore",
        "energy_consumed":      "Energia consumata",
        "metered":              "kWh (contatore)",
        "ef_label":             "Fattore di emissione",
        "total_emissions":      "Emissioni totali",
        "calc_formula":         "kWh × FE ÷ 1.000",
        "prod_volume":          "Volume di produzione",
        "embedded_intensity":   "Intensità incorporata",
        "intensity_formula":    "tCO₂ ÷ vol. produzione",
        "methodology_tier":     "Livello",
        "total_embedded":       "EMISSIONI INCORPORATE TOTALI",
        "embedded_sub":         "Intensità incorporata",
        "month":                "Mese",
        "monthly_kwh":          "Energia Consumata (kWh)",
        "monthly_tco2":         "Emissioni Incorporate (tCO₂)",
        "energy_metering":      "Misurazione energetica",
        "metering_value":       "Dati continui da contatore intelligente sub-orario",
        "data_completeness":    "Completezza dei dati",
        "completeness_value":   "≥ 99% di uptime nel periodo di riferimento",
        "production_records":   "Registri di produzione",
        "prod_records_value":   "Tonnellaggio dichiarato dall'operatore; non verificato indipendentemente",
        "verification_status":  "Stato della verifica",
        "verif_value":          "Predisposto per la verifica di terza parte — non ancora verificato",
        "monitoring_plan":      "Piano di monitoraggio",
        "monitoring_value":     "Disponibile su richiesta presso l'operatore dell'impianto",
        "signatory":            "FIRMATARIO / VERIFICATORE",
        "organisation":         "ORGANIZZAZIONE",
        "date":                 "DATA",
        "generated_by":         "Generato dalla Piattaforma CEI",

        # ── Specifico MRV ────────────────────────────────────────────────
        "mrv_declaration_text": (
            "Il/La sottoscritto/a dichiara che le informazioni contenute nella presente Dichiarazione MRV "
            "sono accurate e complete al meglio della propria conoscenza, e che le emissioni incorporate "
            "sono state calcolate conformemente alla metodologia indicata nel presente documento e ai "
            "requisiti del Regolamento (UE) 2023/956 (CBAM) e del Regolamento (UE) 2018/2066 (MRV)."
        ),
        "mrv_methodology": (
            "I dati di consumo energetico provengono dal monitoraggio continuo di sottometri aggregati "
            "a intervalli orari e conservati nel database delle serie temporali della piattaforma CEI. "
            "Non sono state applicate interpolazioni o colmature di lacune per periodi superiori a 4 ore.\n\n"
            "Il fattore di emissione rappresenta la media nazionale della rete elettrica per la "
            "contabilizzazione Scope 2 basata sulla localizzazione. Eventuali rettifiche market-based "
            "(es. garanzie di origine) possono essere applicate dal verificatore ove disponibile.\n\n"
            "Il presente rapporto è stato prodotto in conformità con:\n"
            "  •  Regolamento UE MRV (UE) 2018/2066 (come modificato)\n"
            "  •  Regolamento UE CBAM (UE) 2023/956, Allegato III\n"
            "  •  ISO 14064-1:2018 — Quantificazione delle emissioni di GHG\n"
            "  •  ISO 50001:2018 — Sistemi di Gestione dell'Energia"
        ),
        "footer_disclaimer": (
            "Questo documento è generato da dati operativi monitorati. "
            "Deve essere revisionato da un verificatore certificato prima della presentazione a qualsiasi autorità di regolamentazione."
        ),

        # ── Specifico ETS ────────────────────────────────────────────────
        "free_allocation":      "Quote Gratuite Ricevute",
        "actual_emissions":     "Emissioni Verificate Effettive",
        "surplus_deficit":      "Surplus / Deficit",
        "surplus":              "Surplus",
        "deficit":              "Deficit",
        "ets_carbon_price":     "Prezzo del Carbonio ETS (stima)",
        "credit_value":         "Valore Stimato dei Crediti",
        "purchase_cost":        "Costo Stimato di Acquisto",
        "financial_impact":     "Impatto Finanziario Stimato",
        "benchmark_value":      "Benchmark di Settore",
        "actual_intensity":     "Intensità di Emissione Effettiva",
        "gap_vs_benchmark":     "Scarto rispetto al Benchmark",
        "benchmark_position":   "Posizione rispetto al Benchmark",
        "year":                 "Anno",
        "projected_quota":      "Quota Prevista (tCO₂)",
        "reduction_rate":       "Tasso di Riduzione Annuale",
        "ets_schedule_note":    "Fattore di riduzione lineare EU ETS Fase 4: 4,4% annuo fino al 2030.",
        "ets_declaration": (
            "Il/La sottoscritto/a dichiara che i dati sulla posizione ETS contenuti nella presente "
            "dichiarazione sono accurati e completi al meglio della propria conoscenza, calcolati "
            "conformemente alla Direttiva ETS Fase 4 2003/87/CE e al Regolamento di Esecuzione "
            "della Commissione (UE) 2018/2066."
        ),
        "ets_methodology": (
            "Le emissioni verificate effettive sono calcolate dal consumo energetico misurato "
            "moltiplicato per il fattore di emissione della rete nazionale applicabile. Le quote "
            "gratuite sono quelle notificate dall'autorità competente per il periodo di allocazione "
            "della Fase 4 ETS in corso.\n\n"
            "Prezzo del carbonio utilizzato per il calcolo dell'impatto finanziario: €65 / tCO₂ "
            "(stima di mercato, 2026).\n\n"
            "La presente dichiarazione è stata prodotta in conformità con:\n"
            "  •  Direttiva ETS UE 2003/87/CE (Fase 4, 2021–2030)\n"
            "  •  Regolamento di Esecuzione della Commissione (UE) 2018/2066 — MRV\n"
            "  •  Regolamento Delegato della Commissione (UE) 2019/331 — Allocazione Gratuita"
        ),
        "chart_monthly_tco2":      "Emissioni Mensili Verificate (tCO₂)",
        "chart_ets_trajectory":    "Traiettoria ETS vs Quote Gratuite",
        "chart_energy_sources":    "Ripartizione per Fonte Energetica",
        "chart_monthly_emissions": "Emissioni Incorporate Mensili (tCO₂)",
        "tco2_unit":               "tCO₂",
        "tco2_per_tonne":          "tCO₂ / tonnellata",
        "eur_per_tco2":            "€ / tCO₂",
        "recommendation_surplus": (
            "In base alla posizione ETS attuale, questo impianto detiene un surplus di quote. "
            "Opzioni da considerare: (1) mantenere il surplus come riserva contro futuri aumenti "
            "di produzione; (2) vendere le quote in eccesso sul mercato EU ETS; "
            "(3) accantonare le quote per le fasi future. "
            "CEI raccomanda di consultare un trader ETS certificato prima di effettuare transazioni."
        ),
        "recommendation_deficit": (
            "In base alla posizione ETS attuale, questo impianto presenta un deficit di quote. "
            "Opzioni da considerare: (1) acquistare quote sul mercato EU ETS prima della scadenza "
            "di restituzione di aprile; (2) investire in misure di efficienza energetica per ridurre "
            "le emissioni future; (3) richiedere quote gratuite aggiuntive in caso di aumento "
            "significativo dei volumi di produzione. "
            "CEI raccomanda una consulenza immediata con un consulente certificato per la conformità ETS."
        ),
    },
}


def t(key: str, lang: str = DEFAULT_LANG) -> str:
    """
    Translate a key into the requested language.
    Falls back to English if the key is missing in the target language,
    then falls back to the key itself if missing in English too.

    Args:
        key:  Translation key, e.g. "mrv_title"
        lang: Language code, e.g. "en" or "it"

    Returns:
        Translated string.
    """
    lang = lang.lower() if lang.lower() in SUPPORTED_LANGS else DEFAULT_LANG
    return (
        TRANSLATIONS[lang].get(key)
        or TRANSLATIONS[DEFAULT_LANG].get(key)
        or key
    )


def get_lang(lang: str) -> str:
    """Normalise and validate a language code."""
    lang = (lang or DEFAULT_LANG).lower().strip()
    return lang if lang in SUPPORTED_LANGS else DEFAULT_LANG


# ---------------------------------------------------------------------------
# EnPI strings — appended to both EN and IT blocks
# ---------------------------------------------------------------------------

TRANSLATIONS["en"].update({
    # Section headers
    "s_analysis_config":    "Analysis Configuration",
    "s_baseline_summary":   "Baseline Period — Energy Summary",
    "s_current_summary":    "Current Period — Energy Summary",
    "s_enpi_comparison":    "EnPI Comparison",
    "s_trend_analysis":     "Trend Analysis & Correlation",
    "s_iso_compliance":     "ISO 50001 Compliance Statement",

    # Field labels
    "baseline_period":      "Baseline Period",
    "current_period":       "Current Period",
    "baseline_start":       "Baseline Start",
    "baseline_end":         "Baseline End",
    "current_start":        "Current Start",
    "current_end":          "Current End",
    "baseline_kwh":         "Baseline Energy (kWh)",
    "current_kwh":          "Current Energy (kWh)",
    "baseline_tco2":        "Baseline Emissions (tCO₂)",
    "current_tco2":         "Current Emissions (tCO₂)",
    "baseline_enpi":        "Baseline EnPI (kWh / unit)",
    "current_enpi":         "Current EnPI (kWh / unit)",
    "enpi_change":          "EnPI Change",
    "enpi_improvement":     "Energy Performance Improvement",
    "enpi_regression":      "Energy Performance Regression",
    "r_squared":            "R² Correlation (kWh vs time)",
    "r_squared_note":       "R² measures how well a linear trend fits the monthly kWh data. Values above 0.7 indicate a strong trend.",
    "trend_slope":          "Monthly Trend (kWh/month)",
    "trend_direction":      "Trend Direction",
    "improving":            "Improving ↓",
    "worsening":            "Worsening ↑",
    "stable":               "Stable →",
    "kwh_per_unit":         "kWh / unit",
    "enpi_result_label":    "EnPI IMPROVEMENT",
    "enpi_regression_label":"EnPI REGRESSION",
    "chart_enpi_compare":   "Monthly Energy Consumption — Baseline vs Current (kWh)",
    "chart_enpi_trend":     "Monthly EnPI Trend (kWh / unit)",

    # ISO compliance
    "iso_compliance_text": (
        "This Energy Performance Indicator (EnPI) report has been prepared in accordance with "
        "ISO 50001:2018 clause 6.4 — Energy Performance Indicators. The EnPI is defined as total "
        "energy consumption (kWh) divided by production output (units), measured over the specified "
        "reporting period.\n\n"
        "Baseline period data has been used as the reference against which current period "
        "performance is measured. A reduction in EnPI indicates an improvement in energy performance.\n\n"
        "This report has been produced in accordance with:\n"
        "  •  ISO 50001:2018 — Energy Management Systems, Clause 6.4\n"
        "  •  ISO 50006:2014 — Measuring Energy Performance using EnPIs and EnBs\n"
        "  •  EU Energy Efficiency Directive 2023/1791 (recast)"
    ),
    "iso_declaration_text": (
        "I, the undersigned, confirm that the energy performance data contained in this report "
        "is accurate and complete to the best of my knowledge, and has been calculated in accordance "
        "with ISO 50001:2018 clause 6.4 and the methodology stated herein."
    ),
})

TRANSLATIONS["it"].update({
    "s_analysis_config":    "Configurazione dell'Analisi",
    "s_baseline_summary":   "Periodo di Riferimento — Riepilogo Energetico",
    "s_current_summary":    "Periodo Corrente — Riepilogo Energetico",
    "s_enpi_comparison":    "Confronto EnPI",
    "s_trend_analysis":     "Analisi delle Tendenze e Correlazione",
    "s_iso_compliance":     "Dichiarazione di Conformità ISO 50001",

    "baseline_period":      "Periodo di Riferimento",
    "current_period":       "Periodo Corrente",
    "baseline_start":       "Inizio Periodo di Riferimento",
    "baseline_end":         "Fine Periodo di Riferimento",
    "current_start":        "Inizio Periodo Corrente",
    "current_end":          "Fine Periodo Corrente",
    "baseline_kwh":         "Energia di Riferimento (kWh)",
    "current_kwh":          "Energia Corrente (kWh)",
    "baseline_tco2":        "Emissioni di Riferimento (tCO₂)",
    "current_tco2":         "Emissioni Correnti (tCO₂)",
    "baseline_enpi":        "EnPI di Riferimento (kWh / unità)",
    "current_enpi":         "EnPI Corrente (kWh / unità)",
    "enpi_change":          "Variazione EnPI",
    "enpi_improvement":     "Miglioramento della Prestazione Energetica",
    "enpi_regression":      "Regressione della Prestazione Energetica",
    "r_squared":            "Correlazione R² (kWh vs tempo)",
    "r_squared_note":       "R² misura quanto bene una tendenza lineare si adatta ai dati kWh mensili. Valori superiori a 0,7 indicano una tendenza forte.",
    "trend_slope":          "Tendenza Mensile (kWh/mese)",
    "trend_direction":      "Direzione della Tendenza",
    "improving":            "In Miglioramento ↓",
    "worsening":            "In Peggioramento ↑",
    "stable":               "Stabile →",
    "kwh_per_unit":         "kWh / unità",
    "enpi_result_label":    "MIGLIORAMENTO EnPI",
    "enpi_regression_label":"REGRESSIONE EnPI",
    "chart_enpi_compare":   "Consumo Energetico Mensile — Riferimento vs Corrente (kWh)",
    "chart_enpi_trend":     "Tendenza EnPI Mensile (kWh / unità)",

    "iso_compliance_text": (
        "Il presente rapporto sugli Indicatori di Prestazione Energetica (EnPI) è stato preparato "
        "in conformità con la clausola 6.4 della norma ISO 50001:2018 — Sistemi di Gestione "
        "dell'Energia. L'EnPI è definito come il consumo energetico totale (kWh) diviso per la "
        "produzione (unità), misurato nel periodo di riferimento specificato.\n\n"
        "I dati del periodo di riferimento sono utilizzati come base rispetto alla quale viene "
        "misurata la prestazione del periodo corrente. Una riduzione dell'EnPI indica un miglioramento "
        "della prestazione energetica.\n\n"
        "Il presente rapporto è stato prodotto in conformità con:\n"
        "  •  ISO 50001:2018 — Sistemi di Gestione dell'Energia, Clausola 6.4\n"
        "  •  ISO 50006:2014 — Misurazione della Prestazione Energetica con EnPI ed EnB\n"
        "  •  Direttiva UE sull'Efficienza Energetica 2023/1791 (rifusione)"
    ),
    "iso_declaration_text": (
        "Il/La sottoscritto/a conferma che i dati sulla prestazione energetica contenuti nel presente "
        "rapporto sono accurati e completi al meglio della propria conoscenza, e sono stati calcolati "
        "in conformità con la clausola 6.4 della norma ISO 50001:2018 e la metodologia indicata."
    ),
})


# ---------------------------------------------------------------------------
# Correlation Assessment strings
# ---------------------------------------------------------------------------

TRANSLATIONS["en"].update({
    "s_key_findings":        "Key Findings Summary",
    "s_idle_analysis":       "Night & Weekend Idle Analysis",
    "s_spike_analysis":      "Spike Frequency Analysis",
    "s_peak_demand":         "Peak Demand Analysis",
    "s_monthly_trend":       "Month-on-Month Trend",
    "s_prod_correlation":    "Production Correlation",
    "s_recommendations":     "Recommendations",

    "correlation_title":     "Correlation Assessment",
    "correlation_subtitle":  "Statistical Energy Analysis Report",

    "finding":               "Finding",
    "metric":                "Metric",
    "result":                "Result",
    "status":                "Status",
    "interpretation":        "Interpretation",

    "night_ratio":           "Night-time Consumption Ratio",
    "weekend_ratio":         "Weekend Consumption Ratio",
    "idle_kwh":              "Estimated Idle kWh",
    "idle_cost":             "Estimated Idle Cost",
    "night_hours":           "Night Hours (22:00–06:00)",
    "weekend_hours":         "Weekend Hours (Sat–Sun)",
    "total_hours_analysed":  "Total Hours Analysed",

    "spike_count":           "Spike Events Detected",
    "critical_hours":        "Critical Hours (>2σ above baseline)",
    "elevated_hours":        "Elevated Hours (>1σ above baseline)",
    "spike_rate":            "Spike Rate",
    "avg_spike_magnitude":   "Avg Spike Magnitude",

    "peak_hour":             "Peak Demand Hour",
    "peak_avg_kwh":          "Peak Hour Avg Consumption",
    "peak_day":              "Highest Demand Day",
    "demand_profile":        "Demand Profile",

    "trend_slope_label":     "Monthly Trend",
    "trend_r2":              "Trend R² (goodness of fit)",
    "months_analysed":       "Months Analysed",

    "status_good":           "Good",
    "status_warning":        "Review",
    "status_alert":          "Alert",
    "status_na":             "N/A",

    "idle_interp_low":       "Night/weekend idle consumption is within normal range.",
    "idle_interp_high":      "Significant idle consumption detected — equipment may not be shut down outside production hours.",
    "spike_interp_low":      "Spike frequency is within acceptable limits.",
    "spike_interp_high":     "High spike frequency detected — investigate demand peaks and equipment start-up sequences.",
    "trend_interp_improving":"Consumption trend is falling — energy performance is improving.",
    "trend_interp_stable":   "Consumption trend is stable.",
    "trend_interp_worsening":"Consumption trend is rising — energy performance requires attention.",

    "no_prod_data":          "Production data not available. Upload production CSV to enable kWh/unit correlation.",
    "analysis_window":       "Analysis Window",
    "electricity_price":     "Electricity Price Used",

    "corr_methodology": (
        "Night-time ratio: kWh consumed between 22:00–06:00 as % of total. "
        "Weekend ratio: kWh consumed Saturday–Sunday as % of total. "
        "Spike detection: hours where consumption exceeds the hourly baseline by more than 2 standard deviations. "
        "Trend analysis: linear regression on monthly kWh totals (R² = goodness of fit). "
        "All analysis is based on sub-hourly metered data stored in the CEI platform."
    ),
    "corr_declaration": (
        "I, the undersigned, confirm that the correlation analysis contained in this report "
        "is based on metered operational data and has been produced using the statistical "
        "methodology described herein."
    ),
})

TRANSLATIONS["it"].update({
    "s_key_findings":        "Riepilogo dei Risultati Principali",
    "s_idle_analysis":       "Analisi del Consumo Inattivo Notturno e nel Weekend",
    "s_spike_analysis":      "Analisi della Frequenza dei Picchi",
    "s_peak_demand":         "Analisi della Domanda di Punta",
    "s_monthly_trend":       "Tendenza Mese per Mese",
    "s_prod_correlation":    "Correlazione con la Produzione",
    "s_recommendations":     "Raccomandazioni",

    "correlation_title":     "Valutazione delle Correlazioni",
    "correlation_subtitle":  "Rapporto di Analisi Statistica Energetica",

    "finding":               "Risultato",
    "metric":                "Metrica",
    "result":                "Risultato",
    "status":                "Stato",
    "interpretation":        "Interpretazione",

    "night_ratio":           "Quota Consumo Notturno",
    "weekend_ratio":         "Quota Consumo Weekend",
    "idle_kwh":              "kWh Inattivi Stimati",
    "idle_cost":             "Costo Inattivo Stimato",
    "night_hours":           "Ore Notturne (22:00–06:00)",
    "weekend_hours":         "Ore Weekend (Sab–Dom)",
    "total_hours_analysed":  "Ore Totali Analizzate",

    "spike_count":           "Picchi Rilevati",
    "critical_hours":        "Ore Critiche (>2σ sopra la baseline)",
    "elevated_hours":        "Ore Elevate (>1σ sopra la baseline)",
    "spike_rate":            "Frequenza dei Picchi",
    "avg_spike_magnitude":   "Magnitudine Media dei Picchi",

    "peak_hour":             "Ora di Punta",
    "peak_avg_kwh":          "Consumo Medio nell'Ora di Punta",
    "peak_day":              "Giorno di Massima Domanda",
    "demand_profile":        "Profilo della Domanda",

    "trend_slope_label":     "Tendenza Mensile",
    "trend_r2":              "R² della Tendenza (bontà di adattamento)",
    "months_analysed":       "Mesi Analizzati",

    "status_good":           "Buono",
    "status_warning":        "Da Verificare",
    "status_alert":          "Allerta",
    "status_na":             "N/D",

    "idle_interp_low":       "Il consumo inattivo notturno/weekend rientra nei limiti normali.",
    "idle_interp_high":      "Consumo inattivo significativo rilevato — le apparecchiature potrebbero non essere spente fuori dall'orario di produzione.",
    "spike_interp_low":      "La frequenza dei picchi rientra nei limiti accettabili.",
    "spike_interp_high":     "Alta frequenza di picchi rilevata — esaminare i picchi di domanda e le sequenze di avvio delle apparecchiature.",
    "trend_interp_improving":"La tendenza dei consumi è in calo — la prestazione energetica sta migliorando.",
    "trend_interp_stable":   "La tendenza dei consumi è stabile.",
    "trend_interp_worsening":"La tendenza dei consumi è in aumento — la prestazione energetica richiede attenzione.",

    "no_prod_data":          "Dati di produzione non disponibili. Carica il CSV di produzione per abilitare la correlazione kWh/unità.",
    "analysis_window":       "Finestra di Analisi",
    "electricity_price":     "Prezzo Elettricità Utilizzato",

    "corr_methodology": (
        "Quota notturna: kWh consumati tra le 22:00 e le 06:00 come % del totale. "
        "Quota weekend: kWh consumati sabato e domenica come % del totale. "
        "Rilevamento picchi: ore in cui il consumo supera la baseline oraria di più di 2 deviazioni standard. "
        "Analisi delle tendenze: regressione lineare sui totali mensili di kWh (R² = bontà di adattamento). "
        "Tutta l'analisi si basa su dati misurati sub-orari conservati nella piattaforma CEI."
    ),
    "corr_declaration": (
        "Il/La sottoscritto/a conferma che l'analisi delle correlazioni contenuta nel presente rapporto "
        "si basa su dati operativi misurati ed è stata prodotta utilizzando la metodologia statistica "
        "descritta nel presente documento."
    ),
})

# ---------------------------------------------------------------------------
# Energy intensity (MRV row 6)
# ---------------------------------------------------------------------------

TRANSLATIONS["en"].update({
    "energy_intensity_label":   "Energy intensity",
    "energy_intensity_formula": "kWh ÷ production vol.",
})

TRANSLATIONS["it"].update({
    "energy_intensity_label":   "Intensità energetica",
    "energy_intensity_formula": "kWh ÷ vol. produzione",
})

# ---------------------------------------------------------------------------
# Date formatting utility
# ---------------------------------------------------------------------------

def fmt_date(date_str: str, lang: str = "en") -> str:
    """
    Format an ISO date string (YYYY-MM-DD) into locale-appropriate display format.
    EN (US): MM/DD/YYYY  e.g. 02/21/2026
    IT (EU): DD/MM/YYYY  e.g. 21/02/2026
    Falls back to the original string if parsing fails.
    """
    if not date_str or date_str == "—":
        return date_str
    try:
        from datetime import datetime as _dt
        d = _dt.strptime(str(date_str)[:10], "%Y-%m-%d")
        if lang == "it":
            return d.strftime("%d/%m/%Y")
        else:
            return d.strftime("%m/%d/%Y")
    except (ValueError, TypeError):
        return str(date_str)