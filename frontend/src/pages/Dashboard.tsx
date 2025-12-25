// frontend/src/pages/Dashboard.tsx
import React, { useEffect, useState } from "react";
import {
  getTimeseriesSummary,
  getTimeseriesSeries,
  getSites,
  getIngestHealth,
  type IngestHealthResponse,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

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

const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [siteCount, setSiteCount] = useState<number | null>(null);
  const [sitesError, setSitesError] = useState<string | null>(null);

  // NEW: ingest health card state
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
        setSummaryError(e?.message || "Failed to load energy summary.");
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
        setSeriesError(e?.message || "Failed to load energy trend.");
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
        setSitesError(e?.message || "Failed to load sites.");
      });

    // NEW: ingest health (24h) – pilot ops cockpit
    setIngestLoading(true);
    setIngestError(null);
    getIngestHealth(24)
      .then((data) => {
        if (!isMounted) return;
        setIngestHealth(data);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setIngestError(e?.message || "Failed to load ingest health.");
      })
      .finally(() => {
        if (!isMounted) return;
        setIngestLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

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

  // Chart content width: fixed per bar, with a minimum
  const barPixelWidth = 40; // px per bar
  const minContentWidth = 600; // px minimum
  const chartContentWidth = hasTrend
    ? Math.max(trendPoints.length * barPixelWidth, minContentWidth)
    : minContentWidth;

  // Pixel-based bar height mapping for visible magnitude differences
  const maxBarHeightPx = 160; // tallest bar inside chart
  const baseBarHeightPx = 20; // minimum visible height when value > 0

  // High-level summary of the trend
  let trendSummary: string | null = null;
  if (hasTrend && hasSummaryData) {
    const sumVal = trendValues.reduce((acc, v) => acc + v, 0);
    const avgVal = sumVal / trendValues.length;
    const peakIndex = trendValues.indexOf(maxVal);
    const peakLabel = trendPoints[peakIndex]?.label ?? "—";
    const windowHours = summary!.window_hours || 24;

    trendSummary = `Peak hour: ${peakLabel} at ${maxVal.toFixed(
      1
    )} kWh · Average: ${avgVal.toFixed(
      1
    )} kWh/h over ${windowHours.toFixed(
      0
    )} hours · Min hourly: ${minVal.toFixed(1)} kWh/h.`;
  }

  const anyError = summaryError || seriesError || sitesError || ingestError;

  // NEW: ingest health computed fields
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

  let ingestStatusLabel = "—";
  if (ingestLoading) ingestStatusLabel = "Checking…";
  else if (meterCount === 0) ingestStatusLabel = "No meters detected";
  else if ((avgCompleteness ?? 0) >= 98 && missingMeters === 0)
    ingestStatusLabel = "Green";
  else if ((avgCompleteness ?? 0) >= 90) ingestStatusLabel = "Amber";
  else ingestStatusLabel = "Red";

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
          <h1
            style={{
              fontSize: "1.4rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Portfolio overview
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            High-level energy view across all sites over the last 24 hours. Use
            this as your daily cockpit: is the fleet behaving as expected?
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
              Monitoring <strong>{siteCount}</strong> sites.
            </div>
          )}
          <div>Window: last 24 hours</div>
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
            Energy – last 24 hours (all sites)
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.8rem",
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
                the last {summary!.window_hours} hours across the fleet.
              </>
            ) : summaryLoading ? (
              "Loading energy data…"
            ) : (
              "No recent timeseries data yet. Upload a CSV or connect a source to light this up."
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
            Data coverage (points)
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
            Total number of readings in the selected window. Use this as a quick
            sense-check of how “complete” your dataset is.
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
            Fleet status
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.2rem",
              fontWeight: 600,
            }}
          >
            {hasSummaryData ? "Active" : "Waiting for data"}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Simple heuristic based purely on whether any readings exist in the
            last 24 hours.
          </div>
        </div>

        {/* NEW: Ingest health card */}
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}
          >
            Ingest health (last 24h)
          </div>

          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.2rem",
              fontWeight: 600,
            }}
          >
            {ingestStatusLabel}
          </div>

          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              lineHeight: 1.5,
            }}
          >
            {ingestLoading ? (
              "Checking meter completeness…"
            ) : meterCount === 0 ? (
              "No meters returned. Once data is ingested, this will show coverage by meter."
            ) : (
              <>
                Avg completeness:{" "}
                <strong>
                  {(avgCompleteness ?? 0).toFixed(1)}%
                </strong>{" "}
                · Meters under 90%: <strong>{missingMeters}</strong> · Meters:{" "}
                <strong>{meterCount}</strong>
                {oldestLastSeenLabel && (
                  <>
                    {" "}
                    · Oldest last seen:{" "}
                    <span style={{ color: "var(--cei-text-accent)" }}>
                      {oldestLastSeenLabel}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Main grid: trend + commentary */}
      <section className="dashboard-main-grid">
        {/* Trend card */}
        <div className="cei-card" style={{ maxWidth: "100%", overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.7rem",
            }}
          >
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                Portfolio energy trend – last 24 hours
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Hourly energy profile across all sites combined. Use this to
                spot peaks, troughs, and suspiciously flat baselines.
              </div>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              kWh · hourly
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
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              No recent series data. After you ingest CSV data or connect a live
              feed, CEI will chart the last 24 hours here.
            </div>
          ) : (
            <>
              {/* Local scroll container just for the chart */}
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
                        {/* numeric value for sanity check */}
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

        {/* Right-hand commentary / “what to look at today” */}
        <div className="cei-card">
          <div style={{ marginBottom: "0.6rem" }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
              What to pay attention to today
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              A lightweight, qualitative layer on top of the raw charts. This is
              where you turn charts into an action list for operations.
            </div>
          </div>

          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              fontSize: "0.84rem",
              color: "var(--cei-text-main)",
              lineHeight: 1.6,
            }}
          >
            <li>
              Check whether the overnight baseline looks flat and low. A rising
              baseline over time usually hides idle losses.
            </li>
            <li>
              Compare this 24-hour profile with a known &quot;good&quot; day.
              Look for new peaks or extended high-load zones.
            </li>
            <li>
              Use the <strong>Alerts</strong> page to see which sites are
              driving any abnormal consumption.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
