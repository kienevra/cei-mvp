// frontend/src/pages/Dashboard.tsx
import React, { useEffect, useState } from "react";
import { getTimeseriesSummary, getTimeseriesSeries } from "../services/api";
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

const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Portfolio summary (all sites, last 24h)
    setSummaryLoading(true);
    setSummaryError(null);
    getTimeseriesSummary({ window_hours: 24 })
      .then((data) => {
        if (!isMounted) return;
        setSummary(data as SummaryResponse);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSummaryError(e?.message || "Failed to load portfolio summary.");
      })
      .finally(() => {
        if (!isMounted) return;
        setSummaryLoading(false);
      });

    // Portfolio series (all sites, last 24h, hourly)
    setSeriesLoading(true);
    setSeriesError(null);
    getTimeseriesSeries({
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

    return () => {
      isMounted = false;
    };
  }, []);

  const hasSummaryData = summary && summary.points > 0;
  const totalKwh = hasSummaryData ? summary!.total_value : 0;
  const formattedKwh = hasSummaryData
    ? totalKwh >= 1000
      ? `${(totalKwh / 1000).toFixed(2)} MWh`
      : `${totalKwh.toFixed(1)} kWh`
    : "—";

  // Build trend points for the bar chart
  let trendPoints: TrendPoint[] = [];
  if (series && series.points && series.points.length > 0) {
    trendPoints = series.points.map((p) => {
      const d = new Date(p.ts);
      const label = d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      return { label, value: p.value };
    });
  }

  const anyError = summaryError || seriesError;

  return (
    <div className="dashboard-page">
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
              fontSize: "1.3rem",
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
            High-level picture of energy and data health across all connected
            sites in the last 24 hours.
          </p>
        </div>
      </section>

      {/* Error banner (summary or series) */}
      {anyError && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner
            message={anyError}
            onClose={() => {
              setSummaryError(null);
              setSeriesError(null);
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
            {summaryLoading
              ? "Loading portfolio energy data…"
              : hasSummaryData
              ? `Aggregated from ${summary!.points.toLocaleString()} readings across all sites.`
              : "No recent timeseries data in the last 24 hours. Upload a CSV or connect a live feed to see this move."}
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
            Number of timeseries records available in the selected window.
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
            {hasSummaryData ? "Active data" : "Waiting for data"}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Simple heuristic status based on whether we see any portfolio
            readings in the last 24 hours.
          </div>
        </div>
      </section>

      {/* Main grid – trend + roadmap card */}
      <section className="dashboard-main-grid">
        {/* Trend chart */}
        <div className="cei-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.7rem",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Portfolio energy trend – last 24 hours
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                All sites combined, bucketed by hour. Uses the{" "}
                <code>/timeseries/series</code> endpoint.
              </div>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--cei-text-muted)",
              }}
            >
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

          {!seriesLoading && trendPoints.length === 0 ? (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No recent portfolio series data. Once you upload timeseries with
              timestamps in the last 24 hours, this chart will light up.
            </div>
          ) : (
            !seriesLoading && (
              <>
                <div
                  style={{
                    marginTop: "0.75rem",
                    padding: "0.75rem",
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(148, 163, 184, 0.5)",
                    background:
                      "radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), rgba(15, 23, 42, 0.95))",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      height: "180px",
                    }}
                  >
                    {trendPoints.map((p) => {
                      const values = trendPoints.map((t) =>
                        typeof t.value === "number" ? t.value : 0
                      );
                      const max = Math.max(...values, 1); // avoid divide-by-zero
                      const rawPct = (p.value / max) * 100;
                      const heightPct = Math.max(rawPct, 10); // at least 10% tall

                      return (
                        <div
                          key={p.label + p.value}
                          style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: "0.4rem",
                          }}
                        >
                          <div
                            style={{
                              width: "18px",
                              borderRadius: "999px",
                              background:
                                "linear-gradient(to top, rgba(56, 189, 248, 0.95), rgba(56, 189, 248, 0.25))",
                              height: `${heightPct}%`,
                              boxShadow: "0 6px 18px rgba(56, 189, 248, 0.45)",
                              border: "1px solid rgba(226, 232, 240, 0.8)",
                            }}
                          />
                          <span
                            style={{
                              fontSize: "0.7rem",
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

                {/* Optional debug list – leave for now while we’re validating */}
                <div
                  style={{
                    marginTop: "0.75rem",
                    fontSize: "0.75rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  <div style={{ marginBottom: "0.3rem" }}>
                    Raw points (debug view):
                  </div>
                  <ul style={{ listStyle: "disc", paddingLeft: "1.2rem" }}>
                    {series?.points.map((p, idx) => (
                      <li key={idx}>
                        {p.ts} – {p.value}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )
          )}
        </div>

        {/* Roadmap / explanation card */}
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.3rem",
            }}
          >
            What this view will evolve into
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              lineHeight: 1.5,
            }}
          >
            This dashboard is currently wired to real data from your uploaded
            CSVs. Next iterations will:
          </p>
          <ul
            style={{
              marginTop: "0.5rem",
              paddingLeft: "1.1rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              lineHeight: 1.5,
            }}
          >
            <li>Break down energy and CO₂ by site and asset class.</li>
            <li>Surface anomalies and inefficiencies directly from analytics.</li>
            <li>
              Tie alerts and reports back into this view so it becomes the
              single pane of glass for operations.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
