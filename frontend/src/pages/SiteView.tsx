import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getSites,
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

const SiteView: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [site, setSite] = useState<SiteRecord | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [series, setSeries] = useState<SeriesResponse | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Missing site id in URL.");
      return;
    }

    let isMounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // 1) Load all sites and find the one that matches the route param
        const siteList = await getSites();
        if (!isMounted) return;

        const normalized = Array.isArray(siteList)
          ? (siteList as SiteRecord[])
          : [];
        const found =
          normalized.find((s) => String(s.id) === String(id)) || null;
        setSite(found);

        const siteKey = `site-${String(id)}`;

        // 2) Load 24h summary and hourly series for this site
        const [summaryResp, seriesResp] = await Promise.all([
          getTimeseriesSummary({ site_id: siteKey, window_hours: 24 }),
          getTimeseriesSeries({
            site_id: siteKey,
            window_hours: 24,
            resolution: "hour",
          }),
        ]);

        if (!isMounted) return;

        setSummary(summaryResp as SummaryResponse);
        setSeries(seriesResp as SeriesResponse);
      } catch (e: any) {
        if (!isMounted) return;
        const msg =
          e?.response?.data?.detail ||
          e?.response?.data?.error ||
          e?.message ||
          "Failed to load site data.";
        setError(msg);
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const siteName = site?.name || (id ? `Site ${id}` : "Site");
  const siteLocation = site?.location || null;

  const totalKwh24h = summary?.total_value ?? 0;
  const points24h = summary?.points ?? 0;

  const formattedTotalKwh24h =
    totalKwh24h === 0
      ? "—"
      : totalKwh24h >= 1000
      ? `${(totalKwh24h / 1000).toFixed(2)} MWh`
      : `${totalKwh24h.toFixed(1)} kWh`;

  const hasSeries = series?.points && series.points.length > 0;

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
            {siteName}
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Site-level view built directly on CEI timeseries. This is your
            per-plant operational lens for energy and carbon performance.
          </p>
          {siteLocation && (
            <p
              style={{
                marginTop: "0.15rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Location: <strong>{siteLocation}</strong>
            </p>
          )}
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            textAlign: "right",
          }}
        >
          <div>Window: last 24 hours</div>
          <div>
            <span style={{ fontWeight: 500 }}>Site ID:</span> {id ?? "?"}
          </div>
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
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
            {loading ? "…" : formattedTotalKwh24h}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {loading
              ? "Loading per-site energy…"
              : points24h > 0
              ? `Aggregated from ${points24h.toLocaleString()} readings in the last ${
                  summary!.window_hours
                } hours.`
              : "No recent data for this site. Ensure your CSV uses matching site_id keys."}
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
              fontSize: "1.2rem",
              fontWeight: 600,
            }}
          >
            {loading
              ? "…"
              : points24h > 0
              ? `${points24h.toLocaleString()} points`
              : "No data in last 24h"}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Simple coverage indicator based on whether we see any timeseries for
            this site in the last 24 hours.
          </div>
        </div>
      </section>

      {/* Series table */}
      <section>
        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.7rem",
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
                Hourly energy – last 24 hours
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Hour-by-hour breakdown used today for validation. Later we can
                plug this into richer visualizations and anomaly detection.
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

          {loading && (
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

          {!loading && !hasSeries && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No hourly timeseries data available for this site in the last 24
              hours. Once ingest pipelines provide data, you&apos;ll see each
              hour listed here.
            </div>
          )}

          {!loading && hasSeries && (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Energy</th>
                  </tr>
                </thead>
                <tbody>
                  {series!.points.map((p, idx) => (
                    <tr key={`${p.ts}-${idx}`}>
                      <td>{p.ts}</td>
                      <td>{p.value.toFixed(2)} kWh</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default SiteView;
