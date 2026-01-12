// frontend/src/pages/SiteView.tsx

import React, { useEffect, useMemo, useState } from "react";
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
  getManualOpportunities,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import type { SiteInsights, SiteForecast } from "../types/api";
import type { SiteKpi } from "../services/api";
import { buildHybridNarrative } from "../utils/hybridNarrative";
import SiteAlertsStrip from "../components/SiteAlertsStrip";
import { downloadCsv } from "../utils/csv";
import SiteTimelineCard from "../components/SiteTimelineCard";

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

type BackendOpportunity = {
  id: number;
  name: string;
  description?: string | null;
  est_annual_kwh_saved?: number | null;
  est_capex_eur?: number | null;
  simple_roi_years?: number | null;
  est_co2_tons_saved_per_year?: number | null;
  source?: "auto" | "manual" | string;
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
  // and we don't want to lose it by replacing with raw backend detail.
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

const isFiniteNumber = (v: any): v is number =>
  typeof v === "number" && Number.isFinite(v);

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

const SiteView: React.FC = () => {
  const { t } = useTranslation();

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [site, setSite] = useState<SiteRecord | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);

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

  const [opportunities, setOpportunities] = useState<BackendOpportunity[]>([]);
  const [oppsLoading, setOppsLoading] = useState(false);
  const [oppsError, setOppsError] = useState<string | null>(null);

  const [manualOppForm, setManualOppForm] = useState<ManualOpportunityFormState>({
    name: "",
    description: "",
  });
  const [manualOppSaving, setManualOppSaving] = useState(false);
  const [manualOppError, setManualOppError] = useState<string | null>(null);
  const [actionSavingId, setActionSavingId] = useState<number | null>(null);
  const [actionNoteById, setActionNoteById] = useState<Record<number, string>>({});


  const siteKey = id ? `site-${id}` : undefined;

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
      horizon_hours: 24,
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
      .then((data: any) => {
        if (!isMounted) return;

        let raw: unknown;
        if (Array.isArray(data)) {
          raw = data;
        } else {
          raw = (data as any)?.opportunities;
        }

        const list: BackendOpportunity[] = Array.isArray(raw)
          ? (raw as BackendOpportunity[])
          : [];

        setOpportunities(list);
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

    // Manual opportunities list (numeric id)
    getManualOpportunities(id)
      .then((rows) => {
        if (!isMounted) return;
        if (Array.isArray(rows)) {
          const mapped: BackendOpportunity[] = rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            source: "manual",
          }));
          setOpportunities((prev) => [...mapped, ...prev]);
        }
      })
      .catch(() => {
        // non-fatal; we already surface error from unified endpoint
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
  const deviationPct =
    typeof insights?.deviation_pct === "number" ? insights.deviation_pct : null;
  const insightWindowHours =
    typeof insights?.window_hours === "number" ? insights.window_hours : 24;
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

    const handleMarkOpportunityActioned = async (opp: BackendOpportunity) => {
      if (!siteKey) return;

      const note = (actionNoteById[opp.id] || "").trim();

      setActionSavingId(opp.id);
      try {
        await createSiteEvent(siteKey, {
          type: "action_taken",
          title: `Action taken: ${opp.name}`,
          body: [
            `Opportunity ID: ${opp.id}`,
            `Source: ${opp.source || "auto"}`,
            opp.est_annual_kwh_saved != null ? `Est kWh/yr saved: ${opp.est_annual_kwh_saved}` : null,
            opp.simple_roi_years != null ? `Simple ROI (yrs): ${opp.simple_roi_years}` : null,
            note ? `Operator note: ${note}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        });

        // Clear note and refresh timeline
        setActionNoteById((prev) => {
          const next = { ...prev };
          delete next[opp.id];
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
        setActionSavingId(null);
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
      typeof kpiAny.currency_code === "string" && kpiAny.currency_code
        ? kpiAny.currency_code
        : "EUR";

    const pricePerKwh =
      typeof kpiAny.electricity_price_per_kwh === "number"
        ? kpiAny.electricity_price_per_kwh
        : null;

    const pricePerMwh =
      pricePerKwh !== null && Number.isFinite(pricePerKwh)
        ? pricePerKwh * 1000
        : null;

    const primarySources =
      Array.isArray(kpiAny.primary_energy_sources) &&
      kpiAny.primary_energy_sources.length > 0
        ? kpiAny.primary_energy_sources.join(" + ")
        : "";

    const fmt = (val: number | null | undefined, digits: number = 2): string =>
      typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "";

    // Be tolerant to backend naming differences (older vs newer fields)
    const cost24hActual = pickNumber(kpiAny, [
      "cost_24h_actual",
      "last_24h_cost",
      "actual_cost_24h",
    ]);
    const cost24hBaseline = pickNumber(kpiAny, [
      "cost_24h_baseline",
      "baseline_24h_cost",
      "expected_cost_24h",
    ]);
    const cost24hDelta =
      pickNumber(kpiAny, ["cost_24h_delta", "delta_24h_cost", "cost_delta_24h"]) ??
      (cost24hActual != null && cost24hBaseline != null
        ? cost24hActual - cost24hBaseline
        : null);

    const cost7dActual = pickNumber(kpiAny, [
      "cost_7d_actual",
      "last_7d_cost",
      "actual_cost_7d",
    ]);
    const cost7dBaseline = pickNumber(kpiAny, [
      "cost_7d_baseline",
      "baseline_7d_cost",
      "expected_cost_7d",
    ]);
    const cost7dDelta =
      pickNumber(kpiAny, ["cost_7d_delta", "delta_7d_cost", "cost_delta_7d"]) ??
      (cost7dActual != null && cost7dBaseline != null
        ? cost7dActual - cost7dBaseline
        : null);

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
        defaultValue:
          "This will permanently delete this site and its associated data in CEI. Are you sure?",
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
      opp: BackendOpportunity,
      electricityPricePerKwh: number | null
    ): number | null => {
      if (!isFiniteNumber(electricityPricePerKwh)) return null;
      const kwh = opp.est_annual_kwh_saved;
      if (!isFiniteNumber(kwh) || kwh <= 0) return null;
      return kwh * electricityPricePerKwh;
    };

    const sortOpportunitiesDecisionReady = (
      list: BackendOpportunity[],
      electricityPricePerKwh: number | null
    ): BackendOpportunity[] => {
      const scored = list.map((o) => {
        const eurYr = computeEstimatedEurPerYear(o, electricityPricePerKwh);
        const kwhYr = isFiniteNumber(o.est_annual_kwh_saved) ? o.est_annual_kwh_saved : null;
        const roi = isFiniteNumber(o.simple_roi_years) ? o.simple_roi_years : null;

        // Decision-ready scoring:
        // 1) highest €/yr first (if computable)
        // 2) else highest kWh/yr
        // 3) else lowest ROI years
        // 4) else keep stable
        const score =
          (eurYr != null ? eurYr * 1_000_000 : 0) +
          (eurYr == null && kwhYr != null ? kwhYr * 1_000 : 0) +
          (eurYr == null && kwhYr == null && roi != null ? (1 / Math.max(roi, 0.1)) : 0);

        return { o, eurYr, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.map((x) => x.o);
    };


  // --- Cost KPI wiring (robust to backend field naming) ---
  const kpiAny = kpi as any;

  const kpiCurrencyCode =
    (kpiAny?.currency_code as string | null | undefined) ?? null;
  const electricityPricePerKwh = pickNumber(kpiAny, ["electricity_price_per_kwh"]);

  const cost24hActual = useMemo(
    () => pickNumber(kpiAny, ["cost_24h_actual", "last_24h_cost", "actual_cost_24h"]),
    [kpiAny]
  );
  const cost24hBaseline = useMemo(
    () =>
      pickNumber(kpiAny, ["cost_24h_baseline", "baseline_24h_cost", "expected_cost_24h"]),
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
    electricityPricePerKwh != null ||
    cost24hActual != null ||
    cost24hBaseline != null ||
    cost24hDelta != null;

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
    if (forecastLoading) {
      return (
        <section className="cei-card">
          <div className="cei-card-header">
            <h2 style={{ fontSize: "0.95rem", fontWeight: 600 }}>
              {t("siteView.forecast.title", { defaultValue: "Next 24h forecast" })}
            </h2>
            <span className="cei-pill cei-pill-neutral cei-pill--sm">
              {t("common.loading", { defaultValue: "Loading" })}
            </span>
          </div>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {t("siteView.forecast.building", {
              defaultValue: "Building a baseline-driven forecast for this site…",
            })}
          </p>
        </section>
      );
    }

    if (!hasForecast || forecastError) {
      return null;
    }

    const localForecast = forecast as SiteForecast;
    const points = Array.isArray(localForecast.points) ? localForecast.points : [];
    if (points.length === 0) return null;

    const totalExpected = points.reduce((sum, p) => sum + (p.expected_kwh ?? 0), 0);
    const peak = points.reduce((max, p) =>
      (p.expected_kwh ?? 0) > (max.expected_kwh ?? 0) ? p : max
    );

    const forecastTrendPoints = points.map((p) => {
      const dt = new Date(p.ts);
      const label = dt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return { label, value: p.expected_kwh ?? 0 };
    });

    const forecastValues = forecastTrendPoints.map((p) => p.value);
    const hasForecastTrend = forecastValues.length > 0;
    const forecastMax = hasForecastTrend ? Math.max(...forecastValues) : 0;
    const forecastMin = hasForecastTrend ? Math.min(...forecastValues) : 0;

    const forecastChartContentWidth = hasForecastTrend
      ? Math.max(forecastTrendPoints.length * barPixelWidth, minContentWidth)
      : minContentWidth;

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
            <p
              style={{
                marginTop: "0.1rem",
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
              }}
            >
              {t("siteView.forecast.subtitle", {
                defaultValue:
                  "Baseline-driven preview of expected energy over the next 24 hours.",
              })}
            </p>
          </div>
          <span
            className="cei-pill cei-pill-neutral"
            style={{
              fontSize: "0.65rem",
              padding: "0.15rem 0.5rem",
              lineHeight: 1,
              whiteSpace: "nowrap",
              maxWidth: "14rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={`Stub: ${localForecast.method}`}
          >
            {t("siteView.forecast.stub", {
              defaultValue: "Stub: {{method}}",
              method: localForecast.method,
            })}
          </span>

        </div>

        <div
          className="cei-card-kpis"
          style={{
            marginTop: "0.7rem",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
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

        <div
          className="cei-trend-scroll"
          style={{
            marginTop: "0.8rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(148, 163, 184, 0.5)",
            background:
              "radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), rgba(15, 23, 42, 0.95))",
            padding: "0.75rem",
            boxSizing: "border-box",
            maxWidth: "100%",
            overflowX: "auto",
            overflowY: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-start",
              gap: "0.5rem",
              height: "200px",
              width: `${forecastChartContentWidth}px`,
              boxSizing: "border-box",
            }}
          >
            {forecastTrendPoints.map((p, idx) => {
              const val = p.value;

              let heightPx = 0;
              if (hasForecastTrend && forecastMax > 0) {
                if (forecastMax > forecastMin) {
                  const ratio = (val - forecastMin) / (forecastMax - forecastMin || 1);
                  heightPx = baseBarHeightPx + ratio * maxBarHeightPx;
                } else {
                  heightPx = baseBarHeightPx + maxBarHeightPx;
                }
              }

              return (
                <div
                  key={`${idx}-${p.label}`}
                  style={{
                    flex: "0 0 auto",
                    width: "32px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "0.25rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.6rem",
                      color: "var(--cei-text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {val.toFixed(0)}
                  </span>
                  <div
                    style={{
                      width: "100%",
                      borderRadius: "4px",
                      background:
                        "linear-gradient(to top, rgba(56, 189, 248, 0.95), rgba(56, 189, 248, 0.25))",
                      height: `${heightPx}px`,
                      boxShadow: "0 6px 18px rgba(56, 189, 248, 0.45)",
                      border: "1px solid rgba(226, 232, 240, 0.8)",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "0.65rem",
                      color: "var(--cei-text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <p
          style={{
            marginTop: "0.8rem",
            fontSize: "0.75rem",
            color: "var(--cei-text-muted)",
          }}
        >
          {t("siteView.forecast.footer", {
            defaultValue:
              "Based on a {{lookback}}-day baseline and a {{history}}-hour recent performance window. Use this strip as a forward-looking mirror of the last 24h trend chart above.",
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

      setOpportunities((prev) => [
        {
          id: created.id,
          name: created.name,
          description: created.description,
          source: "manual",
        },
        ...prev,
      ]);

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
            <Link to="/sites" style={{ color: "var(--cei-text-accent)" }}>
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
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {t("siteView.header.subtitle", {
              defaultValue:
                "Per-site performance view. Energy metrics are filtered by",
            })}{" "}
            <code>site_id = {siteKey ?? "?"}</code>{" "}
            {t("siteView.header.subtitleTail", {
              defaultValue: "in the timeseries table.",
            })}
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
                {t("siteView.kpis.energy24h.bodyA", {
                  defaultValue: "Aggregated from",
                })}{" "}
                <strong>
                  {summary!.points.toLocaleString()}{" "}
                  {t("siteView.kpis.energy24h.readings", { defaultValue: "readings" })}
                </strong>{" "}
                {t("siteView.kpis.energy24h.bodyB", {
                  defaultValue: "in the last",
                })}{" "}
                {summary!.window_hours}{" "}
                {t("siteView.kpis.energy24h.hours", { defaultValue: "hours" })}{" "}
                {t("siteView.kpis.energy24h.bodyC", { defaultValue: "for this site." })}
              </>
            ) : summaryLoading ? (
              t("siteView.kpis.energy24h.loading", {
                defaultValue: "Loading per-site energy data…",
              })
            ) : (
              <>
                {t("siteView.kpis.energy24h.noDataA", {
                  defaultValue: "No recent data for this site. Either ensure your uploaded timeseries includes",
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
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.4rem",
              fontWeight: 600,
            }}
          >
            {hasSummaryData ? summary!.points.toLocaleString() : "—"}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
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
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.2rem",
              fontWeight: 600,
            }}
          >
            {hasSummaryData
              ? t("siteView.kpis.status.active", { defaultValue: "Active" })
              : t("siteView.kpis.status.noRecentData", { defaultValue: "No recent data" })}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
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
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
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
                    defaultValue: "Configure tariffs under Settings to enable € KPIs.",
                  })}
                >
                  {t("siteView.snapshot.noTariffs", {
                    defaultValue: "No tariffs configured – showing kWh only",
                  })}
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
                <div>
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
                    <span className={`cei-pill ${kpiDeltaBadgeClass(kpi.deviation_pct_24h)}`}>
                      {formatPct(kpi.deviation_pct_24h)}{" "}
                      {t("siteView.snapshot.vsBaseline", { defaultValue: "vs baseline" })}
                    </span>
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--cei-text-muted)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {t("siteView.snapshot.last7dVsPrev7d", {
                      defaultValue: "Last 7 days vs previous 7 days",
                    })}
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
                    <span className={`cei-pill ${kpiDeltaBadgeClass(kpi.deviation_pct_7d)}`}>
                      {formatPct(kpi.deviation_pct_7d)}{" "}
                      {t("siteView.snapshot.vsPrev7d", { defaultValue: "vs previous 7d" })}
                    </span>
                  </div>
                </div>

                <div>
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
              <div
                style={{
                  marginTop: "0.9rem",
                  paddingTop: "0.75rem",
                  borderTop: "1px solid var(--cei-border-subtle)",
                }}
              >
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
                          {costDirectionLabel !==
                            t("siteView.cost.onBaseline", { defaultValue: "On baseline" }) &&
                          costDirectionLabel !==
                            t("siteView.cost.directionUnknown", {
                              defaultValue: "Savings / overspend vs baseline",
                            }) ? (
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
                        "Cost analytics for this site will light up once tariffs are configured for your organization. You can review these under Account & Settings.",
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Trend + metadata */}
      <section className="dashboard-main-grid">
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
                {t("siteView.trend.subtitle", {
                  defaultValue: "Per-site series aggregated by hour. Uses",
                })}{" "}
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
                disabled={
                  seriesLoading || !series || !Array.isArray(series.points) || series.points.length === 0
                }
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
              >
                {seriesLoading
                  ? t("siteView.export.preparing", { defaultValue: "Preparing…" })
                  : t("siteView.export.downloadCsv", { defaultValue: "Download CSV" })}
              </button>
            </div>
          </div>

          {seriesLoading && (
            <div style={{ padding: "1.2rem 0.5rem", display: "flex", justifyContent: "center" }}>
              <LoadingSpinner />
            </div>
          )}

          {!seriesLoading && !hasTrend ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("siteView.trend.noData", {
                defaultValue:
                  "No recent per-site series data. Once your timeseries has matching site_id, or you upload via “Upload CSV for this site” with no site_id column, this chart will light up.",
              })}{" "}
              <code>site_id = {siteKey}</code>.
            </div>
          ) : (
            hasTrend && (
              <>
                <div
                  className="cei-trend-scroll"
                  style={{
                    marginTop: "0.75rem",
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(148, 163, 184, 0.5)",
                    background:
                      "radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), rgba(15, 23, 42, 0.95))",
                    padding: "0.75rem",
                    boxSizing: "border-box",
                    maxWidth: "100%",
                    overflowX: "auto",
                    overflowY: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "flex-start",
                      gap: "0.5rem",
                      height: "200px",
                      width: `${chartContentWidth}px`,
                      boxSizing: "border-box",
                    }}
                  >
                    {trendPoints.map((p, idx) => {
                      const val = p.value;

                      let heightPx = 0;
                      if (hasTrend && maxVal > 0) {
                        if (maxVal > minVal) {
                          const ratio = (val - minVal) / (maxVal - minVal || 1);
                          heightPx = baseBarHeightPx + ratio * maxBarHeightPx;
                        } else {
                          heightPx = baseBarHeightPx + maxBarHeightPx;
                        }
                      }

                      return (
                        <div
                          key={`${idx}-${p.label}`}
                          style={{
                            flex: "0 0 auto",
                            width: "32px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: "0.25rem",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.6rem",
                              color: "var(--cei-text-muted)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {val.toFixed(0)}
                          </span>
                          <div
                            style={{
                              width: "100%",
                              borderRadius: "4px",
                              background:
                                "linear-gradient(to top, rgba(56, 189, 248, 0.95), rgba(56, 189, 248, 0.25))",
                              height: `${heightPx}px`,
                              boxShadow: "0 6px 18px rgba(56, 189, 248, 0.45)",
                              border: "1px solid rgba(226, 232, 240, 0.8)",
                            }}
                          />
                          <span
                            style={{
                              fontSize: "0.65rem",
                              color: "var(--cei-text-muted)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {p.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {trendSummary && (
                  <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                    {trendSummary}
                  </div>
                )}
              </>
            )
          )}
        </div>

        <div className="cei-card">
          <div style={{ marginBottom: "0.6rem" }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
              {t("siteView.metaCard.title", { defaultValue: "Site metadata" })}
            </div>
            <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("siteView.metaCard.subtitle", {
                defaultValue:
                  "Basic descriptive information for this site. We'll extend this with tags, baseline, and other fields later.",
              })}
            </div>
          </div>

          {siteLoading && (
            <div style={{ padding: "1.2rem 0.5rem", display: "flex", justifyContent: "center" }}>
              <LoadingSpinner />
            </div>
          )}

          {!siteLoading && site && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                rowGap: "0.4rem",
                fontSize: "0.85rem",
              }}
            >
              <div>
                <span style={{ color: "var(--cei-text-muted)" }}>
                  {t("siteView.metaCard.name", { defaultValue: "Name:" })}
                </span>{" "}
                <span>{site.name}</span>
              </div>
              <div>
                <span style={{ color: "var(--cei-text-muted)" }}>
                  {t("siteView.metaCard.location", { defaultValue: "Location:" })}
                </span>{" "}
                <span>{site.location || "—"}</span>
              </div>
              <div>
                <span style={{ color: "var(--cei-text-muted)" }}>
                  {t("siteView.metaCard.internalId", { defaultValue: "Internal ID:" })}
                </span>{" "}
                <span>{site.id}</span>
              </div>
            </div>
          )}

          {!siteLoading && !site && !siteError && (
            <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
              {t("siteView.metaCard.notFound", { defaultValue: "Site not found." })}
            </div>
          )}
        </div>
      </section>

      {siteKey && (
        <section style={{ marginTop: "0.75rem" }}>
          <SiteAlertsStrip siteKey={siteKey} limit={3} />
        </section>
      )}

      {siteKey && (
        <section style={{ marginTop: "0.75rem" }}>
          <div className="dashboard-main-grid">
            <div className="cei-card">
              <div className="cei-card-header">
                <div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                    {t("siteView.notes.title", { defaultValue: "Add site note" })}
                  </div>
                  <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                    {t("siteView.notes.subtitle", {
                      defaultValue:
                        "Log operational changes, decisions, or observations. These events populate the activity timeline for this site.",
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
                    placeholder={t("siteView.notes.titlePlaceholder", {
                      defaultValue: "Short title (optional)",
                    })}
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
                      defaultValue:
                        "What changed at this site? E.g. 'HVAC schedule updated', 'Line 2 on reduced shift', 'Night audit performed'.",
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
        </section>
      )}

      {/* Forecast card */}
      <section style={{ marginTop: "0.75rem" }}>{renderForecastCard()}</section>

      {/* CEI hybrid view */}
      {hybrid && (
        <section style={{ marginTop: "0.75rem" }}>
          <div className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              {t("siteView.hybrid.title", { defaultValue: "CEI hybrid view" })}
            </div>
            <div style={{ marginTop: "0.3rem", fontSize: "0.9rem", fontWeight: 600 }}>{hybrid.headline}</div>
            <ul
              style={{
                marginTop: "0.5rem",
                paddingLeft: "1.1rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
                lineHeight: 1.6,
              }}
            >
              {hybrid.bullets.map((b, idx) => (
                <li key={idx}>{b}</li>
              ))}
            </ul>
          </div>
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
                    deviationPct !== null
                      ? `${deviationPct >= 0 ? "+" : ""}${deviationPct.toFixed(1)}%`
                      : "—",
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
              <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--cei-text-main)" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
                  {t("siteView.opps.modelledMeasures", { defaultValue: "Modelled measures for this site" })}
                </div>
                <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", lineHeight: 1.5 }}>
                  {decisionReadyOpps.map((o, idx) => {
                    const roiYears = typeof o.simple_roi_years === "number" ? o.simple_roi_years : null;
                    const savingsKwhYr = typeof o.est_annual_kwh_saved === "number" ? o.est_annual_kwh_saved : null;
                    const co2 =
                      typeof o.est_co2_tons_saved_per_year === "number" ? o.est_co2_tons_saved_per_year : null;

                    const eurYr = computeEstimatedEurPerYear(o, electricityPricePerKwh ?? null);

                    return (
                      <li key={`${o.source || "auto"}-${o.id}-${idx}`} style={{ marginBottom: "0.55rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                          <div style={{ minWidth: 0 }}>
                            <strong>
                              {o.source === "manual"
                                ? t("siteView.opps.manualTag", { defaultValue: "[Manual] " })
                                : ""}
                              {o.name}
                            </strong>
                            {o.description ? ` – ${o.description}` : ""}

                            <span style={{ display: "block", fontSize: "0.78rem", marginTop: "0.15rem" }}>
                              {eurYr != null && (
                                <>
                                  ≈{" "}
                                  <strong>{formatCurrency(eurYr, kpiCurrencyCode)}</strong>{" "}
                                  {t("siteView.opps.perYear", { defaultValue: "/ year" })}
                                </>
                              )}

                              {eurYr == null && savingsKwhYr != null && (
                                <>
                                  ≈{" "}
                                  <strong>
                                    {savingsKwhYr.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh/yr
                                  </strong>{" "}
                                  {t("siteView.opps.saved", { defaultValue: "saved" })}
                                </>
                              )}

                              {roiYears != null && (
                                <>
                                  {" "}
                                  · {t("siteView.opps.roi", { defaultValue: "simple ROI" })} ~{" "}
                                  <strong>{roiYears.toFixed(1)} yrs</strong>
                                </>
                              )}

                              {co2 != null && (
                                <>
                                  {" "}
                                  · {t("siteView.opps.co2Cut", { defaultValue: "CO₂ cut" })} ~{" "}
                                  <strong>{co2.toFixed(2)} tCO₂/yr</strong>
                                </>
                              )}
                            </span>

                            <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                              <input
                                type="text"
                                value={actionNoteById[o.id] || ""}
                                onChange={(e) =>
                                  setActionNoteById((prev) => ({ ...prev, [o.id]: e.target.value }))
                                }
                                placeholder={t("siteView.opps.actionNotePlaceholder", {
                                  defaultValue: "Optional note (who/when/what changed)…",
                                })}
                                style={{
                                  flex: "1 1 280px",
                                  minWidth: 220,
                                  padding: "0.45rem 0.6rem",
                                  borderRadius: "0.5rem",
                                  border: "1px solid rgba(148, 163, 184, 0.5)",
                                  backgroundColor: "rgba(15,23,42,0.9)",
                                  color: "var(--cei-text-main)",
                                  fontSize: "0.82rem",
                                }}
                              />

                              <button
                                type="button"
                                className="cei-btn cei-btn-primary"
                                onClick={() => handleMarkOpportunityActioned(o)}
                                disabled={actionSavingId === o.id}
                                style={{ fontSize: "0.78rem", padding: "0.35rem 0.85rem" }}
                                title={t("siteView.opps.markActionedTooltip", {
                                  defaultValue: "Logs an action event into the site timeline for auditability.",
                                })}
                              >
                                {actionSavingId === o.id
                                  ? t("common.savingEllipsis", { defaultValue: "Saving…" })
                                  : t("siteView.opps.markActioned", { defaultValue: "Mark as actioned" })}
                              </button>
                            </div>
                          </div>

                          <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                            <span className="cei-pill cei-pill-neutral" style={{ fontSize: "0.7rem" }}>
                              {t("siteView.opps.rank", { defaultValue: "Rank #{{n}}" , n: idx + 1 })}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}

                </ul>
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
    </div>
  );
};

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
