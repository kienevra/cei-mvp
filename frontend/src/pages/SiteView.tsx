// frontend/src/pages/SiteView.tsx
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getSite,
  getTimeseriesSummary,
  getTimeseriesSeries,
  getSiteInsights,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

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

// Shape of insights from backend – defensive/optional
type SiteInsightsOpportunity = {
  id?: string;
  title?: string;
  summary?: string;
  impact_estimate_kwh_per_year?: number | null;
  impact_estimate_pct?: number | null;
  confidence?: string | null;
  category?: string | null;
};

type SiteInsightsBenchmark = {
  metric_name?: string;
  value?: number;
  benchmark?: number | null;
  percent_of_benchmark?: number | null;
  flagged?: boolean;
  recommendation?: string;
};

type SiteInsights = {
  site_id?: number | string;
  window_days?: number;
  kpis?: {
    energy_kwh?: number;
    avg_power_kw?: number;
    peak_kw?: number;
    load_factor?: number | null;
    window_hours?: number;
    window_start?: string;
    window_end?: string;
  };
  benchmark?: SiteInsightsBenchmark | null;
  anomalies?: {
    method?: string;
    anomaly_indices?: number[];
    anomalies?: number[];
  } | null;
  opportunities?: SiteInsightsOpportunity[];
};

