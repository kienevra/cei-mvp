import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getSite,
  getTimeseriesSummary,
  getTimeseriesSeries,
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
        console.log("Timeseries series for site", siteKey, data);
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

  const anyError = siteError || summaryError || seriesError;

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

          {/* Ultra-simple bar chart */}
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

              {/* Debug list of raw points – remove later if you want */}
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
    </div>
  );
};

export default SiteView;
