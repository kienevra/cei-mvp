// frontend/src/pages/Alerts.tsx
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

type AlertSeverity = "critical" | "warning" | "info";

type AlertItem = {
  id: string; // synthetic alert id
  siteId: string;
  siteName: string;
  location?: string | null;
  severity: AlertSeverity;
  message: string;
  totalKwh: number;
  points: number;
};

const Alerts: React.FC = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sites, setSites] = useState<SiteRecord[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadAlerts() {
      setLoading(true);
      setError(null);

      try {
        // 1) Get sites
        const siteList = await getSites();
        if (!isMounted) return;

        const normalizedSites = Array.isArray(siteList)
          ? (siteList as SiteRecord[])
          : [];

        setSites(normalizedSites);

        if (normalizedSites.length === 0) {
          setAlerts([]);
          return;
        }

        // 2) For each site, fetch last 24h summary (using site-{id} key)
        const results = await Promise.all(
          normalizedSites.map(async (site) => {
            const idStr = String(site.id);
            const siteKey = `site-${idStr}`;

            try {
              const summary = (await getTimeseriesSummary({
                site_id: siteKey,
                window_hours: 24,
              })) as SummaryResponse;

              return { site, summary, error: null as string | null };
            } catch (e: any) {
              console.error("Failed to load summary for site", site, e);
              return {
                site,
                summary: null,
                error:
                  e?.message ||
                  `Failed to load summary for site ${site.name || idStr}`,
              };
            }
          })
        );

        if (!isMounted) return;

        // 3) Build alert list based on simple rules
        const builtAlerts: AlertItem[] = [];

        for (const { site, summary, error: siteErr } of results) {
          const idStr = String(site.id);

          if (siteErr || !summary) {
            builtAlerts.push({
              id: `site-${idStr}-error`,
              siteId: idStr,
              siteName: site.name || `Site ${idStr}`,
              location: site.location,
              severity: "warning",
              message:
                siteErr ||
                "Unable to compute energy summary for this site (API error).",
              totalKwh: 0,
              points: 0,
            });
            continue;
          }

          const total = summary.total_value || 0;
          const points = summary.points || 0;

          // Rule 1 – No data in last 24h
          if (points === 0) {
            builtAlerts.push({
              id: `site-${idStr}-no-data`,
              siteId: idStr,
              siteName: site.name || `Site ${idStr}`,
              location: site.location,
              severity: "info",
              message:
                "No timeseries records in the last 24 hours for this site.",
              totalKwh: 0,
              points: 0,
            });
            continue;
          }

          // Rule 2 – High usage threshold (simple for now)
          let severity: AlertSeverity | null = null;
          let msg = "";

          if (total >= 400) {
            severity = "critical";
            msg = `Very high energy consumption in the last 24 hours: ${total.toFixed(
              1
            )} kWh.`;
          } else if (total >= 300) {
            severity = "warning";
            msg = `Elevated energy consumption in the last 24 hours: ${total.toFixed(
              1
            )} kWh.`;
          }

          if (severity) {
            builtAlerts.push({
              id: `site-${idStr}-usage`,
              siteId: idStr,
              siteName: site.name || `Site ${idStr}`,
              location: site.location,
              severity,
              message: msg,
              totalKwh: total,
              points,
            });
          }
        }

        setAlerts(builtAlerts);
      } catch (e: any) {
        if (!isMounted) return;
        console.error("Failed to load alerts", e);
        setError(e?.message || "Failed to load alerts.");
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    loadAlerts();

    return () => {
      isMounted = false;
    };
  }, []);

  const severityLabel = (sev: AlertSeverity) => {
    switch (sev) {
      case "critical":
        return "Critical";
      case "warning":
        return "Warning";
      default:
        return "Info";
    }
  };

  const severityClass = (sev: AlertSeverity) => {
    switch (sev) {
      case "critical":
        return "cei-pill-critical";
      case "warning":
        return "cei-pill-warning";
      default:
        return "cei-pill-info";
    }
  };

  const hasAlerts = alerts.length > 0;

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
            Alerts
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Simple rule-based alerts derived from last 24 hours of energy data
            for each site. We&apos;ll evolve this into a full analytics-driven
            engine later.
          </p>
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            textAlign: "right",
          }}
        >
          {sites.length > 0 && (
            <div>
              Monitoring <strong>{sites.length}</strong> sites.
            </div>
          )}
          <div>Window: last 24 hours</div>
        </div>
      </section>

      {/* Error banner */}
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
                Active alerts
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Alerts are generated by simple thresholds on energy consumption
                and data availability. This gives you an initial triage view
                while the analytics engine matures.
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

          {!loading && !hasAlerts && !error && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
                paddingTop: "0.5rem",
              }}
            >
              No alerts triggered under the current rules. As more sites and
              timeseries come online, you&apos;ll see high-usage and no-data
              conditions surfaced here.
            </div>
          )}

          {!loading && hasAlerts && (
            <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Location</th>
                    <th>Severity</th>
                    <th>Message</th>
                    <th>Energy (last 24h)</th>
                    <th>Points</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.siteName}</td>
                      <td>{a.location || "—"}</td>
                      <td>
                        <span className={severityClass(a.severity)}>
                          {severityLabel(a.severity)}
                        </span>
                      </td>
                      <td style={{ maxWidth: "320px" }}>{a.message}</td>
                      <td>
                        {a.totalKwh > 0 ? `${a.totalKwh.toFixed(1)} kWh` : "—"}
                      </td>
                      <td>{a.points > 0 ? a.points : "—"}</td>
                      <td>
                        <Link
                          to={`/sites/${a.siteId}`}
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

export default Alerts;
