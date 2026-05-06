with open('app/api/v1/alerts.py', encoding='utf-8') as f:
    content = f.read()

# ── Add translation helper near the top of _generate_alerts_for_window ──────
# Insert after the function signature block's opening logic
old_insert = '    # Explicit empty allow-list => org has no sites => no alerts\n    if allowed_site_ids is not None and len(allowed_site_ids) == 0:\n        return []'

new_insert = '''    # Explicit empty allow-list => org has no sites => no alerts
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        return []'''

# ── Add i18n helper at module level (after imports) ──────────────────────────
old_imports_anchor = 'logger = logging.getLogger("cei")\n\nrouter = APIRouter(prefix="/alerts"'

new_imports_anchor = '''logger = logging.getLogger("cei")

# ---------------------------------------------------------------------------
# Alert message i18n
# Alerts are generated server-side, so we translate titles/messages here
# using the locale passed in from the request context (defaults to English).
# ---------------------------------------------------------------------------

_ALERT_STRINGS: dict = {
    "en": {
        # Rule 1: Night baseline
        "night_critical_title": "High night-time baseline",
        "night_critical_msg": "{site} has a night-time baseline at {ratio} of the day-time average over the last {window}h. This usually indicates significant idle losses (compressors, HVAC, lines left on).",
        "night_warning_title": "Elevated night-time baseline",
        "night_warning_msg": "{site} shows a night-time baseline at {ratio} of day-time average over the last {window}h. There is likely low-hanging fruit in shutdown procedures.",
        # Rule 2: Spike
        "spike_warning_title": "Short-term peak significantly above typical load",
        "spike_warning_msg": "{site} has a peak hour at {peak} kWh, which is {ratio}x the average for the last {window}h. Check for overlapping batches, start-up procedures, or one-off events.",
        # Rule 3: Weekend
        "weekend_warning_title": "Elevated weekend baseline",
        "weekend_warning_msg": "{site} has weekend consumption at {ratio} of weekday average over the last {window}h. Review weekend shutdown procedures and auxiliary loads.",
        # Rule 4: Portfolio dominance
        "portfolio_info_title": "Site dominates portfolio energy",
        "portfolio_info_msg": "{site} is consuming {share}% of portfolio energy over the last {window}h. This is a natural candidate for deeper opportunity hunting and focused projects.",
        # Rule 5: Forecast night
        "forecast_night_critical_title": "Forecast: high night-time baseline next 24h",
        "forecast_night_critical_msg": "{site} is projected to run with a night-time baseline at {ratio} of the day-time forecast over the next 24h. Without changes, off-shift hours are likely to carry significant idle losses.",
        "forecast_night_warning_title": "Forecast: elevated night-time baseline next 24h",
        "forecast_night_warning_msg": "{site} is forecast to have night-time consumption at {ratio} of day-time levels over the next 24h. Tighten shutdown procedures now to avoid avoidable off-shift waste.",
    },
    "it": {
        # Rule 1: Night baseline
        "night_critical_title": "Baseline notturna elevata (critica)",
        "night_critical_msg": "{site} ha una baseline notturna al {ratio} della media diurna nelle ultime {window}h. Questo indica tipicamente perdite a riposo significative (compressori, HVAC, linee lasciate accese).",
        "night_warning_title": "Baseline notturna elevata",
        "night_warning_msg": "{site} mostra una baseline notturna al {ratio} della media diurna nelle ultime {window}h. Probabilmente ci sono interventi facili sulle procedure di spegnimento.",
        # Rule 2: Spike
        "spike_warning_title": "Picco a breve termine significativamente sopra il carico tipico",
        "spike_warning_msg": "{site} ha un'ora di picco a {peak} kWh, pari a {ratio}x la media delle ultime {window}h. Verifica batch sovrapposti, procedure di avviamento o eventi straordinari.",
        # Rule 3: Weekend
        "weekend_warning_title": "Baseline weekend elevata",
        "weekend_warning_msg": "{site} ha consumi nel weekend al {ratio} della media feriale nelle ultime {window}h. Rivedi le procedure di spegnimento nel weekend e i carichi ausiliari.",
        # Rule 4: Portfolio dominance
        "portfolio_info_title": "Il sito domina il consumo del portfolio",
        "portfolio_info_msg": "{site} sta consumando il {share}% dell'energia del portfolio nelle ultime {window}h. È il candidato principale per attività di analisi e interventi mirati.",
        # Rule 5: Forecast night
        "forecast_night_critical_title": "Previsione: baseline notturna alta nelle prossime 24h",
        "forecast_night_critical_msg": "{site} è previsto con una baseline notturna al {ratio} della previsione diurna nelle prossime 24h. Senza interventi, le ore fuori turno accumuleranno perdite a riposo significative.",
        "forecast_night_warning_title": "Previsione: baseline notturna elevata nelle prossime 24h",
        "forecast_night_warning_msg": "{site} è previsto con consumi notturni al {ratio} dei livelli diurni nelle prossime 24h. Ottimizza le procedure di spegnimento ora per evitare sprechi fuori turno.",
    },
}


def _t(key: str, locale: str = "en", **kwargs) -> str:
    """Look up an alert string by key and locale, with English fallback."""
    strings = _ALERT_STRINGS.get(locale) or _ALERT_STRINGS["en"]
    template = strings.get(key) or _ALERT_STRINGS["en"].get(key, key)
    try:
        return template.format(**kwargs)
    except Exception:
        return template


router = APIRouter(prefix="/alerts"'''

