import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getSites,
  getTimeseriesSummary,
  getAccountMe,
  getSiteInsights, // <-- typed to accept 1–2 args
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

type SiteReportRow = {
  siteId: string;
  siteName: string;
  location?: string | null;
  totalKwh7d: number;
  points7d: number;
  avgPerPoint7d: number | null;
  // statistical enrichments from analytics insights (7-day window)
  deviationPct7d: number | null;
  expectedKwh7d: number | null;
  criticalHours7d: number | null;
  elevatedHours7d: number | null;
  belowBaselineHours7d: number | null;
  baselineDays7d: number | null;
  statsSource: string | null;
};

const Reports: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [portfolioSummary, setPortfolioSummary] =
    useState<SummaryResponse | null>(null);
  const [siteRows, setSiteRows] = useState<SiteReportRow[]>([]);

  // Plan flags coming from /auth/me
  const [planKey, setPlanKey] = useState<string>("cei-starter");
  const [enableReports, setEnableReports] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function loadReport() {
      setLoading(true);
      setError(null);

      try {
        // 0) Pull account + plan flags
        const account = await getAccountMe().catch(() => null);

        if (!isMounted) return;

        const org =
          (account?.org as any) ??
          (account?.organization as any) ??
          null;

        const derivedPlanKey: string =
          org?.subscription_plan_key ||
          org?.plan_key ||
          account?.subscription_plan_key ||
          "cei-starter";

        // Backend might already send explicit flags; if not, derive from plan
        const backendEnableReports: boolean | undefined =
          account?.enable_reports ?? org?.enable_reports;

        const effectiveEnableReports =
          typeof backendEnableReports === "boolean"
            ? backendEnableReports
            : derivedPlanKey === "cei-starter" ||
              derivedPlanKey === "cei-growth";

        setPlanKey(derivedPlanKey);
        setEnableReports(effectiveEnableReports);

        // If the plan doesn't include reports, stop here:
        if (!effectiveEnableReports) {
          setLoading(false);
          return;
        }

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

        // 3) Per-site summaries + statistical insights (7-day window)
        const siteSummaries = await Promise.all(
          normalizedSites.map(async (site) => {
            const idStr = String(site.id);
            const siteKey = `site-${idStr}`;

            let summary: SummaryResponse | null = null;
            let insights: any | null = null;

            try {
              summary = (await getTimeseriesSummary({
                site_id: siteKey,
                window_hours: 168,
              })) as SummaryResponse;
            } catch (_e: any) {
              summary = null;
            }

            try {
              // only pass 2 args (siteId, window_hours), rely on backend default lookback_days
              insights = await getSiteInsights(siteKey, 168).catch(
                () => null
              );
            } catch (_e) {
              insights = null;
            }

            return { site, summary, insights };
          })
        );

        if (!isMounted) return;

        const rows: SiteReportRow[] = siteSummaries.map(
          ({ site, summary, insights }) => {
            const idStr = String(site.id);
            const total = summary?.total_value || 0;
            const points = summary?.points || 0;
            const avgPerPoint =
              points > 0 ? total / points : null;

            const deviationPct7d =
              typeof insights?.deviation_pct === "number"
                ? Number.isFinite(insights.deviation_pct)
                  ? insights.deviation_pct
                  : null
                : null;

            const expectedKwh7d =
              typeof insights?.total_expected_kwh === "number"
                ? Number.isFinite(insights.total_expected_kwh)
                  ? insights.total_expected_kwh
                  : null
                : null;

            const criticalHours7d =
              typeof insights?.critical_hours === "number"
                ? insights.critical_hours
                : null;

            const elevatedHours7d =
              typeof insights?.elevated_hours === "number"
                ? insights.elevated_hours
                : null;

            const belowBaselineHours7d =
              typeof insights?.below_baseline_hours === "number"
                ? insights.below_baseline_hours
                : null;

            const baselineDays7d =
              typeof insights?.baseline_lookback_days === "number"
                ? insights.baseline_lookback_days
                : null;

            const statsSource =
              typeof insights?.stats_source === "string"
                ? insights.stats_source
                : null;

            return {
              siteId: idStr,
              siteName: site.name || `Site ${idStr}`,
              location: site.location,
              totalKwh7d: total,
              points7d: points,
              avgPerPoint7d: avgPerPoint,
              deviationPct7d,
              expectedKwh7d,
              criticalHours7d,
              elevatedHours7d,
              belowBaselineHours7d,
              baselineDays7d,
              statsSource,
            };
          }
        );

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

  const handleDownloadCsv = () => {
    if (!enableReports) {
      alert("Reports are not enabled for this plan.");
      return;
    }
    if (!siteRows.length) {
      alert("No site data available to export yet.");
      return;
    }

    const header = [
      "site_id",
      "site_name",
      "location",
      "total_kwh_7d",
      "points_7d",
      "avg_kwh_per_point_7d",
      "deviation_pct_7d",
      "expected_kwh_7d",
      "critical_hours_7d",
      "elevated_hours_7d",
      "below_baseline_hours_7d",
      "baseline_lookback_days_7d",
      "stats_source",
    ];

    const lines = [header.join(",")];

    for (const row of siteRows) {
      const cells = [
        row.siteId,
        row.siteName.replace(/,/g, " "),
        (row.location || "").replace(/,/g, " "),
        row.totalKwh7d.toFixed(2),
        row.points7d.toString(),
        row.avgPerPoint7d !== null
          ? row.avgPerPoint7d.toFixed(4)
          : "",
        row.deviationPct7d !== null
          ? row.deviationPct7d.toFixed(2)
          : "",
        row.expectedKwh7d !== null
          ? row.expectedKwh7d.toFixed(2)
          : "",
        row.criticalHours7d !== null
          ? row.criticalHours7d.toString()
          : "",
        row.elevatedHours7d !== null
          ? row.elevatedHours7d.toString()
          : "",
        row.belowBaselineHours7d !== null
          ? row.belowBaselineHours7d.toString()
          : "",
        row.baselineDays7d !== null
          ? row.baselineDays7d.toString()
          : "",
        row.statsSource || "",
      ];
      lines.push(cells.join(","));
    }

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "cei_7day_site_reports.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
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
            timeseries engine and its learned baselines.
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

      {/* Upgrade gating banner */}
      {!loading && !enableReports && (
        <section style={{ marginTop: "0.9rem" }}>
          <div
            className="cei-card"
            style={{
              border: "1px solid rgba(250,204,21,0.7)",
              background:
                "linear-gradient(135deg, rgba(30,64,175,0.7), rgba(15,23,42,0.95))",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Upgrade to unlock portfolio reports
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                  maxWidth: "40rem",
                }}
              >
                Your current plan (<code>{planKey}</code>) does not include
                the 7-day portfolio reporting layer. Upgrade to CEI Starter
                or above to see fleet-level KPIs, per-site tables, and
                export-ready summaries.
              </div>
              <div
                style={{
                  marginTop: "0.4rem",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <Link to="/account">
                  <button className="cei-btn cei-btn-primary">
                    View plans &amp; billing
                  </button>
                </Link>
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Reports will light up automatically as soon as your
                  subscription is active.
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* KPI row – only when reports are enabled */}
      {enableReports && (
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
              Aggregated energy consumption across all sites over the last
              168 hours. Points:{" "}
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
              Number of sites reporting at least one timeseries point in the
              last week.
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
      )}

      {/* Main table – only when reports are enabled */}
      {enableReports && (
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
                  Per-site energy, point counts, and deviation vs baseline
                  over the last week. This is the backbone for exportable
                  operational reports.
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="cei-btn cei-btn-ghost"
                  onClick={handleDownloadCsv}
                  disabled={loading || !siteRows.length}
                >
                  {loading ? "Preparing…" : "Download CSV"}
                </button>
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
                No sites available yet. Once sites and timeseries are
                configured, this table will populate with 7-day energy
                metrics per site.
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
                      <th>Energy / point</th>
                      <th>Deviation vs baseline</th>
                      <th>Expected (7 days)</th>
                      <th>Baseline hours (crit / warn / below)</th>
                      <th>Stats</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {siteRows.map((row) => {
                      const deviationLabel =
                        row.deviationPct7d !== null
                          ? `${row.deviationPct7d.toFixed(1)}%`
                          : "—";

                      const expectedLabel =
                        row.expectedKwh7d !== null
                          ? row.expectedKwh7d >= 1000
                            ? `${(row.expectedKwh7d / 1000).toFixed(
                                2
                              )} MWh`
                            : `${row.expectedKwh7d.toFixed(1)} kWh`
                          : "—";

                      const critLabel =
                        row.criticalHours7d !== null
                          ? row.criticalHours7d
                          : 0;
                      const elevLabel =
                        row.elevatedHours7d !== null
                          ? row.elevatedHours7d
                          : 0;
                      const belowLabel =
                        row.belowBaselineHours7d !== null
                          ? row.belowBaselineHours7d
                          : 0;

                      return (
                        <tr key={row.siteId}>
                          <td>{row.siteName}</td>
                          <td>{row.location || "—"}</td>
                          <td>
                            {row.totalKwh7d > 0
                              ? `${row.totalKwh7d.toFixed(1)} kWh`
                              : "—"}
                          </td>
                          <td>
                            {row.points7d > 0 ? row.points7d : "—"}
                          </td>
                          <td>
                            {row.avgPerPoint7d !== null
                              ? `${row.avgPerPoint7d.toFixed(2)} kWh`
                              : "—"}
                          </td>
                          <td>{deviationLabel}</td>
                          <td>{expectedLabel}</td>
                          <td>
                            {critLabel === 0 &&
                            elevLabel === 0 &&
                            belowLabel === 0
                              ? "—"
                              : `Crit: ${critLabel}, Warn: ${elevLabel}, Below: ${belowLabel}`}
                          </td>
                          <td>
                            {row.statsSource || row.baselineDays7d !== null ? (
                              <>
                                {row.statsSource && (
                                  <code>{row.statsSource}</code>
                                )}
                                {row.baselineDays7d !== null && (
                                  <span
                                    style={{
                                      marginLeft: "0.25rem",
                                      opacity: 0.8,
                                    }}
                                  >
                                    ({row.baselineDays7d} d)
                                  </span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default Reports;
