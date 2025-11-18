import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

const fallbackTrend: TrendPoint[] = [
  { label: "Mon", value: 90 },
  { label: "Tue", value: 95 },
  { label: "Wed", value: 110 },
  { label: "Thu", value: 120 },
  { label: "Fri", value: 130 },
  { label: "Sat", value: 80 },
  { label: "Sun", value: 75 },
];

const Dashboard: React.FC = () => {
  const [summary24h, setSummary24h] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const opportunities = [
    {
      id: 1,
      title: "Base load optimization",
      impact: "High",
      estSavings: "5–10% energy",
      site: "Multi-site",
    },
    {
      id: 2,
      title: "Peak-shaving strategy",
      impact: "Medium",
      estSavings: "3–5% demand charges",
      site: "Turin Plant A",
    },
    {
      id: 3,
      title: "Weekend shutdown policy",
      impact: "Medium",
      estSavings: "2–4% weekly",
      site: "Line-level",
    },
  ];

  useEffect(() => {
    let isMounted = true;

    // Summary
    setSummaryLoading(true);
    setSummaryError(null);
    getTimeseriesSummary({ window_hours: 24 })
      .then((data) => {
        if (!isMounted) return;
        setSummary24h(data as SummaryResponse);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setSummaryError(e?.message || "Failed to load energy summary.");
      })
      .finally(() => {
        if (!isMounted) return;
        setSummaryLoading(false);
      });

    // Series (for trend)
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

    return () => {
      isMounted = false;
    };
  }, []);

  const hasSummaryData = summary24h && summary24h.points > 0;
  const totalKwh = hasSummaryData ? summary24h!.total_value : 0;
  const formattedKwh = hasSummaryData
    ? totalKwh >= 1000
      ? `${(totalKwh / 1000).toFixed(2)} MWh`
      : `${totalKwh.toFixed(1)} kWh`
    : "--";

  // Normalize series -> TrendPoint[]
  let trendPoints: TrendPoint[] = fallbackTrend;
  if (series && series.points && series.points.length > 0) {
    trendPoints = series.points.map((p) => {
      const d = new Date(p.ts);
      let label: string;
      if (series.resolution === "day") {
        label = d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
      } else {
        // hour
        label = d.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return {
        label,
        value: p.value,
      };
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
            Overview
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
              maxWidth: "40rem",
            }}
          >
            High-level view of energy and CO₂ performance across all monitored
            sites. Key metrics on this card are powered directly by your{" "}
            <strong>timeseries_records</strong> data.
          </p>
        </div>
      </section>

      {/* Error banner if any dashboard call failed */}
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
        {/* Real KPI – last 24h energy */}
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
                <strong>
                  {summary24h!.points.toLocaleString()} readings
                </strong>{" "}
                in the last {summary24h!.window_hours} hours.
              </>
            ) : summaryLoading ? (
              "Loading data from the last 24 hours…"
            ) : (
              <>
                No data in the last 24 hours. Try uploading a CSV on the{" "}
                <Link
                  to="/upload"
                  style={{ color: "var(--cei-text-accent)" }}
                >
                  data upload page
                </Link>
                .
              </>
            )}
          </div>
        </div>

        {/* Placeholder KPI – CO₂ (future) */}
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}
          >
            CO₂ emissions (estimated)
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.6rem",
              fontWeight: 600,
            }}
          >
            —
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            We&apos;ll derive CO₂e from metered energy using your emission
            factors once those are configured. For now this is a placeholder.
          </div>
        </div>

        {/* Placeholder KPI – Opportunities */}
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}
          >
            Active opportunities
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.6rem",
              fontWeight: 600,
            }}
          >
            3
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Placeholder count from the mock opportunity list. We&apos;ll wire
            this to a real opportunities endpoint as the engine matures.
          </div>
        </div>
      </section>

      {/* Main grid: trend + opportunities */}
      <section className="dashboard-main-grid">
        {/* Trend card */}
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
                If data is available, this chart is based on your actual
                timeseries records. Otherwise we show a fallback pattern.
              </div>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--cei-text-muted)",
              }}
            >
              kWh · per bucket
            </div>
          </div>

          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              alignItems: "flex-end",
              gap: "0.5rem",
              height: "170px",
            }}
          >
            {trendPoints.map((p) => {
              const max = Math.max(...trendPoints.map((t) => t.value || 0.0001));
              const heightPct = max > 0 ? (p.value / max) * 100 : 0;
              return (
                <div
                  key={p.label + p.value}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "0.35rem",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      borderRadius: "999px",
                      background:
                        "linear-gradient(to top, rgba(56, 189, 248, 0.85), rgba(56, 189, 248, 0.12))",
                      height: `${heightPct}%`,
                      boxShadow: "0 4px 12px rgba(56, 189, 248, 0.3)",
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

          {seriesLoading && (
            <div
              style={{
                marginTop: "0.6rem",
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Updating trend from latest readings…
            </div>
          )}
        </div>

        {/* Opportunities card */}
        <div className="cei-card">
          <div style={{ marginBottom: "0.6rem" }}>
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Portfolio opportunities
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              High-level view of where CEI expects savings potential.
              Currently mocked until the analytics engine is wired in.
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                style={{
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  background:
                    "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.7))",
                  padding: "0.6rem 0.7rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.85rem",
                      fontWeight: 500,
                    }}
                  >
                    {opp.title}
                  </div>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "0.15rem 0.55rem",
                      borderRadius: "999px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background:
                        opp.impact === "High"
                          ? "rgba(248, 113, 113, 0.18)"
                          : opp.impact === "Medium"
                          ? "rgba(234, 179, 8, 0.15)"
                          : "rgba(148, 163, 184, 0.18)",
                      color:
                        opp.impact === "High"
                          ? "#fecaca"
                          : opp.impact === "Medium"
                          ? "#facc15"
                          : "#e5e7eb",
                    }}
                  >
                    {opp.impact}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: "0.25rem",
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Est. savings: {opp.estSavings}
                </div>
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.72rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Site scope:{" "}
                  <span style={{ color: "var(--cei-text-main)" }}>
                    {opp.site}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Loader pill on initial load */}
      {(summaryLoading || seriesLoading) && !summary24h && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-end",
            padding: "1.5rem",
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(15,23,42,0.9)",
              borderRadius: "999px",
              padding: "0.3rem 0.8rem",
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              fontSize: "0.78rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <LoadingSpinner />
            <span>Refreshing latest energy metrics…</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