if old_imports_anchor in content:
    content = content.replace(old_imports_anchor, new_imports_anchor, 1)
    print('EDIT 1: i18n helper added')
else:
    print('ERROR 1: logger anchor not found')

# ── Add locale parameter to _generate_alerts_for_window signature ────────────
old_sig = '''def _generate_alerts_for_window(
    db: Session,
    window_hours: int,
    allowed_site_ids: Optional[Set[str]] = None,
    *,
    site_id: Optional[str] = None,
    persist_events: bool = False,
    organization_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> List[AlertOut]:'''

new_sig = '''def _generate_alerts_for_window(
    db: Session,
    window_hours: int,
    allowed_site_ids: Optional[Set[str]] = None,
    *,
    site_id: Optional[str] = None,
    persist_events: bool = False,
    organization_id: Optional[int] = None,
    user_id: Optional[int] = None,
    locale: str = "en",
) -> List[AlertOut]:'''

if old_sig in content:
    content = content.replace(old_sig, new_sig, 1)
    print('EDIT 2: locale param added to _generate_alerts_for_window')
else:
    print('ERROR 2: function signature not found')

# ── Rule 1: Night critical ───────────────────────────────────────────────────
old_r1c = '''                    severity="critical",
                    title="High night-time baseline",
                    message=(
                        f"{site_name or sid} has a night-time baseline at "
                        f"{night_ratio:.0%} of the day-time average over the last {window_hours}h. "
                        "This usually indicates significant idle losses (compressors, HVAC, lines left on)."
                    ),
                    metric="night_baseline_ratio",'''

new_r1c = '''                    severity="critical",
                    title=_t("night_critical_title", locale),
                    message=_t("night_critical_msg", locale,
                        site=site_name or sid,
                        ratio=f"{night_ratio:.0%}",
                        window=window_hours,
                    ),
                    metric="night_baseline_ratio",'''

if old_r1c in content:
    content = content.replace(old_r1c, new_r1c, 1)
    print('EDIT 3: Rule 1 critical translated')
else:
    print('ERROR 3: Rule 1 critical not found')

# ── Rule 1: Night warning ────────────────────────────────────────────────────
old_r1w = '''                    severity="warning",
                    title="Elevated night-time baseline",
                    message=(
                        f"{site_name or sid} shows a night-time baseline at "
                        f"{night_ratio:.0%} of day-time average over the last {window_hours}h. "
                        "There is likely low-hanging fruit in shutdown procedures."
                    ),
                    metric="night_baseline_ratio",'''

new_r1w = '''                    severity="warning",
                    title=_t("night_warning_title", locale),
                    message=_t("night_warning_msg", locale,
                        site=site_name or sid,
                        ratio=f"{night_ratio:.0%}",
                        window=window_hours,
                    ),
                    metric="night_baseline_ratio",'''

if old_r1w in content:
    content = content.replace(old_r1w, new_r1w, 1)
    print('EDIT 4: Rule 1 warning translated')
else:
    print('ERROR 4: Rule 1 warning not found')

# ── Rule 2: Spike warning ────────────────────────────────────────────────────
old_r2 = '''                        severity="warning",
                        title="Short-term peak significantly above typical load",
                        message=(
                            f"{site_name or sid} has a peak hour at {max_value:.1f} kWh, "
                            f"which is {spike_ratio:.1f}x the average for the last {window_hours}h. "
                            "Check for overlapping batches, start-up procedures, or one-off events."
                        ),
                        metric="peak_spike_ratio",'''

new_r2 = '''                        severity="warning",
                        title=_t("spike_warning_title", locale),
                        message=_t("spike_warning_msg", locale,
                            site=site_name or sid,
                            peak=f"{max_value:.1f}",
                            ratio=f"{spike_ratio:.1f}",
                            window=window_hours,
                        ),
                        metric="peak_spike_ratio",'''

if old_r2 in content:
    content = content.replace(old_r2, new_r2, 1)
    print('EDIT 5: Rule 2 spike translated')
else:
    print('ERROR 5: Rule 2 spike not found')

# ── Rule 3: Weekend warning ──────────────────────────────────────────────────
old_r3 = '''                        severity="warning",
                        title="Elevated weekend baseline",
                        message=(
                            f"{site_name or sid} has weekend consumption at "
                            f"{weekend_ratio:.0%} of weekday average over the last {window_hours}h. "
                            "Review weekend shutdown procedures and auxiliary loads."
                        ),
                        metric="weekend_weekday_ratio",'''

new_r3 = '''                        severity="warning",
                        title=_t("weekend_warning_title", locale),
                        message=_t("weekend_warning_msg", locale,
                            site=site_name or sid,
                            ratio=f"{weekend_ratio:.0%}",
                            window=window_hours,
                        ),
                        metric="weekend_weekday_ratio",'''

