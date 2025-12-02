import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  getSite,
  getTimeseriesSummary,
  getTimeseriesSeries,
  getSiteInsights, // now actively used
  getSiteForecast, // NEW: typed forecast helper
  getSiteKpi, // NEW: KPI helper
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import type { SiteInsights, SiteForecast } from "../types/api";
import type { SiteKpi } from "../services/api";
import { buildHybridNarrative } from "../utils/hybridNarrative";
import SiteAlertsStrip from "../components/SiteAlertsStrip";
import { downloadCsv } from "../utils/csv";

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

function formatTimeRange(
  from?: string | null,
  to?: string | null
): string | null {
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

  // NEW: analytics / insights state
  const [insights, setInsights] = useState<SiteInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // NEW: forecast state (predictive stub)
  const [forecast, setForecast] = useState<SiteForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // NEW: KPI state (24h vs baseline, 7d vs previous 7d)
  const [kpi, setKpi] = useState<SiteKpi | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState<string | null>(null);

  // Map numeric route ID -> timeseries site key (e.g. "site-1")
  const siteKey = id ? `site-${id}` : undefined;

  useEffect(() => {
    if (!id) return;
    let isMounted = true;

    // Site metadata
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

    // Per-site summary
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

    // Per-site series
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

    // NEW: per-site analytics / insights
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
          e?.response?.data?.detail ||
            e?.message ||
            "Failed to load analytics insights."
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setInsightsLoading(false);
      });

    // NEW: per-site forecast (baseline-driven stub) via shared API helper
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
        setForecast(data);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        const status = e?.response?.status;
        if (status === 404) {
          // Not enough data: quietly hide forecast card
          setForecast(null);
          return;
        }
        // Non-fatal: SiteView should still work if forecast is down
        setForecastError(e?.message || "Unable to load forecast right now.");
      })
      .finally(() => {
        if (!isMounted) return;
        setForecastLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, siteKey]);

  // NEW: KPI fetch (separate effect to avoid touching existing logic)
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
        // Non-fatal: SiteView continues, just no KPI snapshot
        setKpiError(
          e?.response?.data?.detail ||
            e?.message ||
            "Unable to load KPI comparison."
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

  // Build trend points from API data (force numeric, 24h labels)
  let trendPoints: TrendPoint[] = [];
  if (series && series.points && series.points.length > 0) {
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

  // Chart inner width
  const barPixelWidth = 40;
  const minContentWidth = 600;
  const chartContentWidth = hasTrend
    ? Math.max(trendPoints.length * barPixelWidth, minContentWidth)
    : minContentWidth;

  // Pixel-based bar height mapping
  const maxBarHeightPx = 160; // tallest bar
  const baseBarHeightPx = 20; // minimum visible height when value > 0

  // Concise trend summary for this site
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

  // Site-level efficiency suggestions card (frontend-only heuristics)
  const suggestions = buildSiteEfficiencySuggestions(
    hasSummaryData ? totalKwh : null,
    hasSummaryData ? summary!.points : null,
    site?.name || null
  );

  // NEW: convenience references for baseline view
  const baselineProfile = insights?.baseline_profile || null;
  const deviationPct =
    typeof insights?.deviation_pct === "number" ? insights.deviation_pct : null;
  const insightWindowHours =
    typeof insights?.window_hours === "number" ? insights.window_hours : 24;
  const insightLookbackDays =
    typeof insights?.baseline_lookback_days === "number"
      ? insights.baseline_lookback_days
      : baselineProfile?.lookback_days ?? 30;

  // NEW: derived forecast metrics
  const hasForecast = !!forecast && forecast.points.length > 0;

  // NEW: hybrid deterministic–statistical–predictive narrative
  const hybrid = buildHybridNarrative(insights, forecast);

  // --- CSV export for this site's timeseries ---
  const handleExportTimeseriesCsv = () => {
    if (!series || !series.points || series.points.length === 0) {
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

  // NEW: per-site upload entrypoint
  const handleGoToUploadForSite = () => {
    if (!siteKey) return;
    navigate(`/upload?site_id=${encodeURIComponent(siteKey)}`);
  };

  // NEW: small helpers for KPI block
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
      // Forecast is optional; if it's not available, we hide the card.
      return null;
    }

    const totalExpected = forecast!.points.reduce(
      (sum, p) => sum + p.expected_kwh,
      0
    );
    const peak = forecast!.points.reduce((max, p) =>
      p.expected_kwh > max.expected_kwh ? p : max
    );

    const firstSix = forecast!.points.slice(0, 6);

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
            Stub: {forecast!.method}
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
            <div className="cei-kpi-value">
              {new Date(peak.ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div className="cei-kpi-subvalue">
              {peak.expected_kwh.toFixed(1)} kWh
            </div>
          </div>
        </div>

        <div
          className="cei-forecast-strip"
          style={{
            marginTop: "0.9rem",
            display: "flex",
            gap: "0.6rem",
            overflowX: "auto",
          }}
        >
          {firstSix.map((p) => {
            const dt = new Date(p.ts);
            const label = dt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <div
                key={p.ts}
                className="cei-forecast-slot"
                style={{
                  flex: "0 0 auto",
                  minWidth: "70px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  className="cei-forecast-value"
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                  }}
                >
                  {p.expected_kwh.toFixed(1)}
                </div>
                <div
                  className="cei-forecast-time"
                  style={{
                    marginTop: "0.15rem",
                    fontSize: "0.7rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        <p
          style={{
            marginTop: "0.8rem",
            fontSize: "0.75rem",
            color: "var(--cei-text-muted)",
          }}
        >
          Based on a{" "}
          <strong>{forecast!.baseline_lookback_days}-day</strong> baseline and{" "}
          <strong>{forecast!.history_window_hours}-hour</strong> recent
          performance window.
        </p>
      </section>
    );
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
          {/* NEW: per-site scoped CSV upload entrypoint */}
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

      {/* NEW: KPI snapshot row – 24h vs baseline, 7d vs previous 7d */}
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
                this site.
              </div>
            </div>
            {kpiLoading && (
              <span className="cei-pill cei-pill-neutral">Updating…</span>
            )}
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
            <div
              style={{
                marginTop: "0.6rem",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(0, 1fr))",
                gap: "0.9rem",
                fontSize: "0.8rem",
              }}
            >
              {/* 24h vs baseline */}
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

              {/* Last 7d vs previous 7d */}
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

              {/* Narrative hook */}
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
          )}
        </div>
      </section>

      {/* Main grid: trend + metadata */}
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
                  !series.points ||
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
            <>
              {/* Local scroll container for this site chart */}
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
                        // all equal > 0
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
                        {/* numeric value so you can verify */}
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

              {/* Short summary instead of raw debug list */}
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

      {/* NEW: site-level alerts strip */}
      {siteKey && (
        <section style={{ marginTop: "0.75rem" }}>
          <SiteAlertsStrip siteKey={siteKey} limit={3} />
        </section>
      )}

      {/* NEW: forecast card (predictive stub) */}
      <section style={{ marginTop: "0.75rem" }}>{renderForecastCard()}</section>

      {/* CEI hybrid view card */}
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

      {/* Site-level efficiency opportunities / INSIGHTS card */}
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

            {/* NEW: statistical baseline summary from analytics engine */}
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
          </div>

          {suggestions.length === 0 ? (
            <div
              style={{
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
                margin: 0,
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

  // Always-on tactical suggestions
  suggestions.push(
    `Work with the local team at ${name} to tag meters by process (e.g. "compressors", "HVAC", "ovens") so future analytics can surface process-level waste.`,
    `Add a quick weekly stand-up for ${name} where you review this page with operations and agree on one concrete action item.`,
    "Capture photos or notes of any physical changes you make (insulation, setpoints, shutdown procedures) so savings are auditable, not just anecdotal."
  );

  return suggestions;
}

export default SiteView;
