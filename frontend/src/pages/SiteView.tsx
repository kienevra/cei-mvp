// frontend/src/pages/SiteView.tsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getSite,
  getTimeseriesSummary,
  getTimeseriesSeries,
  getSiteInsights,
  getSiteForecast,
  getSiteKpi,
  createSiteEvent,
  deleteSite,
  getSiteOpportunities,
  createManualOpportunity,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import type { SiteInsights, SiteForecast } from "../types/api";
import type { SiteKpi } from "../services/api";
import type { OpportunityMeasure } from "../services/api";
import { buildHybridNarrative } from "../utils/hybridNarrative";
import SiteAlertsStrip from "../components/SiteAlertsStrip";
import { downloadCsv } from "../utils/csv";
import { getSiteConfig, updateSiteConfig, calculateSiteEmissions, type SiteConfig, type EmissionsResult } from "../services/api";
import SiteTimelineCard from "../components/SiteTimelineCard";
import SiteEnergyChart from "../components/SiteEnergyChart";
import SiteForecastChart from "../components/SiteForecastChart";
import ProductionCorrelation from "../components/ProductionCorrelation";
import ProductionIntegrations from "../components/ProductionIntegrations";
import OpportunityCard from "../components/OpportunityCard";
import RegulatoryIntelligenceCard from "../components/RegulatoryIntelligenceCard";
import { useSiteSocket } from "../hooks/useSiteSocket";
import LiveIndicator from "../components/LiveIndicator";

// ── Country tariff hints (moved from Settings) ────────────────────────────
const COUNTRY_TARIFF_HINTS: Record<string, { label: string; electricity: string; gas: string; currency: string; source: string }> = {
  IT: { label: "🇮🇹 Italy",          electricity: "0.2400", gas: "0.0820", currency: "EUR", source: "Eurostat 2025" },
  DE: { label: "🇩🇪 Germany",        electricity: "0.2100", gas: "0.0750", currency: "EUR", source: "Eurostat 2025" },
  FR: { label: "🇫🇷 France",         electricity: "0.1650", gas: "0.0680", currency: "EUR", source: "Eurostat 2025" },
  ES: { label: "🇪🇸 Spain",          electricity: "0.1800", gas: "0.0700", currency: "EUR", source: "Eurostat 2025" },
  PL: { label: "🇵🇱 Poland",         electricity: "0.1450", gas: "0.0500", currency: "PLN", source: "Eurostat 2025" },
  NL: { label: "🇳🇱 Netherlands",    electricity: "0.1950", gas: "0.0720", currency: "EUR", source: "Eurostat 2025" },
  BE: { label: "🇧🇪 Belgium",        electricity: "0.2050", gas: "0.0780", currency: "EUR", source: "Eurostat 2025" },
  SE: { label: "🇸🇪 Sweden",         electricity: "0.0900", gas: "0.0350", currency: "SEK", source: "Eurostat 2025" },
  NO: { label: "🇳🇴 Norway",         electricity: "0.0580", gas: "0.0000", currency: "NOK", source: "NVE 2025" },
  CH: { label: "🇨🇭 Switzerland",    electricity: "0.1900", gas: "0.0700", currency: "CHF", source: "SFOE 2025" },
  GB: { label: "🇬🇧 United Kingdom", electricity: "0.2250", gas: "0.0900", currency: "GBP", source: "Ofgem 2025" },
  US: { label: "🇺🇸 United States",  electricity: "0.0780", gas: "0.0350", currency: "USD", source: "EIA 2025" },
  CA: { label: "🇨🇦 Canada",         electricity: "0.0850", gas: "0.0380", currency: "CAD", source: "NEB 2025" },
  AU: { label: "🇦🇺 Australia",      electricity: "0.1100", gas: "0.0480", currency: "AUD", source: "AER 2025" },
  JP: { label: "🇯🇵 Japan",          electricity: "0.1650", gas: "0.0600", currency: "JPY", source: "METI 2025" },
  CN: { label: "🇨🇳 China",          electricity: "0.0680", gas: "0.0280", currency: "CNY", source: "NEA 2025" },
  IN: { label: "🇮🇳 India",          electricity: "0.0750", gas: "0.0300", currency: "INR", source: "CERC 2025" },
  KE: { label: "🇰🇪 Kenya",          electricity: "0.1750", gas: "0.0000", currency: "KES", source: "KPLC 2025" },
  NG: { label: "🇳🇬 Nigeria",        electricity: "0.0520", gas: "0.0200", currency: "NGN", source: "NERC 2025" },
  ZA: { label: "🇿🇦 South Africa",   electricity: "0.0980", gas: "0.0380", currency: "ZAR", source: "Eskom 2025" },
  GH: { label: "🇬🇭 Ghana",          electricity: "0.0650", gas: "0.0000", currency: "GHS", source: "ECG 2025" },
  BR: { label: "🇧🇷 Brazil",         electricity: "0.0920", gas: "0.0420", currency: "BRL", source: "ANEEL 2025" },
  MX: { label: "🇲🇽 Mexico",         electricity: "0.0850", gas: "0.0380", currency: "MXN", source: "CFE 2025" },
  AE: { label: "🇦🇪 UAE",            electricity: "0.0820", gas: "0.0000", currency: "AED", source: "DEWA 2025" },
  SA: { label: "🇸🇦 Saudi Arabia",   electricity: "0.0480", gas: "0.0000", currency: "SAR", source: "SEC 2025" },
  ET: { label: "🇪🇹 Ethiopia",       electricity: "0.0600", gas: "0.0000", currency: "ETB", source: "EEU 2025" },
};

type SiteRecord = {
  id: number | string;
  name: string;
  location?: string | null;
  [key: string]: any;
};

type SummaryResponse = {
  site_id: string | null;
  meter_id: string | null;
  window_hours: number;
  total_value: number;
  points: number;
  from_timestamp: string | null;
  to_timestamp: string | null;
};

type SeriesPoint = {
  ts: string;
  value: number;
};

type SeriesResponse = {
  site_id: string | null;
  meter_id: string | null;
  window_hours: number;
  resolution: string;
  points: SeriesPoint[];
};

type TrendPoint = {
  label: string;
  value: number;
};

type ManualOpportunityFormState = {
  name: string;
  description: string;
};

function formatDateTimeLabel(raw?: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeRange(from?: string | null, to?: string | null): string | null {
  if (!from || !to) return null;
  const fromD = new Date(from);
  const toD = new Date(to);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return null;
  }
  const sameDay =
    fromD.getFullYear() === toD.getFullYear() &&
    fromD.getMonth() === toD.getMonth() &&
    fromD.getDate() === toD.getDate();

  if (sameDay) {
    const dayPart = toD.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
    const fromTime = fromD.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const toTime = toD.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${dayPart} · ${fromTime} – ${toTime}`;
  }

  const fromLabel = fromD.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const toLabel = toD.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${fromLabel} → ${toLabel}`;
}

// Normalise FastAPI/Pydantic error payloads into a human-readable string
const normalizeApiError = (e: any, fallback: string): string => {
  // Prefer the "message" field first because api.ts may append "(Support code: <request_id>)"
  if (e?.message && typeof e.message === "string") {
    return e.message;
  }

  const detail = e?.response?.data?.detail;

  if (Array.isArray(detail)) {
    return detail.map((d: any) => d?.msg || JSON.stringify(d)).join(" | ");
  }

  if (detail && typeof detail === "object") {
    if (typeof (detail as any).msg === "string") {
      return (detail as any).msg;
    }
    return JSON.stringify(detail);
  }

  if (typeof detail === "string") {
    return detail;
  }

  return fallback;
};

const isFiniteNumber = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

const pickNumber = (obj: any, keys: string[]): number | null => {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (isFiniteNumber(v)) return v;
  }
  return null;
};

const formatKwhValue = (v: number | null | undefined, digits = 1): string =>
  isFiniteNumber(v) ? v.toFixed(digits) : "—";

const getOppIdKey = (opp: OpportunityMeasure): string => {
  const raw = (opp as any)?.id;
  if (raw === null || raw === undefined) return "unknown";
  return String(raw);
};