if old_r3 in content:
    content = content.replace(old_r3, new_r3, 1)
    print('EDIT 6: Rule 3 weekend translated')
else:
    print('ERROR 6: Rule 3 weekend not found')

# ── Rule 4: Portfolio info ───────────────────────────────────────────────────
old_r4 = '''                        severity="info",
                        title="Site dominates portfolio energy",
                        message=(
                            f"{site_name or sid} is consuming {share:.1f}% of portfolio "
                            f"energy over the last {window_hours}h. This is a natural candidate "
                            "for deeper opportunity hunting and focused projects."
                        ),
                        metric="relative_share",'''

new_r4 = '''                        severity="info",
                        title=_t("portfolio_info_title", locale),
                        message=_t("portfolio_info_msg", locale,
                            site=site_name or sid,
                            share=f"{share:.1f}",
                            window=window_hours,
                        ),
                        metric="relative_share",'''

if old_r4 in content:
    content = content.replace(old_r4, new_r4, 1)
    print('EDIT 7: Rule 4 portfolio translated')
else:
    print('ERROR 7: Rule 4 portfolio not found')

# ── Rule 5: Forecast night critical ─────────────────────────────────────────
old_r5c = '''                                    severity="critical",
                                    title="Forecast: high night-time baseline next 24h",
                                    message=(
                                        f"{site_name or sid} is projected to run with a night-time "
                                        f"baseline at {forecast_night_ratio:.0%} of the day-time forecast "
                                        "over the next 24h. Without changes, off-shift hours are likely to "
                                        "carry significant idle losses."
                                    ),
                                    metric="forecast_night_baseline_ratio",'''

new_r5c = '''                                    severity="critical",
                                    title=_t("forecast_night_critical_title", locale),
                                    message=_t("forecast_night_critical_msg", locale,
                                        site=site_name or sid,
                                        ratio=f"{forecast_night_ratio:.0%}",
                                    ),
                                    metric="forecast_night_baseline_ratio",'''

if old_r5c in content:
    content = content.replace(old_r5c, new_r5c, 1)
    print('EDIT 8: Rule 5 forecast critical translated')
else:
    print('ERROR 8: Rule 5 forecast critical not found')

# ── Rule 5: Forecast night warning ──────────────────────────────────────────
old_r5w = '''                                    severity="warning",
                                    title="Forecast: elevated night-time baseline next 24h",
                                    message=(
                                        f"{site_name or sid} is forecast to have night-time consumption at "
                                        f"{forecast_night_ratio:.0%} of day-time levels over the next 24h. "
                                        "Tighten shutdown procedures now to avoid avoidable off-shift waste."
                                    ),
                                    metric="forecast_night_baseline_ratio",'''

new_r5w = '''                                    severity="warning",
                                    title=_t("forecast_night_warning_title", locale),
                                    message=_t("forecast_night_warning_msg", locale,
                                        site=site_name or sid,
                                        ratio=f"{forecast_night_ratio:.0%}",
                                    ),
                                    metric="forecast_night_baseline_ratio",'''

if old_r5w in content:
    content = content.replace(old_r5w, new_r5w, 1)
    print('EDIT 9: Rule 5 forecast warning translated')
else:
    print('ERROR 9: Rule 5 forecast warning not found')

# ── Wire locale from Accept-Language header in list_alerts endpoint ──────────
old_call = '''    alerts = _generate_alerts_for_window(
        db=db,
        window_hours=window_hours,
        allowed_site_ids=allowed_site_ids,
        site_id=normalized_site_id,
        persist_events=True,
        organization_id=organization_id,
        user_id=user_id,
    )'''

new_call = '''    locale = "it" if "it" in (request.headers.get("Accept-Language") or "") else "en"
    alerts = _generate_alerts_for_window(
        db=db,
        window_hours=window_hours,
        allowed_site_ids=allowed_site_ids,
        site_id=normalized_site_id,
        persist_events=True,
        organization_id=organization_id,
        user_id=user_id,
        locale=locale,
    )'''

if old_call in content:
    content = content.replace(old_call, new_call, 1)
    print('EDIT 10: locale wired from Accept-Language header')
else:
    print('ERROR 10: list_alerts call not found')

# ── Add Request import and request param to list_alerts ─────────────────────
old_req_import = 'from fastapi import APIRouter, Depends, Query, status, HTTPException, Path'
new_req_import = 'from fastapi import APIRouter, Depends, Query, Request, status, HTTPException, Path'

if old_req_import in content:
    content = content.replace(old_req_import, new_req_import, 1)
    print('EDIT 11: Request imported')
else:
    print('ERROR 11: import line not found')

# ── Add request: Request param to list_alerts function ──────────────────────
old_fn = '''def list_alerts(
    window_hours: int = Query('''
new_fn = '''def list_alerts(
    request: Request,
    window_hours: int = Query('''

if old_fn in content:
    content = content.replace(old_fn, new_fn, 1)
    print('EDIT 12: request param added to list_alerts')
else:
    print('ERROR 12: list_alerts def not found')

with open('app/api/v1/alerts.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')