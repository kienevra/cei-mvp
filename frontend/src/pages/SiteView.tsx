// frontend/src/pages/SiteView.tsx
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getSite,
  getTimeseriesSummary,
  getTimeseriesSeries,
  getSiteInsights, // reserved for backend insights later
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

  const [site, setSite] = useState<SiteRecord | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

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

  const anyError = siteError || summaryError || seriesError;

  // Site-level efficiency suggestions card (frontend-only heuristics)
  const suggestions = buildSiteEfficiencySuggestions(
    hasSummaryData ? totalKwh : null,
    hasSummaryData ? summary!.points : null,
    site?.name || null
  );

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

      {/* Error banner */}
      {anyError && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner
            message={anyError}
            onClose={() => {
              setSiteError(null);
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
        <div
          className="cei-card"
          style={{ maxWidth: "100%", overflow: "hidden" }}
        >
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

          {!seriesLoading && !hasTrend ? (
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
                        heightPx =
                          baseBarHeightPx + ratio * maxBarHeightPx;
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
                            border:
                              "1px solid rgba(226, 232, 240, 0.8)",
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

      {/* Site-level efficiency opportunities card */}
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
              Efficiency opportunities for this site
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
