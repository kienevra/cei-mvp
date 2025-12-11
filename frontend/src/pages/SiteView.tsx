// frontend/src/pages/SiteView.tsx

import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
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
  const detail = e?.response?.data?.detail;

  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => d?.msg || JSON.stringify(d))
      .join(" | ");
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

  if (e?.message && typeof e.message === "string") {
    return e.message;
  }

  return fallback;
};

const SiteView: React.FC = () => {
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
        setSiteError(e?.message || "Failed to load site.");
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
        setSummaryError(e?.message || "Failed to load energy summary.");
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
        setSeriesError(e?.message || "Failed to load energy trend.");
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
        // If backend ever 404s for "no baseline yet", we could special-case:
        // if (e?.response?.status === 404) { setInsights(null); return; }
        setInsightsError(
          normalizeApiError(e, "Failed to load analytics insights.")
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
        setForecastError(e?.message || "Unable to load forecast right now.");
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
          normalizeApiError(e, "Failed to load opportunity suggestions.")
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
  }, [id, siteKey]);

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
          normalizeApiError(e, "Unable to load KPI comparison.")
        );
      })
      .finally(() => {
        if (cancelled) return;
        setKpiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [siteKey]);

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

    trendSummary = `Peak hour at this site: ${peakLabel} with ${maxVal.toFixed(
      1
    )} kWh · Average: ${avgVal.toFixed(
      1
    )} kWh/h over ${windowHours.toFixed(
      0
    )} hours · Min hourly: ${minVal.toFixed(1)} kWh/h.`;
  }

  const anyError = siteError || summaryError || seriesError || insightsError;

  const suggestions = buildSiteEfficiencySuggestions(
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
      alert("No timeseries data available to export yet.");
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

  const handleExportKpiCsv = () => {
    if (!siteKey) {
      alert("Missing site identifier; cannot export KPI CSV yet.");
      return;
    }
    if (!kpi) {
      alert("No KPI data available to export yet.");
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

    const fmt = (
      val: number | null | undefined,
      digits: number = 2
    ): string =>
      typeof val === "number" && Number.isFinite(val)
        ? val.toFixed(digits)
        : "";

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
      cost_24h_actual: fmt(kpiAny.cost_24h_actual),
      cost_24h_baseline: fmt(kpiAny.cost_24h_baseline),
      cost_24h_delta: fmt(kpiAny.cost_24h_delta),

      // 7d energy vs previous 7d
      last_7d_kwh: fmt(kpi.last_7d_kwh),
      prev_7d_kwh: fmt(kpi.prev_7d_kwh),
      deviation_pct_7d: fmt(kpi.deviation_pct_7d),

      // 7d cost KPIs
      cost_7d_actual: fmt(kpiAny.cost_7d_actual),
      cost_7d_baseline: fmt(kpiAny.cost_7d_baseline),
      cost_7d_delta: fmt(kpiAny.cost_7d_delta),

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
      "This will permanently delete this site and its associated data in CEI. Are you sure?"
    );
    if (!confirmed) return;

    try {
      await deleteSite(id);
      alert("Site deleted.");
      navigate("/sites");
    } catch (e: any) {
      console.error("Failed to delete site", e);
      alert(
        e?.response?.data?.detail ||
          "Failed to delete site. Please try again or check logs."
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
    if (value > 10) return "cei-pill-bad";
    if (value > 2) return "cei-pill-watch";
    if (value < -10) return "cei-pill-good";
    return "cei-pill-neutral";
  };

  const formatCurrency = (
    value: number | null | undefined,
    currencyCode: string | null | undefined
  ): string => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "—";
    }
    const safeCode = currencyCode || "EUR";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: safeCode,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${safeCode} ${value.toFixed(2)}`;
    }
  };

  // Derived cost KPIs from SiteKpi (optional, tariff-dependent)
  const kpiCurrencyCode = (kpi as any)?.currency_code ?? null;
  const last24hCost = (kpi as any)?.last_24h_cost ?? null;
  const baseline24hCost = (kpi as any)?.baseline_24h_cost ?? null;
  const delta24hCostRaw = (kpi as any)?.delta_24h_cost ?? null;

  let inferredDeltaCost: number | null = delta24hCostRaw;
  if (
    inferredDeltaCost == null &&
    last24hCost != null &&
    baseline24hCost != null
  ) {
    inferredDeltaCost = last24hCost - baseline24hCost;
  }

  const hasCostKpi =
    last24hCost != null || baseline24hCost != null || inferredDeltaCost != null;

  const costDirectionLabel: string =
    inferredDeltaCost == null
      ? "Savings / overspend vs baseline"
      : inferredDeltaCost < 0
      ? "Savings vs baseline"
      : inferredDeltaCost > 0
      ? "Overspend vs baseline"
      : "On baseline";

  const costDeltaAbs = inferredDeltaCost != null ? Math.abs(inferredDeltaCost) : null;

  const renderForecastCard = () => {
    if (forecastLoading) {
      return (
        <section className="cei-card">
          <div className="cei-card-header">
            <h2 style={{ fontSize: "0.95rem", fontWeight: 600 }}>
              Next 24h forecast
            </h2>
            <span className="cei-pill cei-pill-neutral">Loading</span>
          </div>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Building a baseline-driven forecast for this site…
          </p>
        </section>
      );
    }

    if (!hasForecast || forecastError) {
      return null;
    }

    const localForecast = forecast as SiteForecast;
    const points = Array.isArray(localForecast.points)
      ? localForecast.points
      : [];

    if (points.length === 0) {
      return null;
    }

    const totalExpected = points.reduce(
      (sum, p) => sum + (p.expected_kwh ?? 0),
      0
    );
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
      return {
        label,
        value: p.expected_kwh ?? 0,
      };
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
        <div
          className="cei-card-header"
          style={{ display: "flex", justifyContent: "space-between" }}
        >
          <div>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 600 }}>
              Next 24h forecast
            </h2>
            <p
              style={{
                marginTop: "0.1rem",
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Baseline-driven preview of expected energy over the next 24 hours.
            </p>
          </div>
          <span className="cei-pill cei-pill-neutral">
            Stub: {localForecast.method}
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
            <div className="cei-kpi-label">Expected next 24h</div>
            <div className="cei-kpi-value">
              {totalExpected.toFixed(1)} kWh
            </div>
          </div>
          <div className="cei-kpi">
            <div className="cei-kpi-label">Peak hour (forecast)</div>
            <div className="cei-kpi-value">{peakTimeLabel}</div>
            <div className="cei-kpi-subvalue">
              {(peak.expected_kwh ?? 0).toFixed(1)} kWh
            </div>
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
                  const ratio =
                    (val - forecastMin) / (forecastMax - forecastMin || 1);
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
          Based on a{" "}
          <strong>{localForecast.baseline_lookback_days}-day</strong> baseline
          and a <strong>{localForecast.history_window_hours}-hour</strong>{" "}
          recent performance window. Use this strip as a forward-looking mirror
          of the last 24h trend chart above.
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
      setNoteError("Please add a title or some text before saving.");
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
        normalizeApiError(err, "Failed to save note. Please try again.")
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
      setManualOppError("Please add a name or description.");
      return;
    }

    if (!id) {
      setManualOppError("Missing numeric site id.");
      return;
    }

    try {
      setManualOppSaving(true);
      const created = await createManualOpportunity(id, {
        name: name || "Opportunity",
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
        normalizeApiError(err, "Failed to create opportunity.")
      );
    } finally {
      setManualOppSaving(false);
    }
  };

  return (
    <div
      className="dashboard-page"
      style={{ maxWidth: "100vw", overflowX: "hidden" }}
    >
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
              ← Back to sites
            </Link>
          </div>
          <h1
            style={{
              fontSize: "1.3rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {siteLoading ? "Loading…" : site?.name || "Site"}
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Per-site performance view. Energy metrics are filtered by{" "}
            <code>site_id = {siteKey ?? "?"}</code> in the timeseries table.
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
              <span style={{ fontWeight: 500 }}>Location:</span>{" "}
              {site.location}
            </div>
          )}
          <div>
            <span style={{ fontWeight: 500 }}>Site ID:</span>{" "}
            {siteKey ?? id ?? "—"}
          </div>
          {lastUpdatedLabel && (
            <div style={{ marginTop: "0.15rem" }}>
              Last updated:{" "}
              <span style={{ color: "var(--cei-text-accent)" }}>
                {lastUpdatedLabel}
              </span>
            </div>
          )}
          {dataWindowLabel && (
            <div style={{ marginTop: "0.1rem", fontSize: "0.75rem" }}>
              Data window: {dataWindowLabel}
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
            Upload CSV for this site
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
            Delete site
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
            Energy – last 24 hours
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
                Aggregated from{" "}
                <strong>{summary!.points.toLocaleString()} readings</strong> in
                the last {summary!.window_hours} hours for this site.
              </>
            ) : summaryLoading ? (
              "Loading per-site energy data…"
            ) : (
              <>
                No recent data for this site. Either ensure your uploaded
                timeseries includes{" "}
                <code>site_id = {siteKey ?? "site-N"}</code>, or use the{" "}
                <strong>“Upload CSV for this site”</strong> button so CEI routes
                rows here automatically when your CSV has no site_id column.
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
            Data coverage
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
            Number of records for this site in the selected window.
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
            Status
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.2rem",
              fontWeight: 600,
            }}
          >
            {hasSummaryData ? "Active" : "No recent data"}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Simple heuristic status based on whether we see any recent
            timeseries for this site.
          </div>
        </div>
      </section>

      {/* KPI snapshot row */}
      <section className="dashboard-row">
        <div className="cei-card">
          <div className="cei-card-header">
            <div>
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Performance snapshot
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Last 24h vs baseline, and last 7 days vs previous 7 days for
                this site. Cost metrics use your org&apos;s configured tariffs.
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "0.35rem",
              }}
            >
              {kpiLoading && (
                <span className="cei-pill cei-pill-neutral">Updating…</span>
              )}
              <button
                type="button"
                className="cei-btn cei-btn-ghost"
                onClick={handleExportKpiCsv}
                disabled={kpiLoading || !kpi || !siteKey}
                style={{
                  fontSize: "0.75rem",
                  padding: "0.25rem 0.7rem",
                }}
              >
                Download KPI CSV
              </button>
            </div>
          </div>

          {kpiError && (
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
              }}
            >
              {kpiError}
            </div>
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
                    Last 24h vs baseline
                  </div>
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--cei-font-mono, monospace)",
                        fontWeight: 500,
                      }}
                    >
                      {kpi.last_24h_kwh.toFixed(0)} kWh
                    </span>{" "}
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      / baseline{" "}
                      {kpi.baseline_24h_kwh != null
                        ? `${kpi.baseline_24h_kwh.toFixed(0)} kWh`
                        : "—"}
                    </span>
                  </div>
                  <div style={{ marginTop: "0.25rem" }}>
                    <span
                      className={`cei-pill ${kpiDeltaBadgeClass(
                        kpi.deviation_pct_24h
                      )}`}
                    >
                      {formatPct(kpi.deviation_pct_24h)} vs baseline
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
                    Last 7 days vs previous 7 days
                  </div>
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--cei-font-mono, monospace)",
                        fontWeight: 500,
                      }}
                    >
                      {kpi.last_7d_kwh.toFixed(0)} kWh
                    </span>{" "}
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      / prev{" "}
                      {kpi.prev_7d_kwh != null
                        ? `${kpi.prev_7d_kwh.toFixed(0)} kWh`
                        : "—"}
                    </span>
                  </div>
                  <div style={{ marginTop: "0.25rem" }}>
                    <span
                      className={`cei-pill ${kpiDeltaBadgeClass(
                        kpi.deviation_pct_7d
                      )}`}
                    >
                      {formatPct(kpi.deviation_pct_7d)} vs previous 7d
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
                    Headline
                  </div>
                  <p
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--cei-text-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {kpi.deviation_pct_7d != null &&
                    Math.abs(kpi.deviation_pct_7d) > 5
                      ? kpi.deviation_pct_7d > 0
                        ? "Energy use is trending above the previous week. Worth a closer look at this site."
                        : "Energy use is trending below the previous week. Capture what’s working and standardize it."
                      : "Energy use is roughly in line with last week. Focus attention on spike alerts and anomaly windows."}
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
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--cei-text-muted)",
                    marginBottom: "0.35rem",
                  }}
                >
                  Cost snapshot (last 24h)
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
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--cei-text-muted)",
                          marginBottom: "0.15rem",
                        }}
                      >
                        24h cost (actual)
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--cei-font-mono, monospace)",
                          fontWeight: 500,
                        }}
                      >
                        {formatCurrency(last24hCost, kpiCurrencyCode)}
                      </div>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--cei-text-muted)",
                          marginBottom: "0.15rem",
                        }}
                      >
                        24h cost (expected)
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--cei-font-mono, monospace)",
                          fontWeight: 500,
                        }}
                      >
                        {formatCurrency(baseline24hCost, kpiCurrencyCode)}
                      </div>
                      <div
                        style={{
                          marginTop: "0.15rem",
                          fontSize: "0.75rem",
                          color: "var(--cei-text-muted)",
                        }}
                      >
                        Based on baseline kWh for this site.
                      </div>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--cei-text-muted)",
                          marginBottom: "0.15rem",
                        }}
                      >
                        24h savings / overspend
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.15rem",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--cei-font-mono, monospace)",
                            fontWeight: 500,
                          }}
                        >
                          {formatCurrency(
                            costDeltaAbs,
                            kpiCurrencyCode
                          )}{" "}
                          {costDirectionLabel !== "On baseline" &&
                          costDirectionLabel !==
                            "Savings / overspend vs baseline" ? (
                            <span
                              style={{
                                fontSize: "0.75rem",
                                color: "var(--cei-text-muted)",
                              }}
                            >
                              ({costDirectionLabel})
                            </span>
                          ) : null}
                        </span>
                        {kpi.deviation_pct_24h != null && (
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--cei-text-muted)",
                            }}
                          >
                            {formatPct(kpi.deviation_pct_24h)} vs baseline on a
                            cost basis.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--cei-text-muted)",
                    }}
                  >
                    Cost analytics for this site will light up once tariffs are
                    configured for your organization. You can review these under
                    Account &amp; Settings.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Trend + metadata */}
      <section className="dashboard-main-grid">
        <div
          className="cei-card"
          style={{ maxWidth: "100%", overflow: "hidden" }}
        >
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
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Site energy trend – last 24 hours
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Per-site series aggregated by hour. Uses{" "}
                <code>site_id = {siteKey}</code> from timeseries.
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
              <div>kWh · hourly</div>
              <button
                type="button"
                className="cei-btn cei-btn-ghost"
                onClick={handleExportTimeseriesCsv}
                disabled={
                  seriesLoading ||
                  !series ||
                  !Array.isArray(series.points) ||
                  series.points.length === 0
                }
                style={{
                  fontSize: "0.75rem",
                  padding: "0.25rem 0.6rem",
                }}
              >
                {seriesLoading ? "Preparing…" : "Download CSV"}
              </button>
            </div>
          </div>

          {seriesLoading && (
            <div
              style={{
                padding: "1.2rem 0.5rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <LoadingSpinner />
            </div>
          )}

          {!seriesLoading && !hasTrend ? (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No recent per-site series data. Once your timeseries has matching{" "}
              <code>site_id = {siteKey}</code>, or you upload via{" "}
              <strong>“Upload CSV for this site”</strong> with no site_id
              column, this chart will light up.
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
                          const ratio =
                            (val - minVal) / (maxVal - minVal || 1);
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
                              boxShadow:
                                "0 6px 18px rgba(56, 189, 248, 0.45)",
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
                  <div
                    style={{
                      marginTop: "0.75rem",
                      fontSize: "0.8rem",
                      color: "var(--cei-text-muted)",
                    }}
                  >
                    {trendSummary}
                  </div>
                )}
              </>
            )
          )}
        </div>

        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.6rem",
            }}
          >
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Site metadata
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Basic descriptive information for this site. We&apos;ll extend
              this with tags, baseline, and other fields later.
            </div>
          </div>

          {siteLoading && (
            <div
              style={{
                padding: "1.2rem 0.5rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
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
                <span style={{ color: "var(--cei-text-muted)" }}>Name:</span>{" "}
                <span>{site.name}</span>
              </div>
              <div>
                <span style={{ color: "var(--cei-text-muted)" }}>
                  Location:
                </span>{" "}
                <span>{site.location || "—"}</span>
              </div>
              <div>
                <span style={{ color: "var(--cei-text-muted)" }}>
                  Internal ID:
                </span>{" "}
                <span>{site.id}</span>
              </div>
            </div>
          )}

          {!siteLoading && !site && !siteError && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Site not found.
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
                  <div
                    style={{
                      fontSize: "0.9rem",
                      fontWeight: 600,
                    }}
                  >
                    Add site note
                  </div>
                  <div
                    style={{
                      marginTop: "0.2rem",
                      fontSize: "0.8rem",
                      color: "var(--cei-text-muted)",
                    }}
                  >
                    Log operational changes, decisions, or observations. These
                    events populate the activity timeline for this site.
                  </div>
                </div>
                {noteSaving && (
                  <span className="cei-pill cei-pill-neutral">Saving…</span>
                )}
              </div>

              {noteError && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "0.78rem",
                    color: "#f97373",
                  }}
                >
                  {noteError}
                </div>
              )}

              <form onSubmit={handleAddSiteNote} style={{ marginTop: "0.6rem" }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem",
                  }}
                >
                  <input
                    type="text"
                    placeholder="Short title (optional)"
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
                    placeholder="What changed at this site? E.g. 'HVAC schedule updated', 'Line 2 on reduced shift', 'Night audit performed'."
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
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: "0.2rem",
                    }}
                  >
                    <button
                      type="submit"
                      className="cei-btn"
                      disabled={noteSaving || (!noteTitle && !noteBody)}
                      style={{
                        fontSize: "0.8rem",
                        padding: "0.35rem 0.9rem",
                      }}
                    >
                      {noteSaving ? "Saving…" : "Save note"}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <SiteTimelineCard
              siteId={siteKey}
              windowHours={168}
              refreshKey={timelineRefreshKey}
            />
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
              CEI hybrid view
            </div>
            <div
              style={{
                marginTop: "0.3rem",
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              {hybrid.headline}
            </div>
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
          <div
            style={{
              marginBottom: "0.6rem",
            }}
          >
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Efficiency opportunities & baseline insights
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Targeted ideas based on the last 24 hours of energy at this site.
              Use this to brief local operations on where to focus next.
            </div>

            {insightsLoading && (
              <div
                style={{
                  marginTop: "0.35rem",
                  fontSize: "0.78rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Loading baseline profile for this site…
              </div>
            )}

            {!insightsLoading && baselineProfile && (
              <div
                style={{
                  marginTop: "0.35rem",
                  fontSize: "0.78rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Baseline (last{" "}
                <strong>{insightLookbackDays.toFixed(0)} days</strong>): global
                mean around{" "}
                <strong>
                  {baselineProfile.global_mean_kwh.toFixed(1)} kWh/hour
                </strong>
                , median hour about{" "}
                <strong>
                  {baselineProfile.global_p50_kwh.toFixed(1)} kWh
                </strong>
                , and a high-load {`p90`} near{" "}
                <strong>
                  {baselineProfile.global_p90_kwh.toFixed(1)} kWh
                </strong>
                . The last{" "}
                <strong>{insightWindowHours.toFixed(0)} hours</strong> ran{" "}
                {deviationPct !== null ? (
                  <strong>
                    {deviationPct >= 0 ? "+" : ""}
                    {deviationPct.toFixed(1)}%
                  </strong>
                ) : (
                  "—"
                )}{" "}
                vs this learned baseline.
              </div>
            )}

            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Under the hood, CEI compares this site&apos;s{" "}
              <strong>night vs day baseline</strong>,{" "}
              <strong>weekend vs weekday levels</strong>, and{" "}
              <strong>short-lived spikes vs typical hourly load</strong> — the
              same logic powering the Alerts page. Use both views together to
              separate day-to-day noise from structural waste.
            </div>

            {oppsLoading && (
              <div
                style={{
                  marginTop: "0.4rem",
                  fontSize: "0.78rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Scanning this site&apos;s KPIs for concrete opportunity
                measures…
              </div>
            )}

            {!oppsLoading && oppsError && (
              <div
                style={{
                  marginTop: "0.4rem",
                  fontSize: "0.78rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                {oppsError} Falling back to generic guidance below.
              </div>
            )}

            {!oppsLoading && opportunities.length > 0 && (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-main)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    marginBottom: "0.25rem",
                  }}
                >
                  Modelled measures for this site
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: "1.1rem",
                    fontSize: "0.8rem",
                    lineHeight: 1.5,
                  }}
                >
                  {opportunities.map((o, idx) => {
                    const roiYears =
                      typeof o.simple_roi_years === "number"
                        ? o.simple_roi_years
                        : null;
                    const savings =
                      typeof o.est_annual_kwh_saved === "number"
                        ? o.est_annual_kwh_saved
                        : null;
                    const co2 =
                      typeof o.est_co2_tons_saved_per_year === "number"
                        ? o.est_co2_tons_saved_per_year
                        : null;

                    return (
                      <li
                        key={`${o.source || "auto"}-${o.id}-${idx}`}
                        style={{ marginBottom: "0.25rem" }}
                      >
                        <strong>
                          {o.source === "manual" ? "[Manual] " : ""}
                          {o.name}
                        </strong>
                        {o.description ? ` – ${o.description}` : ""}
                        <span
                          style={{ display: "block", fontSize: "0.78rem" }}
                        >
                          {savings != null && (
                            <>
                              ≈{" "}
                              <strong>
                                {savings.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}{" "}
                                kWh/yr
                              </strong>{" "}
                              saved
                            </>
                          )}
                          {roiYears != null && (
                            <>
                              {" "}
                              · simple ROI ~{" "}
                              <strong>{roiYears.toFixed(1)} yrs</strong>
                            </>
                          )}
                          {co2 != null && (
                            <>
                              {" "}
                              · CO₂ cut ~{" "}
                              <strong>{co2.toFixed(2)} tCO₂/yr</strong>
                            </>
                          )}
                        </span>
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
            <div
              style={{
                fontSize: "0.8rem",
                fontWeight: 500,
                marginBottom: "0.35rem",
              }}
            >
              Add manual opportunity
            </div>

            {manualOppError && (
              <div
                style={{
                  marginBottom: "0.4rem",
                  fontSize: "0.78rem",
                  color: "#f97373",
                }}
              >
                {manualOppError}
              </div>
            )}

            <form onSubmit={handleManualOppSubmit}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                }}
              >
                <input
                  type="text"
                  placeholder="Short opportunity name (e.g. 'LED retrofit in warehouse')"
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
                  placeholder="Optional details (e.g. capex, expected savings, owner, target date)…"
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
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "0.2rem",
                  }}
                >
                  <button
                    type="submit"
                    className="cei-btn"
                    disabled={
                      manualOppSaving ||
                      (!manualOppForm.name && !manualOppForm.description)
                    }
                    style={{
                      fontSize: "0.8rem",
                      padding: "0.35rem 0.9rem",
                    }}
                  >
                    {manualOppSaving ? "Saving…" : "Add opportunity"}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {suggestions.length === 0 ? (
            <div
              style={{
                marginTop: "0.7rem",
                fontSize: "0.82rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No specific opportunities detected yet. Once this site has a more
              stable data profile, CEI will surface patterns worth acting on
              here.
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
  totalKwh: number | null,
  points: number | null,
  siteName: string | null
): string[] {
  const name = siteName || "this site";

  if (points === null || points === 0) {
    return [
      `Confirm that uploads for ${name} either (a) include a consistent site_id column, or (b) are sent via the “Upload CSV for this site” button so CEI can route rows automatically.`,
      "Check that timestamps for this site actually land in the last 24 hours – older backfills won’t drive this view.",
      "Start with one or two key meters for this site (e.g. main incomer, compressors) and validate that their profiles look realistic.",
    ];
  }

  const suggestions: string[] = [];

  if (totalKwh !== null) {
    if (totalKwh > 1000) {
      suggestions.push(
        `Identify which hours at ${name} show the highest kWh and coordinate with production to move non-critical loads away from those peaks.`,
        `Review night and weekend consumption at ${name} – look for lines, compressors, or HVAC that stay energized with no production.`,
        `Compare today’s kWh profile for ${name} with a “good” reference day to spot abnormal peaks or extended high-load periods.`
      );
    } else if (totalKwh > 300) {
      suggestions.push(
        `Check whether batch processes at ${name} are overlapping more than necessary and see if start times can be staggered.`,
        `Look for a flat, elevated overnight baseline at ${name}; that often hides idle losses from utilities and auxiliary equipment.`,
        `Use CEI to mark any operational changes at ${name} (setpoint shifts, maintenance) and compare before/after daily kWh.`
      );
    } else {
      suggestions.push(
        `${name} is running with relatively modest daily energy use. Focus on preventing creeping standby losses over the next weeks.`,
        `Use this site as a low-risk sandbox: test small changes (lighting, idle modes, scheduling) and capture the before/after impact.`
      );
    }
  }

  suggestions.push(
    `Work with the local team at ${name} to tag meters by process (e.g. "compressors", "HVAC", "ovens") so future analytics can surface process-level waste.`,
    `Add a quick weekly stand-up for ${name} where you review this page with operations and agree on one concrete action item.`,
    "Capture photos or notes of any physical changes you make (insulation, setpoints, shutdown procedures) so savings are auditable, not just anecdotal."
  );

  return suggestions;
}

export default SiteView;