const SiteView: React.FC<{ backTo?: string }> = ({ backTo }) => {
  const { t } = useTranslation();

  const { id } = useParams<{ id: string }>();
  const numericSiteId = id ? parseInt(id, 10) : 0;
  const navigate = useNavigate();

  const [site, setSite] = useState<SiteRecord | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [wsRefreshKey, setWsRefreshKey] = useState(0);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [insights, setInsights] = useState<SiteInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const [forecast, setForecast] = useState<SiteForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  const [kpi, setKpi] = useState<SiteKpi | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState<string | null>(null);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const [hybridOpen, setHybridOpen] = useState(false);

  const [opportunities, setOpportunities] = useState<OpportunityMeasure[]>([]);
  const [oppsLoading, setOppsLoading] = useState(false);
  const [oppsError, setOppsError] = useState<string | null>(null);

  const [manualOppForm, setManualOppForm] = useState<ManualOpportunityFormState>({
    name: "",
    description: "",
  });
  const [manualOppSaving, setManualOppSaving] = useState(false);
  const [manualOppError, setManualOppError] = useState<string | null>(null);

  // IMPORTANT: Opportunity ids may not be strictly numeric across environments.
  // Store keys as strings to compile cleanly and avoid TS friction.
  const [actionSavingKey, setActionSavingKey] = useState<string | null>(null);
  const [actionNoteByKey, setActionNoteByKey] = useState<Record<string, string>>({});

  const siteKey = id ? `site-${id}` : undefined;
  const reloadSiteData = useCallback(() => {
    if (!id || !siteKey) return;
    setSummaryLoading(true);
    getTimeseriesSummary({ site_id: siteKey, window_hours: 24 })
      .then((data) => setSummary(data as SummaryResponse))
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
    getSiteKpi(siteKey).then(setKpi).catch(() => {});
    getSiteInsights(siteKey, 24)
      .then((d) => setInsights(d as SiteInsights))
      .catch(() => {});
    setWsRefreshKey(k => k + 1);
  }, [id, siteKey]);

  const { status: wsStatus, lastUpdate: wsLastUpdate, rowsIngested: wsRowsIngested } =
    useSiteSocket(id, {
      onDataUpdated: reloadSiteData,
      enabled: !!id,
    });

  useEffect(() => {
    if (!id) return;
    let isMounted = true;

    // Site metadata (numeric id)
    setSiteLoading(true);
    setSiteError(null);
    getSite(id)
      .then((data) => {
        if (!isMounted) return;
        setSite(data as SiteRecord);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSiteError(
          e?.message ||
            t("siteView.errors.loadSite", { defaultValue: "Failed to load site." })
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setSiteLoading(false);
      });

    if (!siteKey) {
      return () => {
        isMounted = false;
      };
    }

    // Summary (siteKey = "site-1")
    setSummaryLoading(true);
    setSummaryError(null);
    getTimeseriesSummary({ site_id: siteKey, window_hours: 24 })
      .then((data) => {
        if (!isMounted) return;
        setSummary(data as SummaryResponse);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSummaryError(
          e?.message ||
            t("siteView.errors.loadSummary", {
              defaultValue: "Failed to load energy summary.",
            })
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setSummaryLoading(false);
      });

    // Series (siteKey)
    setSeriesLoading(true);
    setSeriesError(null);
    getTimeseriesSeries({
      site_id: siteKey,
      window_hours: 24,
      resolution: "hour",
    })
      .then((data) => {
        if (!isMounted) return;
        setSeries(data as SeriesResponse);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSeriesError(
          e?.message ||
            t("siteView.errors.loadTrend", {
              defaultValue: "Failed to load energy trend.",
            })
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setSeriesLoading(false);
      });

    // Insights (analytics expects siteKey, not numeric id)
    setInsightsLoading(true);
    setInsightsError(null);
    getSiteInsights(siteKey, 24)
      .then((data) => {
        if (!isMounted) return;
        setInsights(data as SiteInsights);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setInsightsError(
          normalizeApiError(
            e,
            t("siteView.errors.loadInsights", {
              defaultValue: "Failed to load analytics insights.",
            })
          )
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setInsightsLoading(false);
      });

    // Forecast (still uses siteKey)
    setForecastLoading(true);
    setForecastError(null);
    setForecast(null);

    getSiteForecast(siteKey, {
      history_window_hours: 24,
      horizon_hours: 48,
      lookback_days: 30,
    })
      .then((data) => {
        if (!isMounted) return;
        if (data && Array.isArray((data as any).points)) {
          setForecast(data);
        } else {
          setForecast(null);
        }
      })
      .catch((e: any) => {
        if (!isMounted) return;
        const status = e?.response?.status;
        if (status === 404) {
          setForecast(null);
          return;
        }
        setForecastError(
          e?.message ||
            t("siteView.errors.loadForecast", {
              defaultValue: "Unable to load forecast right now.",
            })
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setForecastLoading(false);
      });

    // Opportunities (numeric id for /sites/{site_id}/opportunities)
    setOppsLoading(true);
    setOppsError(null);
    setOpportunities([]);

    getSiteOpportunities(id)
      .then((list) => {
        if (!isMounted) return;
        // ✅ Remove BackendOpportunity completely. Treat API response as OpportunityMeasure[].
        setOpportunities(Array.isArray(list) ? (list as OpportunityMeasure[]) : []);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setOppsError(
          normalizeApiError(
            e,
            t("siteView.errors.loadOpportunities", {
              defaultValue: "Failed to load opportunity suggestions.",
            })
          )
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setOppsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, siteKey, t]);

  // KPI – analytics expects siteKey ("site-1")
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    setKpiLoading(true);
    setKpiError(null);

    getSiteKpi(siteKey)
      .then((data) => {
        if (cancelled) return;
        setKpi(data);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setKpiError(
          normalizeApiError(
            e,
            t("siteView.errors.loadKpi", {
              defaultValue: "Unable to load KPI comparison.",
            })
          )
        );
      })
      .finally(() => {
        if (cancelled) return;
        setKpiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [siteKey, t]);

  const hasSummaryData = summary && summary.points > 0;
  const totalKwh = hasSummaryData ? summary!.total_value : 0;
  const formattedKwh = hasSummaryData
    ? totalKwh >= 1000
      ? `${(totalKwh / 1000).toFixed(2)} MWh`
      : `${totalKwh.toFixed(1)} kWh`
    : "—";

  const lastUpdatedLabel = hasSummaryData
    ? formatDateTimeLabel(summary!.to_timestamp)
    : null;

  const dataWindowLabel = hasSummaryData
    ? formatTimeRange(summary!.from_timestamp, summary!.to_timestamp)
    : null;

  let trendPoints: TrendPoint[] = [];
  if (series && Array.isArray(series.points) && series.points.length > 0) {
    trendPoints = series.points.map((p) => {
      const d = new Date(p.ts);
      const label = d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const numericValue = Number(p.value);
      return {
        label,
        value: Number.isFinite(numericValue) ? numericValue : 0,
      };
    });
  }

  const trendValues = trendPoints.map((p) => p.value);
  const hasTrend = trendValues.length > 0;
  const maxVal = hasTrend ? Math.max(...trendValues) : 0;
  const minVal = hasTrend ? Math.min(...trendValues) : 0;

  const barPixelWidth = 40;
  const minContentWidth = 600;
  const chartContentWidth = hasTrend
    ? Math.max(trendPoints.length * barPixelWidth, minContentWidth)
    : minContentWidth;

  const maxBarHeightPx = 160;
  const baseBarHeightPx = 20;

  let trendSummary: string | null = null;
  if (hasTrend && hasSummaryData) {
    const sumVal = trendValues.reduce((acc, v) => acc + v, 0);
    const avgVal = sumVal / trendValues.length;
    const peakIndex = trendValues.indexOf(maxVal);
    const peakLabel = trendPoints[peakIndex]?.label ?? "—";
    const windowHours = summary!.window_hours || 24;

    trendSummary = t("siteView.trend.summary", {
      defaultValue:
        "Peak hour at this site: {{peakLabel}} with {{maxKwh}} kWh · Average: {{avgKwh}} kWh/h over {{windowHours}} hours · Min hourly: {{minKwh}} kWh/h.",
      peakLabel,
      maxKwh: maxVal.toFixed(1),
      avgKwh: avgVal.toFixed(1),
      windowHours: windowHours.toFixed(0),
      minKwh: minVal.toFixed(1),
    });
  }

  const anyError = siteError || summaryError || seriesError || insightsError;

  const suggestions = buildSiteEfficiencySuggestions(
    t,
    hasSummaryData ? totalKwh : null,
    hasSummaryData ? summary!.points : null,
    site?.name || null
  );

  const baselineProfile = insights?.baseline_profile || null;
  const deviationPct = typeof insights?.deviation_pct === "number" ? insights.deviation_pct : null;
  const insightWindowHours = typeof insights?.window_hours === "number" ? insights.window_hours : 24;
  const insightLookbackDays =
    typeof insights?.baseline_lookback_days === "number"
      ? insights.baseline_lookback_days
      : baselineProfile?.lookback_days ?? 30;

  const hasForecast =
    forecast != null &&
    Array.isArray((forecast as any).points) &&
    (forecast as any).points.length > 0;

  const hybrid = buildHybridNarrative(insights, hasForecast ? forecast : null);

  const handleExportTimeseriesCsv = () => {
    if (!series || !Array.isArray(series.points) || series.points.length === 0) {
      alert(
        t("siteView.export.noTimeseries", {
          defaultValue: "No timeseries data available to export yet.",
        })
      );
      return;
    }

    const safeSiteId = siteKey || (id ? `site-${id}` : "site");

    const rows = series.points.map((p, idx) => ({
      index: idx,
      site_id: series.site_id ?? safeSiteId ?? "",
      meter_id: series.meter_id ?? "",
      window_hours: series.window_hours ?? "",
      resolution: series.resolution ?? "",
      timestamp: p.ts,
      value: p.value,
    }));

    downloadCsv(`cei_${safeSiteId}_timeseries.csv`, rows);
  };

  const handleMarkOpportunityActioned = async (opp: OpportunityMeasure) => {
    if (!siteKey) return;

    const key = getOppIdKey(opp);
    const note = (actionNoteByKey[key] || "").trim();

    setActionSavingKey(key);
    try {
      await createSiteEvent(siteKey, {
        type: "action_taken",
        title: `Action taken: ${(opp as any)?.name ?? "Opportunity"}`,
        body: [
          `Opportunity ID: ${key}`,
          `Source: ${(opp as any)?.source || "auto"}`,
          (opp as any)?.est_annual_kwh_saved != null
            ? `Est kWh/yr saved: ${(opp as any).est_annual_kwh_saved}`
            : null,
          (opp as any)?.simple_roi_years != null
            ? `Simple ROI (yrs): ${(opp as any).simple_roi_years}`
            : null,
          note ? `Operator note: ${note}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      });

      // Remove actioned opportunity from list + clear note + refresh timeline
      setOpportunities((prev) => prev.filter((p) => getOppIdKey(p) !== key));
      setActionNoteByKey((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setTimelineRefreshKey((k) => k + 1);
    } catch (e: any) {
      alert(
        normalizeApiError(
          e,
          t("siteView.opps.markActionedFailed", {
            defaultValue: "Failed to log action. Please try again.",
          })
        )
      );
    } finally {
      setActionSavingKey(null);
    }
  };

  const handleExportKpiCsv = () => {
    if (!siteKey) {
      alert(
        t("siteView.export.missingSiteId", {
          defaultValue: "Missing site identifier; cannot export KPI CSV yet.",
        })
      );
      return;
    }
    if (!kpi) {
      alert(
        t("siteView.export.noKpi", {
          defaultValue: "No KPI data available to export yet.",
        })
      );
      return;
    }

    const kpiAny = kpi as any;

    const currency =
      typeof kpiAny.currency_code === "string" && kpiAny.currency_code ? kpiAny.currency_code : "EUR";

    const pricePerKwh = typeof kpiAny.electricity_price_per_kwh === "number" ? kpiAny.electricity_price_per_kwh : null;

    const pricePerMwh = pricePerKwh !== null && Number.isFinite(pricePerKwh) ? pricePerKwh * 1000 : null;

    const primarySources =
      Array.isArray(kpiAny.primary_energy_sources) && kpiAny.primary_energy_sources.length > 0
        ? kpiAny.primary_energy_sources.join(" + ")
        : "";

    const fmt = (val: number | null | undefined, digits: number = 2): string =>
      typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "";

    // Be tolerant to backend naming differences (older vs newer fields)
    const cost24hActual = pickNumber(kpiAny, ["cost_24h_actual", "last_24h_cost", "actual_cost_24h"]);
    const cost24hBaseline = pickNumber(kpiAny, ["expected_24h_cost", "cost_24h_baseline", "baseline_24h_cost", "expected_cost_24h"]);
    const cost24hDelta =
      pickNumber(kpiAny, ["cost_24h_delta", "delta_24h_cost", "cost_delta_24h"]) ??
      (cost24hActual != null && cost24hBaseline != null ? cost24hActual - cost24hBaseline : null);

    const cost7dActual = pickNumber(kpiAny, ["cost_7d_actual", "last_7d_cost", "actual_cost_7d"]);
    const cost7dBaseline = pickNumber(kpiAny, ["cost_7d_baseline", "baseline_7d_cost", "expected_cost_7d"]);
    const cost7dDelta =
      pickNumber(kpiAny, ["cost_7d_delta", "delta_7d_cost", "cost_delta_7d"]) ??
      (cost7dActual != null && cost7dBaseline != null ? cost7dActual - cost7dBaseline : null);

    const row = {
      // identifiers
      site_id: siteKey,
      site_name: site?.name ?? "",
      location: site?.location ?? "",
      kpi_generated_at_utc: kpi.now_utc,

      // 24h energy vs baseline
      last_24h_kwh: fmt(kpi.last_24h_kwh),
      baseline_24h_kwh: fmt(kpi.baseline_24h_kwh),
      deviation_pct_24h: fmt(kpi.deviation_pct_24h),

      // 24h cost KPIs (backend-priced)
      cost_24h_actual: fmt(cost24hActual),
      cost_24h_baseline: fmt(cost24hBaseline),
      cost_24h_delta: fmt(cost24hDelta),

      // 7d energy vs previous 7d
      last_7d_kwh: fmt(kpi.last_7d_kwh),
      prev_7d_kwh: fmt(kpi.prev_7d_kwh),
      deviation_pct_7d: fmt(kpi.deviation_pct_7d),

      // 7d cost KPIs
      cost_7d_actual: fmt(cost7dActual),
      cost_7d_baseline: fmt(cost7dBaseline),
      cost_7d_delta: fmt(cost7dDelta),

      // pricing metadata (for €/MWh anchors in finance models)
      currency_code: currency,
      electricity_price_per_kwh: fmt(pricePerKwh, 6),
      price_per_mwh_anchor: fmt(pricePerMwh, 2),
      primary_energy_sources: primarySources,
    };

    downloadCsv(`cei_${siteKey}_kpi.csv`, [row]);
  };

  const handleGoToUploadForSite = () => {
    if (!siteKey) return;
    navigate(`/upload?site_id=${encodeURIComponent(siteKey)}`);
  };

  const handleDeleteSite = async () => {
    if (!id) return;

    const confirmed = window.confirm(
      t("siteView.actions.deleteConfirm", {
        defaultValue: "This will permanently delete this site and its associated data in CEI. Are you sure?",
      })
    );
    if (!confirmed) return;

    try {
      await deleteSite(id);
      alert(
        t("siteView.actions.deleteSuccess", {
          defaultValue: "Site deleted.",
        })
      );
      navigate("/sites");
    } catch (e: any) {
      console.error("Failed to delete site", e);
      alert(
        normalizeApiError(
          e,
          t("siteView.errors.deleteSite", {
            defaultValue: "Failed to delete site. Please try again or check logs.",
          })
        )
      );
    }
  };

  const formatPct = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "—";
    const rounded = Math.round(value);
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded}%`;
  };

  const kpiDeltaBadgeClass = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "cei-pill-neutral";
    if (value > 10) return "cei-pill-negative";
    if (value > 2) return "cei-pill-warning";
    if (value < -10) return "cei-pill-good";
    return "cei-pill-neutral";
  };

  const formatCurrency = (
    value: number | null | undefined,
    currencyCode: string | null | undefined
  ): string => {
    if (!isFiniteNumber(value)) return "—";
    const safeCode = currencyCode || "EUR";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: safeCode,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${safeCode} ${value.toFixed(2)}`;
    }
  };

  const computeEstimatedEurPerYear = (
    opp: OpportunityMeasure,
    electricityPricePerKwh: number | null
  ): number | null => {
    if (!isFiniteNumber(electricityPricePerKwh)) return null;
    const kwh = (opp as any)?.est_annual_kwh_saved;
    if (!isFiniteNumber(kwh) || kwh <= 0) return null;
    return kwh * electricityPricePerKwh;
  };

  const sortOpportunitiesDecisionReady = (
    list: OpportunityMeasure[],
    electricityPricePerKwh: number | null
  ): OpportunityMeasure[] => {
    const scored = list.map((o) => {
      const eurYr = computeEstimatedEurPerYear(o, electricityPricePerKwh);
      const kwhYr = isFiniteNumber((o as any)?.est_annual_kwh_saved) ? (o as any).est_annual_kwh_saved : null;
      const roi = isFiniteNumber((o as any)?.simple_roi_years) ? (o as any).simple_roi_years : null;

      // Decision-ready scoring:
      // 1) highest €/yr first (if computable)
      // 2) else highest kWh/yr
      // 3) else lowest ROI years
      // 4) else keep stable
      const score =
        (eurYr != null ? eurYr * 1_000_000 : 0) +
        (eurYr == null && kwhYr != null ? kwhYr * 1_000 : 0) +
        (eurYr == null && kwhYr == null && roi != null ? 1 / Math.max(roi, 0.1) : 0);

      return { o, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.o);
  };

  // --- Cost KPI wiring (robust to backend field naming) ---
  const kpiAny = kpi as any;

  const kpiCurrencyCode = (kpiAny?.currency_code as string | null | undefined) ?? null;
  const electricityPricePerKwh = pickNumber(kpiAny, ["electricity_price_per_kwh"]);

  const cost24hActual = useMemo(
    () => pickNumber(kpiAny, ["cost_24h_actual", "last_24h_cost", "actual_cost_24h"]),
    [kpiAny]
  );
  const cost24hBaseline = useMemo(
    () => pickNumber(kpiAny, ["expected_24h_cost", "cost_24h_baseline", "baseline_24h_cost", "expected_cost_24h"]),
    [kpiAny]
  );
  const cost24hDelta = useMemo(() => {
    const direct = pickNumber(kpiAny, ["cost_24h_delta", "delta_24h_cost", "cost_delta_24h"]);
    if (direct != null) return direct;
    if (cost24hActual != null && cost24hBaseline != null) return cost24hActual - cost24hBaseline;
    return null;
  }, [kpiAny, cost24hActual, cost24hBaseline]);

  const decisionReadyOpps = useMemo(() => {
    return sortOpportunitiesDecisionReady(opportunities, electricityPricePerKwh ?? null);
  }, [opportunities, electricityPricePerKwh]);

  const tariffsConfigured =
    electricityPricePerKwh != null || cost24hActual != null || cost24hBaseline != null || cost24hDelta != null;

  const hasCostKpi = tariffsConfigured;

  const costDirectionLabel: string =
    cost24hDelta == null
      ? t("siteView.cost.directionUnknown", { defaultValue: "Savings / overspend vs baseline" })
      : cost24hDelta < 0
      ? t("siteView.cost.savingsVsBaseline", { defaultValue: "Savings vs baseline" })
      : cost24hDelta > 0
      ? t("siteView.cost.overspendVsBaseline", { defaultValue: "Overspend vs baseline" })
      : t("siteView.cost.onBaseline", { defaultValue: "On baseline" });

  const costDeltaAbs = cost24hDelta != null ? Math.abs(cost24hDelta) : null;

  const savingsTooltip = t("siteView.cost.tooltip", {
    defaultValue:
      "24h savings/overspend = (Actual 24h kWh − Baseline 24h kWh) × your org electricity tariff. Negative is savings; positive is overspend.",
  });

 const renderForecastCard = () => {
    if (forecastLoading) return null;
    if (!hasForecast || forecastError) return null;

    const localForecast = forecast as SiteForecast;
    const points = Array.isArray(localForecast.points) ? localForecast.points : [];
    if (points.length === 0) return null;

    const totalExpected = points.reduce((sum, p) => sum + (p.expected_kwh ?? 0), 0);
    const peak = points.reduce((max, p) =>
      (p.expected_kwh ?? 0) > (max.expected_kwh ?? 0) ? p : max
    );
    const peakTimeLabel = new Date(peak.ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <section className="cei-card">
        <div className="cei-card-header" style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 600 }}>
              {t("siteView.forecast.title", { defaultValue: "Next 24h forecast" })}
            </h2>
            <p style={{ marginTop: "0.1rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
              {t("siteView.forecast.subtitle", {
                defaultValue: "Baseline-driven preview of expected energy over the next 24 hours.",
              })}
            </p>
          </div>
          <span
            className="cei-pill cei-pill-neutral"
            style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem", whiteSpace: "nowrap" }}
            title={`Method: ${localForecast.method}`}
          >
            {localForecast.method}
          </span>
        </div>

        {/* KPI summary */}
        <div style={{ marginTop: "0.7rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div className="cei-kpi">
            <div className="cei-kpi-label">
              {t("siteView.forecast.expected24h", { defaultValue: "Expected next 24h" })}
            </div>
            <div className="cei-kpi-value">{totalExpected.toFixed(1)} kWh</div>
          </div>
          <div className="cei-kpi">
            <div className="cei-kpi-label">
              {t("siteView.forecast.peakHour", { defaultValue: "Peak hour (forecast)" })}
            </div>
            <div className="cei-kpi-value">{peakTimeLabel}</div>
            <div className="cei-kpi-subvalue">{(peak.expected_kwh ?? 0).toFixed(1)} kWh</div>
          </div>
        </div>

        {/* Chart */}
        <div style={{ marginTop: "0.8rem" }}>
          <SiteForecastChart
            points={points}
            method={localForecast.method}
            loading={false}
          />
        </div>

        <p style={{ marginTop: "0.8rem", fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
          {t("siteView.forecast.footer", {
            defaultValue:
              "Based on a {{lookback}}-day baseline and a {{history}}-hour recent performance window.",
            lookback: localForecast.baseline_lookback_days,
            history: localForecast.history_window_hours,
          })}
        </p>
      </section>
    );
  };

  const handleAddSiteNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!siteKey) return;

    const trimmedTitle = noteTitle.trim();
    const trimmedBody = noteBody.trim();

    if (!trimmedTitle && !trimmedBody) {
      setNoteError(
        t("siteView.notes.errors.empty", {
          defaultValue: "Please add a title or some text before saving.",
        })
      );
      return;
    }

    setNoteSaving(true);
    setNoteError(null);

    try {
      await createSiteEvent(siteKey, {
        type: "operator_note",
        title: trimmedTitle || undefined,
        body: trimmedBody || undefined,
      });

      setNoteTitle("");
      setNoteBody("");
      setTimelineRefreshKey((k) => k + 1);
    } catch (err: any) {
      setNoteError(
        normalizeApiError(
          err,
          t("siteView.notes.errors.saveFailed", {
            defaultValue: "Failed to save note. Please try again.",
          })
        )
      );
    } finally {
      setNoteSaving(false);
    }
  };

  const handleManualOppSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setManualOppError(null);

    const name = manualOppForm.name.trim();
    const description = manualOppForm.description.trim();

    if (!name && !description) {
      setManualOppError(
        t("siteView.manualOpp.errors.empty", {
          defaultValue: "Please add a name or description.",
        })
      );
      return;
    }

    if (!id) {
      setManualOppError(
        t("siteView.manualOpp.errors.missingSiteId", {
          defaultValue: "Missing numeric site id.",
        })
      );
      return;
    }

    try {
      setManualOppSaving(true);
      const created = await createManualOpportunity(id, {
        name: name || t("siteView.manualOpp.defaultName", { defaultValue: "Opportunity" }),
        description: description || undefined,
      });

      // If backend returns a full OpportunityMeasure, keep it.
      // If it returns a minimal object, pad it to OpportunityMeasure shape (feature-preserving).
      const createdAny = created as any;

      const next: OpportunityMeasure = {
        id: createdAny?.id,
        name: createdAny?.name ?? (name || "Opportunity"),
        description: createdAny?.description ?? description ?? null,
        source: "manual",

        est_annual_kwh_saved: createdAny?.est_annual_kwh_saved ?? null,
        est_capex_eur: createdAny?.est_capex_eur ?? null,
        simple_roi_years: createdAny?.simple_roi_years ?? null,
        est_co2_tons_saved_per_year: createdAny?.est_co2_tons_saved_per_year ?? null,
      } as OpportunityMeasure;

      setOpportunities((prev) => [next, ...prev]);

      setManualOppForm({ name: "", description: "" });
    } catch (err: any) {
      setManualOppError(
        normalizeApiError(
          err,
          t("siteView.manualOpp.errors.createFailed", {
            defaultValue: "Failed to create opportunity.",
          })
        )
      );
    } finally {
      setManualOppSaving(false);
    }
  };

  return (
    <div className="dashboard-page" style={{ maxWidth: "100vw", overflowX: "hidden" }}>
      {/* Header */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "1rem",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--cei-text-muted)",
              marginBottom: "0.2rem",
            }}
          >
            <Link to={backTo ?? "/sites"} style={{ color: "var(--cei-text-accent)" }}>
              {t("siteView.nav.backToSites", { defaultValue: "← Back to sites" })}
            </Link>
          </div>
          <h1
            style={{
              fontSize: "1.3rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {siteLoading
              ? t("common.loadingEllipsis", { defaultValue: "Loading…" })
              : site?.name || t("siteView.title.fallback", { defaultValue: "Site" })}
          </h1>
          <LiveIndicator
            status={wsStatus}
            lastUpdate={wsLastUpdate}
            rowsIngested={wsRowsIngested}
          />
          {hybrid?.headline && (
            <p style={{ marginTop: "0.25rem", fontSize: "0.88rem", color: "var(--cei-text-accent)", fontWeight: 500 }}>
              {hybrid.headline}
            </p>
          )}
          <p
            style={{
              marginTop: "0.2rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <code>site_id = {siteKey ?? "?"}</code>
          </p>
        </div>
        <div
          style={{
            textAlign: "right",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.35rem",
          }}
        >
          {site?.location && (
            <div>
              <span style={{ fontWeight: 500 }}>
                {t("siteView.meta.locationLabel", { defaultValue: "Location:" })}
              </span>{" "}
              {site.location}
            </div>
          )}
          <div>
            <span style={{ fontWeight: 500 }}>
              {t("siteView.meta.siteIdLabel", { defaultValue: "Site ID:" })}
            </span>{" "}
            {siteKey ?? id ?? "—"}
          </div>
          {lastUpdatedLabel && (
            <div style={{ marginTop: "0.15rem" }}>
              {t("siteView.meta.lastUpdated", { defaultValue: "Last updated:" })}{" "}
              <span style={{ color: "var(--cei-text-accent)" }}>{lastUpdatedLabel}</span>
            </div>
          )}
          {dataWindowLabel && (
            <div style={{ marginTop: "0.1rem", fontSize: "0.75rem" }}>
              {t("siteView.meta.dataWindow", { defaultValue: "Data window:" })} {dataWindowLabel}
            </div>
          )}
          <button
            type="button"
            className="cei-btn cei-btn-ghost"
            onClick={handleGoToUploadForSite}
            disabled={!siteKey}
            style={{
              marginTop: "0.4rem",
              fontSize: "0.75rem",
              padding: "0.25rem 0.7rem",
            }}
          >
            {t("siteView.actions.uploadCsvForSite", { defaultValue: "Upload CSV for this site" })}
          </button>
          <button
            type="button"
            className="cei-btn"
            onClick={handleDeleteSite}
            style={{
              marginTop: "0.3rem",
              fontSize: "0.75rem",
              padding: "0.25rem 0.7rem",
              borderRadius: "999px",
              border: "1px solid rgba(248, 113, 113, 0.8)",
              color: "rgb(248, 113, 113)",
              background:
                "radial-gradient(circle at top left, rgba(239, 68, 68, 0.14), rgba(15, 23, 42, 0.95))",
            }}
          >
            {t("siteView.actions.deleteSite", { defaultValue: "Delete site" })}
          </button>
        </div>
      </section>

      {/* Error banner */}
      {anyError && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner
            message={anyError}
            onClose={() => {
              setSiteError(null);
              setSummaryError(null);
              setSeriesError(null);
              setInsightsError(null);
            }}
          />
        </section>
      )}

      {/* KPI row */}
      <section className="dashboard-row">
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}
          >
            {t("siteView.kpis.energy24h.title", { defaultValue: "Energy – last 24 hours" })}
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.6rem",
              fontWeight: 600,
            }}
          >
            {summaryLoading ? "…" : formattedKwh}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {hasSummaryData ? (
              <>
                {t("siteView.kpis.energy24h.bodyA", { defaultValue: "Aggregated from" })}{" "}
                <strong>
                  {summary!.points.toLocaleString()}{" "}
                  {t("siteView.kpis.energy24h.readings", { defaultValue: "readings" })}
                </strong>{" "}
                {t("siteView.kpis.energy24h.bodyB", { defaultValue: "in the last" })}{" "}
                {summary!.window_hours} {t("siteView.kpis.energy24h.hours", { defaultValue: "hours" })}{" "}
                {t("siteView.kpis.energy24h.bodyC", { defaultValue: "for this site." })}
              </>
            ) : summaryLoading ? (
              t("siteView.kpis.energy24h.loading", { defaultValue: "Loading per-site energy data…" })
            ) : (
              <>
                {t("siteView.kpis.energy24h.noDataA", {
                  defaultValue:
                    "No recent data for this site. Either ensure your uploaded timeseries includes",
                })}{" "}
                <code>site_id = {siteKey ?? "site-N"}</code>
                {t("siteView.kpis.energy24h.noDataB", {
                  defaultValue:
                    ", or use the “Upload CSV for this site” button so CEI routes rows here automatically when your CSV has no site_id column.",
                })}
              </>
            )}
          </div>
        </div>

        <div className="cei-card">
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}
          >
            {t("siteView.kpis.coverage.title", { defaultValue: "Data coverage" })}
          </div>
          <div style={{ marginTop: "0.35rem", fontSize: "1.4rem", fontWeight: 600 }}>
            {hasSummaryData ? summary!.points.toLocaleString() : "—"}
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            {t("siteView.kpis.coverage.subtitle", {
              defaultValue: "Number of records for this site in the selected window.",
            })}
          </div>
        </div>

        <div className="cei-card">
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}
          >
            {t("siteView.kpis.status.title", { defaultValue: "Status" })}
          </div>
          <div style={{ marginTop: "0.35rem", fontSize: "1.2rem", fontWeight: 600 }}>
            {hasSummaryData
              ? t("siteView.kpis.status.active", { defaultValue: "Active" })
              : t("siteView.kpis.status.noRecentData", { defaultValue: "No recent data" })}
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            {t("siteView.kpis.status.subtitle", {
              defaultValue:
                "Simple heuristic status based on whether we see any recent timeseries for this site.",
            })}
          </div>
        </div>
      </section>

      {/* KPI snapshot row */}
      <section className="dashboard-row">
        <div className="cei-card">
          <div className="cei-card-header">
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                {t("siteView.snapshot.title", { defaultValue: "Performance snapshot" })}
              </div>
              <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                {t("siteView.snapshot.subtitle", {
                  defaultValue:
                    "Last 24h vs baseline, and last 7 days vs previous 7 days for this site. Cost metrics use your org's configured tariffs.",
                })}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem" }}>
              {kpiLoading && (
                <span className="cei-pill cei-pill-neutral">
                  {t("common.updatingEllipsis", { defaultValue: "Updating…" })}
                </span>
              )}

              {!kpiLoading && kpi && !tariffsConfigured && (
                <span
                  className="cei-pill cei-pill-neutral"
                  title={t("siteView.snapshot.noTariffsTooltip", {
                    defaultValue: "Configure tariffs in the site configuration panel below to enable € KPIs.",
                  })}
                >
                  {t("siteView.snapshot.noTariffs", { defaultValue: "No tariffs configured – showing kWh only" })}
                </span>
              )}

              <button
                type="button"
                className="cei-btn cei-btn-ghost"
                onClick={handleExportKpiCsv}
                disabled={kpiLoading || !kpi || !siteKey}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.7rem" }}
              >
                {t("siteView.export.downloadKpiCsv", { defaultValue: "Download KPI CSV" })}
              </button>
            </div>
          </div>

          {kpiError && (
            <div style={{ marginTop: "0.35rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>{kpiError}</div>
          )}

          {kpi && (
            <>
              <div
                style={{
                  marginTop: "0.6rem",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(0, 1fr))",
                  gap: "0.9rem",
                  fontSize: "0.8rem",
                }}
              >
                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--cei-text-muted)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {t("siteView.snapshot.last24hVsBaseline", { defaultValue: "Last 24h vs baseline" })}
                  </div>
                  <div>
                    <span style={{ fontFamily: "var(--cei-font-mono, monospace)", fontWeight: 500 }}>
                      {formatKwhValue(kpi.last_24h_kwh, 0)} kWh
                    </span>{" "}
                    <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                      {t("siteView.snapshot.baselinePrefix", { defaultValue: "/ baseline" })}{" "}
                      {kpi.baseline_24h_kwh != null ? `${formatKwhValue(kpi.baseline_24h_kwh, 0)} kWh` : "—"}
                    </span>
                  </div>
                  <div style={{ marginTop: "0.25rem" }}>
                    <span
                      className={`cei-pill ${kpiDeltaBadgeClass(kpi.deviation_pct_24h)}`}
                      style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
                    >
                      {formatPct(kpi.deviation_pct_24h)} {t("siteView.snapshot.vsBaseline", { defaultValue: "vs baseline" })}
                    </span>
                  </div>
                </div>

                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--cei-text-muted)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {t("siteView.snapshot.last7dVsPrev7d", { defaultValue: "Last 7 days vs previous 7 days" })}
                  </div>
                  <div>
                    <span style={{ fontFamily: "var(--cei-font-mono, monospace)", fontWeight: 500 }}>
                      {formatKwhValue(kpi.last_7d_kwh, 0)} kWh
                    </span>{" "}
                    <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                      {t("siteView.snapshot.prevPrefix", { defaultValue: "/ prev" })}{" "}
                      {kpi.prev_7d_kwh != null ? `${formatKwhValue(kpi.prev_7d_kwh, 0)} kWh` : "—"}
                    </span>
                  </div>
                  <div style={{ marginTop: "0.25rem" }}>
                    <span
                      className={`cei-pill ${kpiDeltaBadgeClass(kpi.deviation_pct_7d)}`}
                      style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
                    >
                      {formatPct(kpi.deviation_pct_7d)} {t("siteView.snapshot.vsPrev7d", { defaultValue: "vs previous 7d" })}
                    </span>
                  </div>
                </div>

                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--cei-text-muted)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {t("siteView.snapshot.headlineTitle", { defaultValue: "Headline" })}
                  </div>
                  <p style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", lineHeight: 1.5 }}>
                    {kpi.deviation_pct_7d != null && Math.abs(kpi.deviation_pct_7d) > 5
                      ? kpi.deviation_pct_7d > 0
                        ? t("siteView.snapshot.headline.above", {
                            defaultValue:
                              "Energy use is trending above the previous week. Worth a closer look at this site.",
                          })
                        : t("siteView.snapshot.headline.below", {
                            defaultValue:
                              "Energy use is trending below the previous week. Capture what’s working and standardize it.",
                          })
                      : t("siteView.snapshot.headline.flat", {
                          defaultValue:
                            "Energy use is roughly in line with last week. Focus attention on spike alerts and anomaly windows.",
                        })}
                  </p>
                </div>
              </div>

              {/* Cost snapshot – 24h cost, expected 24h cost, savings/overspend */}
              <div style={{ marginTop: "0.9rem", paddingTop: "0.75rem", borderTop: "1px solid var(--cei-border-subtle)" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    marginBottom: "0.35rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--cei-text-muted)",
                    }}
                  >
                    {t("siteView.cost.snapshotTitle", { defaultValue: "Cost snapshot (last 24h)" })}
                  </div>

                  <span
                    className="cei-pill cei-pill-neutral"
                    title={savingsTooltip}
                    style={{ cursor: "help", userSelect: "none" }}
                  >
                    {t("siteView.cost.howCalculated", { defaultValue: "How is 24h savings calculated?" })}
                  </span>
                </div>

                {hasCostKpi ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(0, 1fr))",
                      gap: "0.8rem",
                      fontSize: "0.8rem",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginBottom: "0.15rem" }}>
                        {t("siteView.cost.actual24h", { defaultValue: "24h cost (actual)" })}
                      </div>
                      <div style={{ fontFamily: "var(--cei-font-mono, monospace)", fontWeight: 500 }}>
                        {formatCurrency(cost24hActual, kpiCurrencyCode)}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginBottom: "0.15rem" }}>
                        {t("siteView.cost.expected24h", { defaultValue: "24h cost (expected)" })}
                      </div>
                      <div style={{ fontFamily: "var(--cei-font-mono, monospace)", fontWeight: 500 }}>
                        {formatCurrency(cost24hBaseline, kpiCurrencyCode)}
                      </div>
                      <div style={{ marginTop: "0.15rem", fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                        {t("siteView.cost.expectedHelp", { defaultValue: "Based on baseline kWh for this site." })}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginBottom: "0.15rem" }}>
                        {t("siteView.cost.delta24h", { defaultValue: "24h savings / overspend" })}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                        <span style={{ fontFamily: "var(--cei-font-mono, monospace)", fontWeight: 500 }}>
                          {formatCurrency(costDeltaAbs, kpiCurrencyCode)}{" "}
                          {costDirectionLabel !== t("siteView.cost.onBaseline", { defaultValue: "On baseline" }) &&
                          costDirectionLabel !==
                            t("siteView.cost.directionUnknown", { defaultValue: "Savings / overspend vs baseline" }) ? (
                            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                              ({costDirectionLabel})
                            </span>
                          ) : null}
                        </span>
                        {kpi.deviation_pct_24h != null && (
                          <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                            {t("siteView.cost.energyBasis", {
                              defaultValue: "{{pct}} vs baseline on an energy basis.",
                              pct: formatPct(kpi.deviation_pct_24h),
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                    {t("siteView.cost.disabled", {
                      defaultValue:
                        "Cost analytics for this site will light up once tariffs are configured. Use the site configuration panel (⚙️ Configurazione impianto) below to set electricity price, gas price, and currency.",
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Trend + metadata */}
      <section>
        <div className="cei-card" style={{ maxWidth: "100%", overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.7rem",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                {t("siteView.trend.title", { defaultValue: "Site energy trend – last 24 hours" })}
              </div>
              <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                {t("siteView.trend.subtitle", { defaultValue: "Per-site series aggregated by hour. Uses" })}{" "}
                <code>site_id = {siteKey}</code>{" "}
                {t("siteView.trend.subtitleTail", { defaultValue: "from timeseries." })}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "0.35rem",
                fontSize: "0.75rem",
                color: "var(--cei-text-muted)",
              }}
            >
              <div>{t("siteView.trend.units", { defaultValue: "kWh · hourly" })}</div>
              <button
                type="button"
                className="cei-btn cei-btn-ghost"
                onClick={handleExportTimeseriesCsv}
                disabled={seriesLoading || !series || !Array.isArray(series.points) || series.points.length === 0}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
              >
                {seriesLoading
                  ? t("siteView.export.preparing", { defaultValue: "Preparing…" })
                  : t("siteView.export.downloadCsv", { defaultValue: "Download CSV" })}
              </button>
            </div>
          </div>

          <SiteEnergyChart
            hours={insights?.hours ?? []}
            windowHours={insights?.window_hours ?? 24}
            siteName={site?.name ?? null}
            loading={insightsLoading}
          />

          {trendSummary && !insightsLoading && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {trendSummary}
            </div>
          )}
        </div>

        </section>

      {siteKey && (
        <section style={{ marginTop: "0.75rem" }}>
          <SiteAlertsStrip siteKey={siteKey} limit={3} />
        </section>
      )}

      {/* Forecast card */}
      <section key={`fc-${wsRefreshKey}`} style={{ marginTop: "0.75rem" }}>{renderForecastCard()}</section>

      {/* Production correlation — kWh per unit produced (ISO 50001) */}
      {id && (
        <section style={{ marginTop: "0.75rem" }}>
          <div className="cei-card">
            <ProductionCorrelation key={`pc-${wsRefreshKey}`} siteId={id} />
            <ProductionIntegrations siteId={numericSiteId} />
          </div>
        </section>
      )}

      {numericSiteId && (
        <SiteConfigPanel siteId={numericSiteId} />
      )}
      {/* Regulatory Intelligence Engine */}
      {numericSiteId > 0 && (
        <section style={{ marginTop: "0.75rem" }}>
          <RegulatoryIntelligenceCard siteId={numericSiteId} />
        </section>
      )}
      {/* Opportunities + baseline insights */}
      <section>
        <div className="cei-card">
          <div style={{ marginBottom: "0.6rem" }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
              {t("siteView.opps.title", { defaultValue: "Efficiency opportunities & baseline insights" })}
            </div>
            <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("siteView.opps.subtitle", {
                defaultValue:
                  "Targeted ideas based on the last 24 hours of energy at this site. Use this to brief local operations on where to focus next.",
              })}
            </div>

            {insightsLoading && (
              <div style={{ marginTop: "0.35rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                {t("siteView.opps.loadingBaseline", { defaultValue: "Loading baseline profile for this site…" })}
              </div>
            )}

            {!insightsLoading && baselineProfile && (
              <div style={{ marginTop: "0.35rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                {t("siteView.opps.baselineSummary", {
                  defaultValue:
                    "Baseline (last {{days}} days): global mean around {{mean}} kWh/hour, median hour about {{p50}} kWh, and a high-load p90 near {{p90}} kWh. The last {{window}} hours ran {{deviation}} vs this learned baseline.",
                  days: insightLookbackDays.toFixed(0),
                  mean: baselineProfile.global_mean_kwh.toFixed(1),
                  p50: baselineProfile.global_p50_kwh.toFixed(1),
                  p90: baselineProfile.global_p90_kwh.toFixed(1),
                  window: insightWindowHours.toFixed(0),
                  deviation:
                    deviationPct !== null ? `${deviationPct >= 0 ? "+" : ""}${deviationPct.toFixed(1)}%` : "—",
                })}
              </div>
            )}

            <div style={{ marginTop: "0.35rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
              {t("siteView.opps.underTheHood", {
                defaultValue:
                  "Under the hood, CEI compares this site's night vs day baseline, weekend vs weekday levels, and short-lived spikes vs typical hourly load — the same logic powering the Alerts page. Use both views together to separate day-to-day noise from structural waste.",
              })}
            </div>

            {oppsLoading && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                {t("siteView.opps.scanning", {
                  defaultValue: "Scanning this site's KPIs for concrete opportunity measures…",
                })}
              </div>
            )}

            {!oppsLoading && oppsError && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                {oppsError}{" "}
                {t("siteView.opps.fallback", { defaultValue: "Falling back to generic guidance below." })}
              </div>
            )}

            {!oppsLoading && opportunities.length > 0 && (
              <div style={{ marginTop: "0.75rem" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.5rem" }}>
                  {t("siteView.opps.modelledMeasures", { defaultValue: "Modelled measures for this site" })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {decisionReadyOpps.map((o, idx) => {
                    const roiYears = isFiniteNumber((o as any)?.simple_roi_years) ? (o as any).simple_roi_years : null;
                    const savingsKwhYr = isFiniteNumber((o as any)?.est_annual_kwh_saved)
                      ? (o as any).est_annual_kwh_saved
                      : null;
                    const co2 = isFiniteNumber((o as any)?.est_co2_tons_saved_per_year)
                      ? (o as any).est_co2_tons_saved_per_year
                      : null;

                    const eurYr = computeEstimatedEurPerYear(o, electricityPricePerKwh ?? null);
                    const key = getOppIdKey(o);

                    return (
                      <OpportunityCard
                        key={`${(o as any)?.source || "auto"}-${key}-${idx}`}
                        opp={o}
                        rank={idx + 1}
                        eurPerYear={eurYr}
                        kpiCurrencyCode={kpiCurrencyCode}
                        actionNote={actionNoteByKey[key] || ""}
                        actionSaving={actionSavingKey === key}
                        onActionNoteChange={(val) => setActionNoteByKey((prev) => ({ ...prev, [key]: val }))}
                        onMarkActioned={() => handleMarkOpportunityActioned(o)}
                        formatCurrency={formatCurrency}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Manual opportunity quick-add form */}
          <div
            style={{
              marginTop: "0.75rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid rgba(148, 163, 184, 0.4)",
            }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.35rem" }}>
              {t("siteView.manualOpp.title", { defaultValue: "Add manual opportunity" })}
            </div>

            {manualOppError && (
              <div style={{ marginBottom: "0.4rem", fontSize: "0.78rem", color: "#f97373" }}>{manualOppError}</div>
            )}

            <form onSubmit={handleManualOppSubmit}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <input
                  type="text"
                  placeholder={t("siteView.manualOpp.namePlaceholder", {
                    defaultValue: "Short opportunity name (e.g. 'LED retrofit in warehouse')",
                  })}
                  value={manualOppForm.name}
                  onChange={(e) =>
                    setManualOppForm((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: "0.45rem 0.6rem",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(148, 163, 184, 0.5)",
                    backgroundColor: "rgba(15,23,42,0.9)",
                    color: "var(--cei-text-main)",
                    fontSize: "0.85rem",
                  }}
                />
                <textarea
                  placeholder={t("siteView.manualOpp.descPlaceholder", {
                    defaultValue: "Optional details (e.g. capex, expected savings, owner, target date)…",
                  })}
                  value={manualOppForm.description}
                  onChange={(e) =>
                    setManualOppForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.6rem",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(148, 163, 184, 0.5)",
                    backgroundColor: "rgba(15,23,42,0.9)",
                    color: "var(--cei-text-main)",
                    fontSize: "0.85rem",
                    resize: "vertical",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.2rem" }}>
                  <button
                    type="submit"
                    className="cei-btn"
                    disabled={manualOppSaving || (!manualOppForm.name && !manualOppForm.description)}
                    style={{ fontSize: "0.8rem", padding: "0.35rem 0.9rem" }}
                  >
                    {manualOppSaving
                      ? t("common.savingEllipsis", { defaultValue: "Saving…" })
                      : t("siteView.manualOpp.add", { defaultValue: "Add opportunity" })}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {suggestions.length === 0 ? (
            <div style={{ marginTop: "0.7rem", fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>
              {t("siteView.suggestions.none", {
                defaultValue:
                  "No specific opportunities detected yet. Once this site has a more stable data profile, CEI will surface patterns worth acting on here.",
              })}
            </div>
          ) : (
            <ul
              style={{
                marginTop: "0.7rem",
                paddingLeft: "1.1rem",
                fontSize: "0.84rem",
                color: "var(--cei-text-main)",
                lineHeight: 1.5,
              }}
            >
              {suggestions.map((s, idx) => (
                <li key={idx} style={{ marginBottom: "0.3rem" }}>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* CEI hybrid view */}
      {hybrid && (
        <section style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            onClick={() => setHybridOpen(o => !o)}
            style={{
              width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.55rem 1rem",
              background: "radial-gradient(circle at top left,#0f172a,#020617)",
              border: "1px solid rgba(148,163,184,0.16)",
              borderRadius: hybridOpen ? "0.75rem 0.75rem 0 0" : "0.75rem",
              cursor: "pointer", fontSize: "0.82rem",
            }}
          >
            <span style={{ color: "var(--cei-text-muted)" }}>📊 {t("siteView.hybrid.title", { defaultValue: "CEI hybrid view" })} — analisi dettagliata</span>
            <span style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)" }}>{hybridOpen ? "▲" : "▼"}</span>
          </button>
          {hybridOpen && (
            <div style={{
              border: "1px solid rgba(148,163,184,0.16)", borderTop: "none",
              borderRadius: "0 0 0.75rem 0.75rem", padding: "0.85rem 1rem",
              background: "radial-gradient(circle at top left,#0f172a,#020617)",
            }}>
              <div style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "0.4rem" }}>{hybrid.headline}</div>
              <ul style={{ paddingLeft: "1.1rem", fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.6, margin: 0 }}>
                {hybrid.bullets.map((b, idx) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {siteKey && (
        <section style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            onClick={() => setActivityOpen(o => !o)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.65rem 1rem",
              background: "radial-gradient(circle at top left, #0f172a, #020617)",
              border: "1px solid rgba(148,163,184,0.16)",
              borderRadius: activityOpen ? "0.75rem 0.75rem 0 0" : "0.75rem",
              cursor: "pointer",
              color: "var(--cei-text-muted)",
              fontSize: "0.85rem",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--cei-text-main)" }}>
              📋 {t("siteView.notes.title", { defaultValue: "Activity & Notes" })}
            </span>
            <span style={{ fontSize: "0.75rem" }}>{activityOpen ? "▲ Hide" : "▼ Show"}</span>
          </button>

          {activityOpen && (
            <div style={{
              border: "1px solid rgba(148,163,184,0.16)",
              borderTop: "none",
              borderRadius: "0 0 0.75rem 0.75rem",
              padding: "1rem",
              background: "radial-gradient(circle at top left, #0f172a, #020617)",
            }}>
              <div className="dashboard-main-grid">
                <div className="cei-card">
                  <div className="cei-card-header">
                    <div>
                      <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                        {t("siteView.notes.title", { defaultValue: "Add site note" })}
                      </div>
                      <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                        {t("siteView.notes.subtitle", {
                          defaultValue: "Log operational changes, decisions, or observations.",
                        })}
                      </div>
                    </div>
                    {noteSaving && (
                      <span className="cei-pill cei-pill-neutral">
                        {t("common.savingEllipsis", { defaultValue: "Saving…" })}
                      </span>
                    )}
                  </div>

                  {noteError && (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "#f97373" }}>{noteError}</div>
                  )}

                  <form onSubmit={handleAddSiteNote} style={{ marginTop: "0.6rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <input
                        type="text"
                        placeholder={t("siteView.notes.titlePlaceholder", { defaultValue: "Short title (optional)" })}
                        value={noteTitle}
                        onChange={(e) => setNoteTitle(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.45rem 0.6rem",
                          borderRadius: "0.5rem",
                          border: "1px solid rgba(148, 163, 184, 0.5)",
                          backgroundColor: "rgba(15,23,42,0.9)",
                          color: "var(--cei-text-main)",
                          fontSize: "0.85rem",
                        }}
                      />
                      <textarea
                        placeholder={t("siteView.notes.bodyPlaceholder", {
                          defaultValue: "What changed at this site? E.g. 'HVAC schedule updated'",
                        })}
                        value={noteBody}
                        onChange={(e) => setNoteBody(e.target.value)}
                        rows={3}
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.6rem",
                          borderRadius: "0.5rem",
                          border: "1px solid rgba(148, 163, 184, 0.5)",
                          backgroundColor: "rgba(15,23,42,0.9)",
                          color: "var(--cei-text-main)",
                          fontSize: "0.85rem",
                          resize: "vertical",
                        }}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.2rem" }}>
                        <button
                          type="submit"
                          className="cei-btn"
                          disabled={noteSaving || (!noteTitle && !noteBody)}
                          style={{ fontSize: "0.8rem", padding: "0.35rem 0.9rem" }}
                        >
                          {noteSaving
                            ? t("common.savingEllipsis", { defaultValue: "Saving…" })
                            : t("siteView.notes.save", { defaultValue: "Save note" })}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>

                <SiteTimelineCard siteId={siteKey} windowHours={168} refreshKey={timelineRefreshKey} />
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Site Configuration & Emissions ── */}
    </div>
  );
};
// ── Site Configuration & Emissions Panel ──────────────────────────────────────
function SiteConfigPanel({ siteId }: { siteId: number }) {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [emissions, setEmissions] = useState<EmissionsResult | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<SiteConfig>>({});
  const [countryHintKey, setCountryHintKey] = useState("");
  const { t } = useTranslation();

  const handleCountryHintChange = (code: string) => {
    setCountryHintKey(code);
    if (!code) return;
    const hint = COUNTRY_TARIFF_HINTS[code];
    if (!hint) return;
    setForm(f => ({
      ...f,
      electricity_price_per_kwh: parseFloat(hint.electricity),
      gas_price_per_kwh: hint.gas && hint.gas !== "0.0000" ? parseFloat(hint.gas) : f.gas_price_per_kwh,
      currency_code: hint.currency,
    }));
  };

  useEffect(() => {
    getSiteConfig(siteId).then(c => { setConfig(c); setForm(c); }).catch(() => {});
    calculateSiteEmissions(siteId, 168).then(setEmissions).catch(() => {});
  }, [siteId]);

  const handleSave = async () => {
    setSaving(true); setSaveMsg(null);
    try {
      const updated = await updateSiteConfig(siteId, {
        electricity_price_per_kwh:  form.electricity_price_per_kwh  ?? null,
        gas_price_per_kwh:          form.gas_price_per_kwh          ?? null,
        currency_code:              form.currency_code              ?? null,
        country_code:               form.country_code               ?? null,
        framework:                  form.framework                  ?? null,
        sector_code:                form.sector_code                ?? null,
        primary_energy_source:      form.primary_energy_source      ?? null,
        annual_production_volume:   form.annual_production_volume   ?? null,
        production_unit:            form.production_unit            ?? null,
        free_allocation_tonnes:     form.free_allocation_tonnes     ?? null,
        reporting_year:             form.reporting_year             ?? null,
      });
      setConfig(updated);
      setForm(updated);
      setSaveMsg(t("siteConfig.panel.saved", { defaultValue: "✓ Saved" }));
      // Refresh emissions with new config
      calculateSiteEmissions(siteId, 168).then(setEmissions).catch(() => {});
      setTimeout(() => setSaveMsg(null), 2500);
    } catch { setSaveMsg(t("siteConfig.panel.saveError", { defaultValue: "Save error" })); }
    finally { setSaving(false); }
  };

  const inp: React.CSSProperties = {
    padding: "0.4rem 0.6rem", borderRadius: "0.4rem",
    border: "1px solid rgba(148,163,184,0.3)",
    background: "rgba(15,23,42,0.8)", color: "var(--cei-text-main)",
    fontSize: "0.83rem", width: "100%",
  };

  const row = (label: string, content: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.5rem", alignItems: "center", marginBottom: "0.6rem" }}>
      <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>{label}</div>
      <div>{content}</div>
    </div>
  );

  const etsColor = emissions?.ets_surplus_deficit != null
    ? emissions.ets_surplus_deficit >= 0 ? "#22c55e" : "#ef4444"
    : "#94a3b8";

  const bmColor = emissions?.benchmark_gap_pct != null
    ? emissions.benchmark_gap_pct <= 0 ? "#22c55e" : "#f59e0b"
    : "#94a3b8";

  return (
    <section style={{ marginTop: "0.75rem" }}>
      {/* Emissions summary — always visible */}
      {emissions && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
          {/* tCO₂ card */}
          <div style={{ background: "radial-gradient(circle at top left,#0f172a,#020617)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: "0.75rem", padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.25rem" }}>CO₂ (7 giorni)</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#38bdf8" }}>{emissions.total_tco2.toFixed(2)}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)" }}>tCO₂ · {emissions.emission_factor_kg_co2_kwh} kg/kWh</div>
          </div>
          {/* Annualised */}
          <div style={{ background: "radial-gradient(circle at top left,#0f172a,#020617)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: "0.75rem", padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.25rem" }}>CO₂ proiettato/anno</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#38bdf8" }}>{emissions.annualised_tco2.toFixed(0)}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)" }}>tCO₂/anno · {emissions.framework}</div>
          </div>
          {/* ETS position */}
          <div style={{ background: "radial-gradient(circle at top left,#0f172a,#020617)", border: `1px solid ${etsColor}33`, borderRadius: "0.75rem", padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.25rem" }}>Posizione ETS</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: etsColor }}>
              {emissions.ets_surplus_deficit != null
                ? `${emissions.ets_surplus_deficit >= 0 ? "+" : ""}${emissions.ets_surplus_deficit.toFixed(1)} tCO₂`
                : "—"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)" }}>
              {emissions.ets_surplus_deficit != null
                ? emissions.ets_surplus_deficit >= 0 ? "Surplus — quota disponibile" : `Deficit — €${emissions.ets_credit_cost_eur?.toFixed(0)} est.`
                : "Configura quota ETS"}
            </div>
          </div>
          {/* Benchmark */}
          <div style={{ background: "radial-gradient(circle at top left,#0f172a,#020617)", border: `1px solid ${bmColor}33`, borderRadius: "0.75rem", padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.25rem" }}>vs Benchmark settore</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: bmColor }}>
              {emissions.benchmark_gap_pct != null ? `${emissions.benchmark_gap_pct > 0 ? "+" : ""}${emissions.benchmark_gap_pct.toFixed(1)}%` : "—"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)" }}>
              {emissions.benchmark_gap_pct != null
                ? emissions.benchmark_gap_pct <= 0 ? "Sotto benchmark ✓" : "Sopra benchmark"
                : emissions.sector_code ? "Configura produzione" : "Configura settore"}
            </div>
          </div>
          {/* EnPI */}
          {emissions.enpi_kwh_per_unit != null && (
            <div style={{ background: "radial-gradient(circle at top left,#0f172a,#020617)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: "0.75rem", padding: "0.85rem 1rem" }}>
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.25rem" }}>EnPI (ISO 50001)</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--cei-text-main)" }}>{emissions.enpi_kwh_per_unit.toFixed(1)}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)" }}>kWh per {emissions.production_unit ?? "unità"}</div>
            </div>
          )}
          {/* CBAM */}
          <div style={{ background: "radial-gradient(circle at top left,#0f172a,#020617)", border: `1px solid ${emissions.is_cbam_ready ? "#22c55e33" : "#f59e0b33"}`, borderRadius: "0.75rem", padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.25rem" }}>CBAM</div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: emissions.is_cbam_ready ? "#22c55e" : "#f59e0b" }}>
              {emissions.is_cbam_ready ? "✓ Pronto" : "⚠ Non pronto"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)" }}>
              {emissions.is_cbam_ready ? "Dati MRV sufficienti" : `${emissions.data_window_days}/30 giorni dati`}
            </div>
          </div>
        </div>
      )}

      {/* Config toggle */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "0.65rem 1rem",
          background: "radial-gradient(circle at top left,#0f172a,#020617)",
          border: "1px solid rgba(148,163,184,0.16)",
          borderRadius: open ? "0.75rem 0.75rem 0 0" : "0.75rem",
          cursor: "pointer", color: "var(--cei-text-muted)", fontSize: "0.85rem",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--cei-text-main)" }}>
          ⚙️ {t("siteConfig.panel.title", { defaultValue: "Plant Configuration (energy & emissions)" })}
        </span>
        <span style={{ fontSize: "0.75rem" }}>{open ? `▲ ${t("siteConfig.panel.close", { defaultValue: "Close" })}` : `▼ ${t("siteConfig.panel.configure", { defaultValue: "Configure" })}`}</span>
      </button>

      {open && (
        <div style={{
          border: "1px solid rgba(148,163,184,0.16)", borderTop: "none",
          borderRadius: "0 0 0.75rem 0.75rem", padding: "1.25rem",
          background: "radial-gradient(circle at top left,#0f172a,#020617)",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 2rem" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>
                {t("siteConfig.tariffs.title", { defaultValue: "Energy Tariffs" })}
              </div>
              {row(
                t("siteConfig.tariffs.country", { defaultValue: "Country (pre-fills estimated rates)" }),
                <select
                  style={inp}
                  value={countryHintKey}
                  onChange={e => handleCountryHintChange(e.target.value)}
                >
                  <option value="">{t("siteConfig.tariffs.selectCountry", { defaultValue: "— Select country for rate guidance —" })}</option>
                  {Object.entries(COUNTRY_TARIFF_HINTS).map(([code, { label }]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              )}
              {countryHintKey && COUNTRY_TARIFF_HINTS[countryHintKey] && (
                <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)", marginBottom: "0.5rem", paddingLeft: "0.25rem" }}>
                  {t("siteConfig.tariffs.estimatedRates", { defaultValue: "Estimated rates from" })} {COUNTRY_TARIFF_HINTS[countryHintKey].source} — {t("siteConfig.tariffs.updateWithActual", { defaultValue: "update with your actual contract tariff" })}
                </div>
              )}
              {row(
                t("siteConfig.tariffs.electricity", { defaultValue: "Electricity (per kWh)" }),
                <input style={inp} type="number" step="0.0001" min="0" value={form.electricity_price_per_kwh ?? ""} onChange={e => setForm(f => ({ ...f, electricity_price_per_kwh: e.target.value ? parseFloat(e.target.value) : null as any }))} placeholder="e.g. 0.23" />
              )}
              {row(
                t("siteConfig.tariffs.gas", { defaultValue: "Gas (per kWh)" }),
                <input style={inp} type="number" step="0.0001" min="0" value={form.gas_price_per_kwh ?? ""} onChange={e => setForm(f => ({ ...f, gas_price_per_kwh: e.target.value ? parseFloat(e.target.value) : null as any }))} placeholder="e.g. 0.08" />
              )}
              {row(
                t("siteConfig.tariffs.currency", { defaultValue: "Currency" }),
                <input style={{ ...inp, maxWidth: "80px" }} value={form.currency_code ?? ""} onChange={e => setForm(f => ({ ...f, currency_code: e.target.value }))} placeholder="EUR" maxLength={3} />
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>
                {t("siteConfig.emissions.title", { defaultValue: "Emissions Configuration" })}
              </div>
              {row("Paese", <input style={{ ...inp, maxWidth: "80px" }} value={form.country_code ?? ""} onChange={e => setForm(f => ({ ...f, country_code: e.target.value.toUpperCase() }))} placeholder="ITA" maxLength={3} />)}
              {row("Framework", (
                <select style={inp} value={form.framework ?? ""} onChange={e => setForm(f => ({ ...f, framework: e.target.value }))}>
                  <option value="">Seleziona...</option>
                  <option value="EU_ETS">EU ETS Phase 4</option>
                  <option value="CBAM">CBAM</option>
                  <option value="UK_ETS">UK ETS</option>
                  <option value="VCS">Verra VCS</option>
                  <option value="GOLD_STANDARD">Gold Standard</option>
                  <option value="ISO14064">ISO 14064</option>
                  <option value="CN_ETS">China ETS</option>
                  <option value="IN_PAT">India PAT</option>
                </select>
              ))}
              {row("Settore industriale", (
                <select style={inp} value={form.sector_code ?? ""} onChange={e => setForm(f => ({ ...f, sector_code: e.target.value }))}>
                  <option value="">Seleziona...</option>
                  <option value="ceramics">Ceramica</option>
                  <option value="cement">Cemento</option>
                  <option value="steel">Acciaio</option>
                  <option value="glass">Vetro</option>
                  <option value="chemicals">Chimica</option>
                  <option value="food">Alimentare</option>
                  <option value="paper">Carta</option>
                  <option value="aluminium">Alluminio</option>
                  <option value="manufacturing">Manifattura generica</option>
                </select>
              ))}
              {row("Fonte energia primaria", (
                <select style={inp} value={form.primary_energy_source ?? ""} onChange={e => setForm(f => ({ ...f, primary_energy_source: e.target.value }))}>
                  <option value="">Seleziona...</option>
                  <option value="electricity">Elettricità</option>
                  <option value="natural_gas">Gas naturale</option>
                  <option value="lpg">GPL</option>
                  <option value="diesel">Diesel</option>
                  <option value="biomass">Biomassa</option>
                </select>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(148,163,184,0.1)", margin: "1rem 0" }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 2rem" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>Produzione (per EnPI)</div>
              {row("Volume produzione/anno", <input style={inp} type="number" min="0" value={form.annual_production_volume ?? ""} onChange={e => setForm(f => ({ ...f, annual_production_volume: e.target.value ? parseFloat(e.target.value) : null as any }))} placeholder="es. 5000" />)}
              {row("Unità di misura", <input style={inp} value={form.production_unit ?? ""} onChange={e => setForm(f => ({ ...f, production_unit: e.target.value }))} placeholder="tonne / m2 / unità" />)}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>ETS / Quota</div>
              {row("Quote gratuite ETS (tCO₂/anno)", <input style={inp} type="number" min="0" value={form.free_allocation_tonnes ?? ""} onChange={e => setForm(f => ({ ...f, free_allocation_tonnes: e.target.value ? parseFloat(e.target.value) : null as any }))} placeholder="es. 500" />)}
              {row("Anno di riferimento", <input style={inp} type="number" min="2020" max="2030" value={form.reporting_year ?? ""} onChange={e => setForm(f => ({ ...f, reporting_year: e.target.value ? parseInt(e.target.value) : null as any }))} placeholder="2026" />)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "1rem", marginTop: "1rem" }}>
            {saveMsg && <span style={{ fontSize: "0.82rem", color: saveMsg.startsWith("✓") ? "#22c55e" : "#ef4444" }}>{saveMsg}</span>}
            <button
              type="button"
              className="cei-btn"
              onClick={handleSave}
              disabled={saving}
              style={{ fontSize: "0.82rem", padding: "0.4rem 1.1rem" }}
            >
              {saving ? "Salvataggio…" : "Salva configurazione"}
            </button>
          </div>

          {config?.config_updated_at && (
            <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)", marginTop: "0.5rem", textAlign: "right" }}>
              Ultimo aggiornamento: {new Date(config.config_updated_at).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function buildSiteEfficiencySuggestions(
  t: (key: string, opts?: any) => string,
  totalKwh: number | null,
  points: number | null,
  siteName: string | null
): string[] {
  const name = siteName || t("siteView.suggestions.thisSite", { defaultValue: "this site" });

  if (points === null || points === 0) {
    return [
      t("siteView.suggestions.noData.1", {
        defaultValue:
          "Confirm that uploads for {{name}} either (a) include a consistent site_id column, or (b) are sent via the “Upload CSV for this site” button so CEI can route rows automatically.",
        name,
      }),
      t("siteView.suggestions.noData.2", {
        defaultValue:
          "Check that timestamps for this site actually land in the last 24 hours – older backfills won’t drive this view.",
      }),
      t("siteView.suggestions.noData.3", {
        defaultValue:
          "Start with one or two key meters for this site (e.g. main incomer, compressors) and validate that their profiles look realistic.",
      }),
    ];
  }

  const suggestions: string[] = [];

  if (totalKwh !== null) {
    if (totalKwh > 1000) {
      suggestions.push(
        t("siteView.suggestions.high.1", {
          defaultValue:
            "Identify which hours at {{name}} show the highest kWh and coordinate with production to move non-critical loads away from those peaks.",
          name,
        }),
        t("siteView.suggestions.high.2", {
          defaultValue:
            "Review night and weekend consumption at {{name}} – look for lines, compressors, or HVAC that stay energized with no production.",
          name,
        }),
        t("siteView.suggestions.high.3", {
          defaultValue:
            "Compare today’s kWh profile for {{name}} with a “good” reference day to spot abnormal peaks or extended high-load periods.",
          name,
        })
      );
    } else if (totalKwh > 300) {
      suggestions.push(
        t("siteView.suggestions.medium.1", {
          defaultValue:
            "Check whether batch processes at {{name}} are overlapping more than necessary and see if start times can be staggered.",
          name,
        }),
        t("siteView.suggestions.medium.2", {
          defaultValue:
            "Look for a flat, elevated overnight baseline at {{name}}; that often hides idle losses from utilities and auxiliary equipment.",
          name,
        }),
        t("siteView.suggestions.medium.3", {
          defaultValue:
            "Use CEI to mark any operational changes at {{name}} (setpoint shifts, maintenance) and compare before/after daily kWh.",
          name,
        })
      );
    } else {
      suggestions.push(
        t("siteView.suggestions.low.1", {
          defaultValue:
            "{{name}} is running with relatively modest daily energy use. Focus on preventing creeping standby losses over the next weeks.",
          name,
        }),
        t("siteView.suggestions.low.2", {
          defaultValue:
            "Use this site as a low-risk sandbox: test small changes (lighting, idle modes, scheduling) and capture the before/after impact.",
        })
      );
    }
  }

  suggestions.push(
    t("siteView.suggestions.common.1", {
      defaultValue:
        "Work with the local team at {{name}} to tag meters by process (e.g. \"compressors\", \"HVAC\", \"ovens\") so future analytics can surface process-level waste.",
      name,
    }),
    t("siteView.suggestions.common.2", {
      defaultValue:
        "Add a quick weekly stand-up for {{name}} where you review this page with operations and agree on one concrete action item.",
      name,
    }),
    t("siteView.suggestions.common.3", {
      defaultValue:
        "Capture photos or notes of any physical changes you make (insulation, setpoints, shutdown procedures) so savings are auditable, not just anecdotal.",
    })
  );

  return suggestions;
}

export default SiteView;
