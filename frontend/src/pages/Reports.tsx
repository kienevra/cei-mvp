import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSites, getTimeseriesSummary } from "../services/api";
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

type SiteReportRow = {
  siteId: string;
  siteName: string;
  location?: string | null;
  totalKwh7d: number;
  points7d: number;
};

const Reports: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [portfolioSummary, setPortfolioSummary] =
    useState<SummaryResponse | null>(null);
  const [siteRows, setSiteRows] = useState<SiteReportRow[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadReport() {
      setLoading(true);
      setError(null);

      try {
        // 1) Fetch sites
        const siteList = await getSites();
        if (!isMounted) return;

        const normalizedSites = Array.isArray(siteList)
          ? (siteList as SiteRecord[])
          : [];
        setSites(normalizedSites);

        // 2) Portfolio summary – all sites, last 7 days (168 hours)
        const portfolio = (await getTimeseriesSummary({
          window_hours: 168,
        })) as SummaryResponse;
        if (!isMounted) return;
        setPortfolioSummary(portfolio);

        // 3) Per-site summaries
        const siteSummaries = await Promise.all(
          normalizedSites.map(async (site) => {
            const idStr = String(site.id);
            const siteKey = `site-${idStr}`;

            try {
              const summary = (await getTimeseriesSummary({
                site_id: siteKey,
                window_hours: 168,
              })) as SummaryResponse;
              return { site, summary, error: null as string | null };
            } catch (e: any) {
              return {
                site,
                summary: null,
                error:
                  e?.message ||
                  `Failed to load 7-day summary for site ${site.name || idStr}`,
              };
            }
          })
        );

        if (!isMounted) return;

        const rows: SiteReportRow[] = siteSummaries.map(({ site, summary }) => {
          const idStr = String(site.id);
          const total = summary?.total_value || 0;
          const points = summary?.points || 0;

          return {
            siteId: idStr,
            siteName: site.name || `Site ${idStr}`,
            location: site.location,
            totalKwh7d: total,
            points7d: points,
          };
        });

        setSiteRows(rows);
      } catch (e: any) {
        if (!isMounted) return;
        setError(e?.message || "Failed to load reports.");
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    loadReport();

    return () => {
      isMounted = false;
    };
  }, []);

  const totalSites = sites.length;
  const totalKwh7d = portfolioSummary?.total_value || 0;
  const totalPoints7d = portfolioSummary?.points || 0;

  const formattedTotalKwh7d =
    totalKwh7d === 0
      ? "—"
      : totalKwh7d >= 1000
      ? `${(totalKwh7d / 1000).toFixed(2)} MWh`
      : `${totalKwh7d.toFixed(1)} kWh`;

  const avgPerSite =
    totalSites > 0 ? totalKwh7d / Math.max(totalSites, 1) : 0;
  const formattedAvgPerSite =
    avgPerSite === 0
      ? "—"
      : avgPerSite >= 1000
      ? `${(avgPerSite / 1000).toFixed(2)} MWh`
      : `${avgPerSite.toFixed(1)} kWh`;

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
            Reports
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Portfolio snapshot for the last 7 days. This is your first
            production-ready report layer built directly on top of the CEI
            timeseries engine.
          </p>
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            textAlign: "right",
          }}
        >
          <div>Window: last 7 days (168 hours)</div>
          {totalSites > 0 && (
            <div>
              Sites: <strong>{totalSites}</strong>
            </div>
          )}
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
            Portfolio energy – last 7 days
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.6rem",
              fontWeight: 600,
            }}
          >
            {loading ? "…" : formattedTotalKwh7d}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Aggregated energy consumption across all sites over the last 168
            hours. Points:{" "}
            {loading ? "…" : totalPoints7d > 0 ? totalPoints7d : "—"}
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
            Sites with data
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.4rem",
              fontWeight: 600,
            }}
          >
            {loading
              ? "…"
              : siteRows.filter((r) => r.points7d > 0).length || "0"}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Number of sites reporting at least one timeseries point in the last
            week.
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
            Avg energy per site – 7 days
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.4rem",
              fontWeight: 600,
            }}
          >
            {loading ? "…" : formattedAvgPerSite}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Simple average of portfolio energy divided by monitored sites.
          </div>
        </div>
      </section>

      {/* Main table */}
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
                Site-level 7-day energy
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Per-site energy and point counts over the last week. This is the
                backbone for exportable operational reports.
              </div>
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

          {!loading && siteRows.length === 0 && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No sites available yet. Once sites and timeseries are configured,
              this table will populate with 7-day energy metrics per site.
            </div>
          )}

          {!loading && siteRows.length > 0 && (
            <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Location</th>
                    <th>Energy (7 days)</th>
                    <th>Points</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {siteRows.map((row) => (
                    <tr key={row.siteId}>
                      <td>{row.siteName}</td>
                      <td>{row.location || "—"}</td>
                      <td>
                        {row.totalKwh7d > 0
                          ? `${row.totalKwh7d.toFixed(1)} kWh`
                          : "—"}
                      </td>
                      <td>{row.points7d > 0 ? row.points7d : "—"}</td>
                      <td>
                        <Link
                          to={`/sites/${row.siteId}`}
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--cei-text-accent)",
                            textDecoration: "none",
                          }}
                        >
                          View site →
                        </Link>
                      </td>
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

export default Reports;
