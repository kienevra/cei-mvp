// frontend/src/pages/Dashboard.tsx
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getTimeseriesSummary,
  getTimeseriesSeries,
  getSites,
  getIngestHealth,
  type IngestHealthResponse,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import PortfolioTrendChart from "../components/PortfolioTrendChart";
import { getAlerts } from "../services/api";

// ── Daily Focus Card ──────────────────────────────────────────────────────
type FocusItem = {
  color: string;
  icon: string;
  text: string;
  action?: { label: string; href: string };
};

function DailyFocusCard({
  trendValues,
  trendPoints,
  ingestHealth,
  missingMeters,
}: {
  trendValues: number[];
  trendPoints: TrendPoint[];
  ingestHealth: IngestHealthResponse | null;
  missingMeters: number;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [alertCount, setAlertCount] = useState<{ critical: number; warning: number } | null>(null);

  useEffect(() => {
    getAlerts({ window_hours: 168 })
      .then((data: any[]) => {
        const critical = data.filter((a: any) => a.severity === "critical").length;
        const warning = data.filter((a: any) => a.severity === "warning").length;
        setAlertCount({ critical, warning });
      })
      .catch(() => setAlertCount({ critical: 0, warning: 0 }));
  }, []);

  const items: FocusItem[] = [];

  // ── 1. Night baseline analysis ─────────────────────────────────────────
  if (trendValues.length >= 24) {
    const nightIndices = trendPoints
      .map((p, i) => {
        const h = new Date(0);
        const parts = p.label.split(":");
        const hour = parseInt(parts[0], 10);
        return { i, hour };
      })
      .filter(({ hour }) => hour >= 22 || hour < 6)
      .map(({ i }) => i);

    const dayIndices = trendPoints
      .map((_, i) => i)
      .filter(i => !nightIndices.includes(i));

    if (nightIndices.length > 0 && dayIndices.length > 0) {
      const nightAvg = nightIndices.reduce((s, i) => s + (trendValues[i] || 0), 0) / nightIndices.length;
      const dayAvg = dayIndices.reduce((s, i) => s + (trendValues[i] || 0), 0) / dayIndices.length;
      const ratio = dayAvg > 0 ? nightAvg / dayAvg : 0;

      if (ratio >= 0.7) {
        items.push({
          color: "#ef4444",
          icon: "🚨",
          text: `Night baseline is ${Math.round(ratio * 100)}% of daytime average — significant idle losses likely. Check compressors, HVAC, and furnace standby.`,
          action: { label: "View Alerts", href: "/alerts" },
        });
      } else if (ratio >= 0.4) {
        items.push({
          color: "#f59e0b",
          icon: "⚠️",
          text: `Night baseline is ${Math.round(ratio * 100)}% of daytime average — some off-shift consumption worth investigating.`,
          action: { label: "View Alerts", href: "/alerts" },
        });
      } else if (ratio > 0) {
        items.push({
          color: "#22c55e",
          icon: "✅",
          text: `Night baseline looks healthy at ${Math.round(ratio * 100)}% of daytime average.`,
        });
      }
    }
  }

  // ── 2. Peak spike analysis ─────────────────────────────────────────────
  if (trendValues.length > 0) {
    const avg = trendValues.reduce((s, v) => s + v, 0) / trendValues.length;
    const max = Math.max(...trendValues);
    const peakIdx = trendValues.indexOf(max);
    const peakLabel = trendPoints[peakIdx]?.label ?? "—";
    const ratio = avg > 0 ? max / avg : 0;

    if (ratio >= 3) {
      items.push({
        color: "#ef4444",
        icon: "📈",
        text: `Extreme peak at ${peakLabel} — ${max.toFixed(0)} kWh, ${ratio.toFixed(1)}× the 24h average. Investigate overlapping batches or unscheduled equipment starts.`,
      });
    } else if (ratio >= 2) {
      items.push({
        color: "#f59e0b",
        icon: "📈",
        text: `Notable peak at ${peakLabel} — ${max.toFixed(0)} kWh, ${ratio.toFixed(1)}× the 24h average.`,
      });
    }
  }

  // ── 3. Critical / warning alerts ──────────────────────────────────────
  if (alertCount !== null) {
    if (alertCount.critical > 0) {
      items.push({
        color: "#ef4444",
        icon: "🔴",
        text: `${alertCount.critical} critical alert${alertCount.critical > 1 ? "s" : ""} active across the fleet.`,
        action: { label: "View Alerts", href: "/alerts" },
      });
    } else if (alertCount.warning > 0) {
      items.push({
        color: "#f59e0b",
        icon: "🟡",
        text: `${alertCount.warning} warning${alertCount.warning > 1 ? "s" : ""} active — no critical issues.`,
        action: { label: "View Alerts", href: "/alerts" },
      });
    } else {
      items.push({
        color: "#22c55e",
        icon: "✅",
        text: "No active alerts across the fleet.",
      });
    }
  }

  // ── 4. Ingest health ───────────────────────────────────────────────────
  if (missingMeters > 0) {
    items.push({
      color: "#f59e0b",
      icon: "📡",
      text: `${missingMeters} meter${missingMeters > 1 ? "s" : ""} below 90% completeness — check your data pipeline.`,
    });
  }

  // ── 5. Fallback ────────────────────────────────────────────────────────
  if (items.length === 0) {
    items.push({
      color: "#94a3b8",
      icon: "⏳",
      text: "Upload data or connect a source to generate insights.",
    });
  }

  return (
    <div className="cei-card">
      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
          {t("dashboard.focus.title", { defaultValue: "What to pay attention to today" })}
        </div>
        <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
          Generated from your last 24 hours of data.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {items.map((item, idx) => (
          <div key={idx} style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "flex-start",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.5rem",
            background: "rgba(15,23,42,0.5)",
            border: `1px solid ${item.color}22`,
          }}>
            <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: "0.05rem" }}>{item.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.83rem", color: "var(--cei-text-main)", lineHeight: 1.5 }}>
                {item.text}
              </div>
              {item.action && (
                <button
                  type="button"
                  onClick={() => navigate(item.action!.href)}
                  style={{
                    marginTop: "0.35rem",
                    fontSize: "0.75rem",
                    color: item.color,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  {item.action.label} →
                </button>
              )}
            </div>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: item.color, flexShrink: 0, marginTop: "0.35rem",
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}

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

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const orgType = user?.org?.org_type ?? user?.organization?.org_type;
    if (orgType === "managing") {
      navigate("/manage", { replace: true });
    }
  }, [user, navigate]);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [siteCount, setSiteCount] = useState<number | null>(null);
  const [sitesError, setSitesError] = useState<string | null>(null);

  // ingest health card state
  const [ingestHealth, setIngestHealth] = useState<IngestHealthResponse | null>(
    null
  );
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Portfolio summary (all data, no site filter)
    setSummaryLoading(true);
    setSummaryError(null);
    getTimeseriesSummary({ window_hours: 24 })
      .then((data) => {
        if (!isMounted) return;
        setSummary(data as SummaryResponse);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSummaryError(
          e?.message ||
            t("dashboard.errors.summary", {
              defaultValue: "Failed to load energy summary.",
            })
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setSummaryLoading(false);
      });

    // Portfolio series
    setSeriesLoading(true);
    setSeriesError(null);
    getTimeseriesSeries({ window_hours: 24, resolution: "hour" })
      .then((data) => {
        if (!isMounted) return;
        setSeries(data as SeriesResponse);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSeriesError(
          e?.message ||
            t("dashboard.errors.trend", {
              defaultValue: "Failed to load energy trend.",
            })
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setSeriesLoading(false);
      });

    // Site count – used for a simple KPI
    getSites()
      .then((data) => {
        if (!isMounted) return;
        if (Array.isArray(data)) {
          setSiteCount(data.length);
        } else {
          setSiteCount(null);
        }
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSitesError(
          e?.message ||
            t("dashboard.errors.sites", { defaultValue: "Failed to load sites." })
        );
      });

    // Ingest health (24h)
    setIngestLoading(true);
    setIngestError(null);
    getIngestHealth(24)
      .then((data) => {
        if (!isMounted) return;
        setIngestHealth(data);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setIngestError(
          e?.message ||
            t("dashboard.errors.ingestHealth", {
              defaultValue: "Failed to load ingest health.",
            })
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setIngestLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [t]);

  const hasSummaryData = summary && summary.points > 0;
  const totalKwh = hasSummaryData ? summary!.total_value : 0;
  const lastUpdatedLabel = hasSummaryData
    ? formatDateTimeLabel(summary!.to_timestamp)
    : null;

  const dataWindowLabel = hasSummaryData
    ? formatTimeRange(summary!.from_timestamp, summary!.to_timestamp)
    : null;

  const formattedKwh = hasSummaryData
    ? totalKwh >= 1000
      ? `${(totalKwh / 1000).toFixed(2)} MWh`
      : `${totalKwh.toFixed(1)} kWh`
    : "—";

  // Build trend points from API data
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

  // Chart content width
  const barPixelWidth = 40;
  const minContentWidth = 600;
  const chartContentWidth = hasTrend
    ? Math.max(trendPoints.length * barPixelWidth, minContentWidth)
    : minContentWidth;

  // Pixel-based bar height mapping
  const maxBarHeightPx = 160;
  const baseBarHeightPx = 20;

  // High-level summary of the trend
  let trendSummary: string | null = null;
  if (hasTrend && hasSummaryData) {
    const sumVal = trendValues.reduce((acc, v) => acc + v, 0);
    const avgVal = sumVal / trendValues.length;
    const peakIndex = trendValues.indexOf(maxVal);
    const peakLabel = trendPoints[peakIndex]?.label ?? "—";
    const windowHours = summary!.window_hours || 24;

    trendSummary = t("dashboard.trend.summary", {
      defaultValue:
        "Peak hour: {{peakLabel}} at {{maxVal}} kWh · Average: {{avgVal}} kWh/h over {{windowHours}} hours · Min hourly: {{minVal}} kWh/h.",
      peakLabel,
      maxVal: maxVal.toFixed(1),
      avgVal: avgVal.toFixed(1),
      windowHours: windowHours.toFixed(0),
      minVal: minVal.toFixed(1),
    });
  }

  const anyError = summaryError || seriesError || sitesError || ingestError;

  // ingest health computed fields
  const meters = ingestHealth?.meters || [];
  const meterCount = meters.length;

  const avgCompleteness =
    meterCount > 0
      ? meters.reduce((acc, m) => acc + (Number(m.completeness_pct) || 0), 0) /
        meterCount
      : null;

  const missingMeters =
    meterCount > 0
      ? meters.filter((m) => (Number(m.completeness_pct) || 0) < 90).length
      : 0;

  const oldestLastSeen =
    meterCount > 0
      ? meters
          .map((m) => m.last_seen)
          .filter(Boolean)
          .sort()[0] || null
      : null;

  const oldestLastSeenLabel = formatDateTimeLabel(oldestLastSeen);

  let ingestStatusLabel = t("dashboard.ingest.status.na", { defaultValue: "—" });
  if (ingestLoading)
    ingestStatusLabel = t("dashboard.ingest.status.checking", {
      defaultValue: "Checking…",
    });
  else if (meterCount === 0)
    ingestStatusLabel = t("dashboard.ingest.status.noMeters", {
      defaultValue: "No meters detected",
    });
  else if ((avgCompleteness ?? 0) >= 98 && missingMeters === 0)
    ingestStatusLabel = t("dashboard.ingest.status.green", { defaultValue: "Green" });
  else if ((avgCompleteness ?? 0) >= 90)
    ingestStatusLabel = t("dashboard.ingest.status.amber", { defaultValue: "Amber" });
  else
    ingestStatusLabel = t("dashboard.ingest.status.red", { defaultValue: "Red" });

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
          <h1
            style={{
              fontSize: "1.4rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {t("dashboard.header.title", { defaultValue: "Portfolio overview" })}
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {t("dashboard.header.subtitle", {
              defaultValue:
                "High-level energy view across all sites over the last 24 hours. Use this as your daily cockpit: is the fleet behaving as expected?",
            })}
          </p>
        </div>

        <div
          style={{
            textAlign: "right",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          {siteCount !== null && (
            <div>
              {t("dashboard.header.monitoring", {
                defaultValue: "Monitoring",
              })}{" "}
              <strong>{siteCount}</strong>{" "}
              {t("dashboard.header.sites", { defaultValue: "sites" })}.
            </div>
          )}
          <div>
            {t("dashboard.header.window", { defaultValue: "Window" })}:{" "}
            {t("dashboard.header.last24h", { defaultValue: "last 24 hours" })}
          </div>

          {lastUpdatedLabel && (
            <div style={{ marginTop: "0.15rem" }}>
              {t("dashboard.header.lastUpdated", { defaultValue: "Last updated" })}:{" "}
              <span style={{ color: "var(--cei-text-accent)" }}>
                {lastUpdatedLabel}
              </span>
            </div>
          )}

          {dataWindowLabel && (
            <div style={{ marginTop: "0.1rem", fontSize: "0.75rem" }}>
              {t("dashboard.header.dataWindow", { defaultValue: "Data window" })}:{" "}
              {dataWindowLabel}
            </div>
          )}
        </div>
      </section>

      {/* Errors */}
      {anyError && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner
            message={anyError}
            onClose={() => {
              setSummaryError(null);
              setSeriesError(null);
              setSitesError(null);
              setIngestError(null);
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
            {t("dashboard.kpis.energy.title", {
              defaultValue: "Energy – last 24 hours (all sites)",
            })}
          </div>
          <div style={{ marginTop: "0.35rem", fontSize: "1.8rem", fontWeight: 600 }}>
            {summaryLoading ? "…" : formattedKwh}
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            {hasSummaryData ? (
              <>
                {t("dashboard.kpis.energy.aggregatedFrom", {
                  defaultValue: "Aggregated from",
                })}{" "}
                <strong>{summary!.points.toLocaleString()} {t("dashboard.kpis.energy.readings", { defaultValue: "readings" })}</strong>{" "}
                {t("dashboard.kpis.energy.inLast", { defaultValue: "in the last" })}{" "}
                {summary!.window_hours} {t("dashboard.kpis.energy.hoursAcrossFleet", { defaultValue: "hours across the fleet." })}
              </>
            ) : summaryLoading ? (
              t("dashboard.kpis.energy.loading", { defaultValue: "Loading energy data…" })
            ) : (
              t("dashboard.kpis.energy.noData", {
                defaultValue:
                  "No recent timeseries data yet. Upload a CSV or connect a source to light this up.",
              })
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
            {t("dashboard.kpis.coverage.title", { defaultValue: "Data coverage" })}
          </div>

          {(() => {
            const actual = hasSummaryData ? summary!.points : 0;
            const expected = siteCount != null && siteCount > 0
              ? siteCount * (summary?.window_hours ?? 24)
              : null;
            const pct = expected != null && expected > 0
              ? Math.round((actual / expected) * 100)
              : null;
            const color = pct == null
              ? "#9ca3af"
              : pct >= 95 ? "#22c55e"
              : pct >= 80 ? "#fb923c"
              : "#f87171";

            return (
              <>
                <div style={{ marginTop: "0.35rem", display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                  <span style={{ fontSize: "1.4rem", fontWeight: 600, color }}>
                    {pct != null ? `${pct}%` : hasSummaryData ? actual.toLocaleString() : "—"}
                  </span>
                  {pct != null && (
                    <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                      {actual.toLocaleString()} / {expected!.toLocaleString()} pts
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {pct != null && (
                  <div style={{
                    marginTop: "0.5rem",
                    height: 4,
                    borderRadius: 999,
                    background: "rgba(148,163,184,0.12)",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(pct, 100)}%`,
                      borderRadius: 999,
                      background: color,
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                )}

                <div style={{ marginTop: "0.35rem", fontSize: "0.78rem", color: "#9ca3af" }}>
                  {pct == null
                    ? t("dashboard.kpis.coverage.body", {
                        defaultValue: "Total readings in the last 24h across all sites.",
                      })
                    : pct >= 95
                    ? "Full coverage — all sites reporting on schedule."
                    : pct >= 80
                    ? `${100 - pct}% of expected readings missing — check ingest health.`
                    : `Coverage is low — ${expected! - actual} readings missing. Check your data pipeline.`
                  }
                </div>
              </>
            );
          })()}
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
            {t("dashboard.kpis.fleetStatus.title", { defaultValue: "Fleet status" })}
          </div>
          <div style={{ marginTop: "0.35rem", fontSize: "1.2rem", fontWeight: 600 }}>
            {hasSummaryData
              ? t("dashboard.kpis.fleetStatus.active", { defaultValue: "Active" })
              : t("dashboard.kpis.fleetStatus.waiting", { defaultValue: "Waiting for data" })}
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            {t("dashboard.kpis.fleetStatus.body", {
              defaultValue:
                "Simple heuristic based purely on whether any readings exist in the last 24 hours.",
            })}
          </div>
        </div>

        {/* Ingest health card */}
        <div className="cei-card">
          {/* Title + status badge */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.5rem",
          }}>
            <div style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}>
              {t("dashboard.ingest.title", { defaultValue: "Ingest health (last 24h)" })}
            </div>

            {!ingestLoading && meterCount > 0 && (() => {
              const pct = avgCompleteness ?? 0;
              const bg = pct >= 98 && missingMeters === 0
                ? "rgba(34,197,94,0.12)"
                : pct >= 90
                ? "rgba(251,146,60,0.12)"
                : "rgba(248,113,113,0.12)";
              const border = pct >= 98 && missingMeters === 0
                ? "rgba(34,197,94,0.3)"
                : pct >= 90
                ? "rgba(251,146,60,0.3)"
                : "rgba(248,113,113,0.3)";
              const color = pct >= 98 && missingMeters === 0
                ? "#22c55e"
                : pct >= 90
                ? "#fb923c"
                : "#f87171";
              const label = pct >= 98 && missingMeters === 0
                ? "● Green"
                : pct >= 90
                ? "● Amber"
                : "● Red";
              return (
                <span style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  padding: "0.2rem 0.6rem",
                  borderRadius: 999,
                  background: bg,
                  border: `1px solid ${border}`,
                  color,
                  letterSpacing: "0.03em",
                }}>
                  {label}
                </span>
              );
            })()}
          </div>

          {ingestLoading ? (
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("dashboard.ingest.loading", { defaultValue: "Checking meter completeness…" })}
            </div>
          ) : meterCount === 0 ? (
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("dashboard.ingest.noMetersBody", {
                defaultValue: "No meters detected. Once data is ingested, this card will show coverage by meter.",
              })}
            </div>
          ) : (
            <>
              {/* Completeness percentage + progress bar */}
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.3rem" }}>
                  <span style={{
                    fontSize: "1.4rem",
                    fontWeight: 600,
                    color: (avgCompleteness ?? 0) >= 95 ? "#22c55e"
                      : (avgCompleteness ?? 0) >= 80 ? "#fb923c"
                      : "#f87171",
                  }}>
                    {(avgCompleteness ?? 0).toFixed(1)}%
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>avg completeness</span>
                </div>
                <div style={{
                  height: 4,
                  borderRadius: 999,
                  background: "rgba(148,163,184,0.12)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(avgCompleteness ?? 0, 100)}%`,
                    borderRadius: 999,
                    background: (avgCompleteness ?? 0) >= 95 ? "#22c55e"
                      : (avgCompleteness ?? 0) >= 80 ? "#fb923c"
                      : "#f87171",
                    transition: "width 0.6s ease",
                  }} />
                </div>
              </div>

              {/* Stats grid */}
              <div style={{
                marginTop: "0.65rem",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.4rem 0.75rem",
                fontSize: "0.78rem",
              }}>
                <div>
                  <div style={{ color: "#9ca3af", marginBottom: "0.1rem" }}>Meters tracked</div>
                  <div style={{ fontWeight: 600, color: "#e5e7eb" }}>{meterCount}</div>
                </div>
                <div>
                  <div style={{ color: "#9ca3af", marginBottom: "0.1rem" }}>Under 90%</div>
                  <div style={{
                    fontWeight: 600,
                    color: missingMeters === 0 ? "#22c55e" : "#f87171",
                  }}>
                    {missingMeters === 0 ? "None ✓" : `${missingMeters} meter${missingMeters > 1 ? "s" : ""}`}
                  </div>
                </div>
                {oldestLastSeenLabel && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ color: "#9ca3af", marginBottom: "0.1rem" }}>Oldest last seen</div>
                    <div style={{ fontWeight: 500, color: "#38bdf8" }}>{oldestLastSeenLabel}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Main grid */}
      <section className="dashboard-main-grid">
        {/* Trend card */}
        <div className="cei-card" style={{ maxWidth: "100%", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.7rem" }}>
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                {t("dashboard.trend.title", {
                  defaultValue: "Portfolio energy trend – last 24 hours",
                })}
              </div>
              <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                {t("dashboard.trend.subtitle", {
                  defaultValue:
                    "Hourly energy profile across all sites combined. Use this to spot peaks, troughs, and suspiciously flat baselines.",
                })}
              </div>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              {t("dashboard.trend.unit", { defaultValue: "kWh · hourly" })}
            </div>
          </div>

          <PortfolioTrendChart
            points={series?.points ?? []}
            loading={seriesLoading}
          />

          {trendSummary && !seriesLoading && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {trendSummary}
            </div>
          )}
        </div>

        {/* Right-hand commentary — data-driven */}
        <DailyFocusCard
          trendValues={trendValues}
          trendPoints={trendPoints}
          ingestHealth={ingestHealth}
          missingMeters={missingMeters}
        />
      </section>
    </div>
  );
};

export default Dashboard;
