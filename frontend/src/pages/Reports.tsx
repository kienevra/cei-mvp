// frontend/src/pages/Reports.tsx
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
  name: string;
  location?: string | null;
  totalKwh: number;
  points: number;
  windowHours: number;
  fromTs: string | null;
  toTs: string | null;
};

const HOURS_7_DAYS = 24 * 7;

const Reports: React.FC = () => {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [reports, setReports] = useState<SiteReportRow[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setError(null);
      setLoadingSites(true);
      setLoadingReports(true);

      try {
        // 1) Load sites
        const data = await getSites();
        if (!isMounted) return;

        const siteList = Array.isArray(data) ? (data as SiteRecord[]) : [];
        setSites(siteList);

        if (siteList.length === 0) {
          setReports([]);
          return;
        }

        // 2) For each site, fetch 7-day summary
        const summaries = await Promise.all(
          siteList.map(async (site) => {
            const idStr = String(site.id);
            const siteKey = `site-${idStr}`;

            try {
              const summary = (await getTimeseriesSummary({
                site_id: siteKey,
                window_hours: HOURS_7_DAYS,
              })) as SummaryResponse;

              return {
                ok: true as const,
                site,
                summary,
              };
            } catch (e: any) {
              return {
                ok: false as const,
                site,
                error:
                  e?.message ||
                  `Failed to load 7-day summary for site ${site.name || idStr}`,
              };
            }
          })
        );

        if (!isMounted) return;

        const rows: SiteReportRow[] = [];
        const errorMessages: string[] = [];

        for (const item of summaries) {
          const idStr = String(item.site.id);

          if (!item.ok || !item.summary) {
            errorMessages.push(
              item.error ||
                `Unknown error loading summary for site ${item.site.name || idStr}`
            );
            continue;
          }

          const s = item.summary;
          const total = typeof s.total_value === "number" ? s.total_value : 0;
          const points = typeof s.points === "number" ? s.points : 0;

          rows.push({
            siteId: idStr,
            name: item.site.name || `Site ${idStr}`,
            location: item.site.location,
            totalKwh: total,
            points,
            windowHours: s.window_hours || HOURS_7_DAYS,
            fromTs: s.from_timestamp,
            toTs: s.to_timestamp,
          });
        }

        setReports(rows);

        // If some sites failed, surface a compact error
        if (errorMessages.length > 0) {
          setError(
            `Some site summaries failed to load: ${errorMessages
              .slice(0, 3)
              .join(" | ")}`
          );
        }
      } catch (e: any) {
        if (!isMounted) return;
        setError(e?.message || "Failed to load 7-day portfolio report.");
      } finally {
        if (!isMounted) return;
        setLoadingSites(false);
        setLoadingReports(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  const loading = loadingSites || loadingReports;
  const hasSites = sites.length > 0;
  const hasReports = reports.length > 0;

  const formatEnergy = (kwh: number): string => {
    if (kwh <= 0) return "—";
    if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
    return `${kwh.toFixed(1)} kWh`;
  };

  const computeStatus = (row: SiteReportRow): string => {
    if (row.points === 0 || row.totalKwh === 0) return "No recent data";
    if (row.points < 24) return "Sparse coverage";
    return "Healthy coverage";
  };

  const formatWindow = (row: SiteReportRow): string => {
    if (!row.fromTs || !row.toTs) {
      return `Last ${row.windowHours} hours`;
    }

    const from = new Date(row.fromTs);
    const to = new Date(row.toTs);

    const fromStr = from.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
    const toStr = to.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });

    return `${fromStr} → ${toStr}`;
  };

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
            7-day portfolio report
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Rolling 7-day view of energy and data coverage per site. Use this
            as a weekly executive summary before diving into individual
            dashboards.
          </p>
        </div>
        <div
          style={{
            textAlign: "right",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          {hasSites ? (
            <div>
              Reporting on <strong>{sites.length}</strong> site
              {sites.length === 1 ? "" : "s"}.
            </div>
          ) : (
            <div>No sites detected yet.</div>
          )}
          <div>Window: last 7 days (168 hours)</div>
        </div>
      </section>

      {/* Error banner (if any) */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      {/* Main card */}
      <section style={{ marginTop: "0.9rem" }}>
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
                Site-level weekly summary
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                For each site, CEI aggregates the last 168 hours of data into a
                simple report: total energy, data coverage, and a quick status
                flag. Click any site name to open its full dashboard.
              </div>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--cei-text-muted)",
                textAlign: "right",
              }}
            >
              Metrics derived from{" "}
              <code>/timeseries/summary?window_hours=168</code>.
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

          {!loading && !hasSites && !error && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No sites available yet. Start by{" "}
              <Link to="/upload" style={{ color: "var(--cei-text-accent)" }}>
                uploading a CSV
              </Link>{" "}
              with a <code>site_id</code> column, then refresh this page.
            </div>
          )}

          {!loading && hasSites && !hasReports && !error && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Sites are registered, but we haven&apos;t seen recent timeseries
              in the last 7 days. Try expanding the window on individual site
              dashboards or ingest new CSV data.
            </div>
          )}

          {!loading && hasReports && (
            <div style={{ marginTop: "0.4rem", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="hide-on-mobile">Location</th>
                    <th>7-day energy</th>
                    <th>Points</th>
                    <th>Status</th>
                    <th className="hide-on-mobile">Data window</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((row) => (
                    <tr key={row.siteId}>
                      <td>
                        <Link
                          to={`/sites/${row.siteId}`}
                          style={{
                            color: "var(--cei-text-accent)",
                            textDecoration: "none",
                          }}
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="hide-on-mobile">
                        {row.location || "—"}
                      </td>
                      <td>{formatEnergy(row.totalKwh)}</td>
                      <td>{row.points.toLocaleString()}</td>
                      <td>{computeStatus(row)}</td>
                      <td className="hide-on-mobile">
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--cei-text-muted)",
                          }}
                        >
                          {formatWindow(row)}
                        </span>
                      </td>
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
