// frontend/src/pages/Dashboard.tsx
import React, { useEffect, useState } from "react";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { getTimeseriesSummary, getTimeseriesSeries } from "../services/api";

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

    // Portfolio summary – last 24h
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

    // Portfolio series – last 24h, hourly
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
        setSeriesError(e?.message || "Failed to load portfolio trend.");
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

  // Build trend points from series
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

  // Build human suggestions for “what to actually do”
  const suggestions = buildEfficiencySuggestions(
    hasSummaryData ? totalKwh : null,
    hasSummaryData ? summary!.points : null
  );

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
            High-level view of energy use across your CEI workspace. Use this to
            spot spikes, idle waste, and quick wins before drilling into sites.
          </p>
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            textAlign: "right",
          }}
        >
          <div>Window: last 24 hours</div>
          {summary?.from_timestamp && summary?.to_timestamp && (
            <div style={{ marginTop: "0.1rem" }}>
              <code>
                {summary.from_timestamp} → {summary.to_timestamp}
              </code>
            </div>
          )}
        </div>
      </section>

      {/* Error banner */}
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
            {hasSummaryData ? (
              <>
                Aggregated from{" "}
                <strong>{summary!.points.toLocaleString()} readings</strong> in
                the last {summary!.window_hours} hours across your workspace.
              </>
            ) : summaryLoading ? (
              "Loading portfolio energy data…"
            ) : (
              <>
                No recent data yet. Upload a CSV with{" "}
                <code>site_id</code> and <code>meter_id</code> to light this up.
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
            Number of timeseries records seen in the selected window. You’ll
            typically want consistent coverage across key meters.
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
            {hasSummaryData ? "Receiving data" : "Waiting for data"}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Simple heuristic view: if we see any records in the last 24 hours,
            the portfolio is considered active.
          </div>
        </div>
      </section>

      {/* Main grid: trend + meta */}
      <section className="dashboard-main-grid">
        {/* Trend chart card */}
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
                Aggregated series across all sites, grouped by hour. Use this to
                see when your plant really “lights up”.
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
              No recent series data. Once your timeseries is ingested, the
              portfolio profile will appear here.
            </div>
          ) : (
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
                    const heightPct = Math.max(rawPct, 10); // min bar height

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
            </>
          )}
        </div>

        {/* Simple meta / debug card */}
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
              Data window & context
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Quick technical context for the current dashboard view. Helpful
              when you’re validating pilots or debugging data quality.
            </div>
          </div>

          {summaryLoading ? (
            <div
              style={{
                padding: "1.2rem 0.5rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <LoadingSpinner />
            </div>
          ) : (
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
                  Window hours:
                </span>{" "}
                <span>{summary?.window_hours ?? "24"}</span>
              </div>
              <div>
                <span style={{ color: "var(--cei-text-muted)" }}>
                  Points in window:
                </span>{" "}
                <span>
                  {summary?.points
                    ? summary.points.toLocaleString()
                    : hasSummaryData
                    ? summary!.points.toLocaleString()
                    : "0"}
                </span>
              </div>
              <div>
                <span style={{ color: "var(--cei-text-muted)" }}>
                  From / to:
                </span>{" "}
                <span>
                  {summary?.from_timestamp && summary?.to_timestamp
                    ? `${summary.from_timestamp} → ${summary.to_timestamp}`
                    : "n/a"}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Efficiency opportunities – the “what do I do?” brain */}
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
              Efficiency opportunities (last 24 hours)
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Actionable ideas based on your current energy footprint. Use this
              as a starting point for conversations with operations and
              maintenance.
            </div>
          </div>

          {suggestions.length === 0 ? (
            <div
              style={{
                fontSize: "0.82rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No specific opportunities detected yet. Once more data is
              available, CEI will surface patterns worth acting on here.
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

function buildEfficiencySuggestions(
  totalKwh: number | null,
  points: number | null
): string[] {
  // No data or almost no data → focus on data quality & coverage
  if (points === null || points === 0) {
    return [
      "Verify that your CSV uploads include site_id, meter_id, timestamp, value, and unit for each row.",
      "Check that timestamps cover the last 24 hours – older historical data is useful, but won’t drive this view.",
      "Start with one or two critical meters (e.g. compressors, main incomers) and validate those signals before scaling up.",
    ];
  }

  const suggestions: string[] = [];

  if (totalKwh !== null) {
    if (totalKwh > 5000) {
      suggestions.push(
        "Identify which hours show the highest kWh and move non-critical loads out of those peak blocks.",
        "Run a short trial reducing baseline setpoints (temperatures, pressures, idle speeds) during off-peak hours and compare kWh per unit produced.",
        "Review weekend and night-shift consumption – look for large loads that remain energized with no production."
      );
    } else if (totalKwh > 1000) {
      suggestions.push(
        "Compare today’s profile with the last 7 days to spot days with unusual peaks or extended high-load periods.",
        "Check whether large batch processes are overlapping more than necessary and see if start times can be staggered.",
        "Look for flat, elevated overnight baselines that may indicate compressors, HVAC, or lighting left running."
      );
    } else {
      suggestions.push(
        "You’re running with relatively modest energy use; focus on preventing new peaks as production ramps up.",
        "Use CEI to watch for slow drifts in baseline consumption over the next few weeks (creeping standby losses)."
      );
    }
  }

  // Always-on strategic suggestions
  suggestions.push(
    "Tag key meters by process (e.g. 'compressors', 'HVAC', 'ovens') so future analytics can surface process-level opportunities.",
    "Schedule a weekly 15-minute review of this dashboard with operations to agree on one concrete action item.",
    "Capture before/after snapshots around any change (setpoint tweaks, maintenance, schedule shifts) so savings are quantified, not anecdotal."
  );

  return suggestions;
}

export default Dashboard;