const SiteView: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  const [site, setSite] = useState<SiteRecord | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  // New: site-level insights from backend analytics
  const [insights, setInsights] = useState<SiteInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

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

    // New: per-site analytics insights (e.g. 7-day window)
    setInsightsLoading(true);
    setInsightsError(null);
    getSiteInsights(id, 7)
      .then((data) => {
        if (!isMounted) return;
        setInsights(data as SiteInsights);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setInsightsError(e?.message || "Failed to load site insights.");
      })
      .finally(() => {
        if (!isMounted) return;
        setInsightsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, siteKey]);

  const hasSummaryData = summary && summary.points > 0;
  const totalKwh = hasSummaryData ? summary!.total_value : 0;
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
      });
      return { label, value: p.value };
    });
  }

  const anyError = siteError || summaryError || seriesError || insightsError;

  // Precompute max value once for chart
  const trendMaxValue =
    trendPoints.length > 0
      ? Math.max(...trendPoints.map((t) => (typeof t.value === "number" ? t.value : 0)), 1)
      : 1;

  // --- Insights: benchmark + opportunities ---

  const benchmark = insights?.benchmark || null;
  const benchmarkPct = benchmark?.percent_of_benchmark ?? null;
  const benchmarkFlagged = !!benchmark?.flagged;

  let benchmarkPillClass = "cei-pill-info";
  let benchmarkLabel = "No benchmark yet";
  if (benchmarkPct !== null) {
    if (benchmarkPct >= 130) {
      benchmarkPillClass = "cei-pill-critical";
      benchmarkLabel = `${benchmarkPct.toFixed(0)}% of baseline · critical`;
    } else if (benchmarkPct >= 110) {
      benchmarkPillClass = "cei-pill-warning";
      benchmarkLabel = `${benchmarkPct.toFixed(0)}% of baseline · above baseline`;
    } else {
      benchmarkPillClass = "cei-pill-info";
      benchmarkLabel = `${benchmarkPct.toFixed(0)}% of baseline · within range`;
    }
  }

  const opportunitiesRaw = insights?.opportunities || [];
  const topOpportunities = opportunitiesRaw.slice(0, 3);

  // Fallback: heuristic suggestions if we don't yet have structured opportunities
  const heuristicSuggestions = buildSiteEfficiencySuggestions(
    hasSummaryData ? totalKwh : null,
    hasSummaryData ? summary!.points : null,
    site?.name || null
  );

  const hasStructuredOpps = topOpportunities.length > 0;

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
          }}
        >
          {site?.location && (
            <div>
              <span style={{ fontWeight: 500 }}>Location:</span>{" "}
              {site.location}
            </div>
          )}
          <div>
            <span style={{ fontWeight: 500 }}>Site ID:</span> {id}
          </div>
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
                No recent data for this site. Ensure your uploaded timeseries
                includes <code>site_id = {siteKey}</code>.
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

      {/* Main grid: trend + metadata */}
      <section className="dashboard-main-grid">
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
              No recent per-site series data. Once your timeseries has matching{" "}
              <code>site_id = {siteKey}</code>, this chart will light up.
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
                    const rawPct = (p.value / trendMaxValue) * 100;
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

              {/* Debug list of raw points – optional */}
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

      {/* Site-level efficiency opportunities card (tightened) */}
      <section>
        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.6rem",
              display: "flex",
              justifyContent: "space-between",
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
                Efficiency opportunities for this site
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Based on the recent energy profile and CEI baseline for this
                type of site.
              </div>
            </div>

            {/* Benchmark pill */}
            <div className={benchmarkPillClass}>
              {benchmarkPct === null ? "No baseline yet" : benchmarkLabel}
            </div>
          </div>

          {insightsLoading && (
            <div
              style={{
                padding: "0.8rem 0.3rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <LoadingSpinner />
            </div>
          )}

          {!insightsLoading && hasStructuredOpps && (
            <>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "1.1rem",
                  fontSize: "0.84rem",
                  color: "var(--cei-text-main)",
                  lineHeight: 1.5,
                }}
              >
                {topOpportunities.map((opp, idx) => {
                  const title = opp.title || "Efficiency opportunity";
                  const summary = opp.summary || "";
                  const impactKwh = opp.impact_estimate_kwh_per_year ?? null;
                  const impactPct = opp.impact_estimate_pct ?? null;
                  const confidence = opp.confidence || "";
                  const chipLabel =
                    confidence || opp.category || (benchmarkFlagged ? "High priority" : "");

                  let impactText = "";
                  if (impactKwh !== null && impactKwh > 0) {
                    const prettyKwh =
                      impactKwh >= 1000
                        ? `${(impactKwh / 1000).toFixed(1)} MWh/year`
                        : `${impactKwh.toFixed(0)} kWh/year`;
                    impactText = prettyKwh;
                  }
                  if (impactPct !== null && impactPct > 0) {
                    impactText = impactText
                      ? `${impactText} · ~${impactPct.toFixed(1)}% of site use`
                      : `~${impactPct.toFixed(1)}% of site use`;
                  }

                  return (
                    <li key={idx} style={{ marginBottom: "0.6rem" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: "0.75rem",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 500,
                            fontSize: "0.88rem",
                          }}
                        >
                          {title}
                        </div>
                        {chipLabel && (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              color: "var(--cei-text-muted)",
                            }}
                          >
                            {chipLabel}
                          </span>
                        )}
                      </div>
                      {summary && (
                        <div
                          style={{
                            marginTop: "0.15rem",
                            fontSize: "0.82rem",
                            color: "var(--cei-text-muted)",
                          }}
                        >
                          {summary}
                        </div>
                      )}
                      {impactText && (
                        <div
                          style={{
                            marginTop: "0.15rem",
                            fontSize: "0.8rem",
                            color: "var(--cei-text-accent)",
                          }}
                        >
                          {impactText}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* Fallback: heuristic suggestions if no structured opps yet */}
          {!insightsLoading && !hasStructuredOpps && (
            <div
              style={{
                marginTop: "0.2rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.82rem",
                  color: "var(--cei-text-muted)",
                  marginBottom: "0.3rem",
                }}
              >
                CEI doesn&apos;t have enough pattern history at this site yet to
                surface specific quantified actions. In the meantime, use these
                targeted checks as a starting point:
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "1.1rem",
                  fontSize: "0.84rem",
                  color: "var(--cei-text-main)",
                  lineHeight: 1.5,
                }}
              >
                {heuristicSuggestions.map((s, idx) => (
                  <li key={idx} style={{ marginBottom: "0.3rem" }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
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
      `Confirm that uploads for ${name} include a consistent site_id (e.g. "${name}" or "site-1") in every row.`,
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
