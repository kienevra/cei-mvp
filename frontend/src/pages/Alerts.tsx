// frontend/src/pages/Alerts.tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAlerts } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type AlertRecord = {
  id?: string | number;
  site_id?: string | null;
  site_name?: string | null;
  severity?: "critical" | "warning" | "info" | string;
  title?: string;
  message?: string;
  metric?: string | null;
  window_hours?: number | null;
  triggered_at?: string | null;
  // keep it flexible so we don't break on backend changes
  [key: string]: any;
};

function toSiteRouteId(siteId: string): string {
  if (!siteId) return siteId;
  // If we get "site-3", turn it into "3" for the /sites/{id} route
  if (siteId.startsWith("site-")) {
    return siteId.substring("site-".length);
  }
  return siteId;
}

const Alerts: React.FC = () => {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 24h vs 7 days (168h)
  const [windowHours, setWindowHours] = useState<24 | 168>(24);

  useEffect(() => {
    let isMounted = true;

    async function loadAlerts() {
      setLoading(true);
      setError(null);

      try {
        const data = await getAlerts({ window_hours: windowHours });
        if (!isMounted) return;

        // Normalize into AlertRecord[]
        const normalized: AlertRecord[] = Array.isArray(data) ? data : [];

        setAlerts(normalized);
      } catch (e: any) {
        if (!isMounted) return;
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
  }, [windowHours]);

  const totalAlerts = alerts.length;
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount = alerts.filter((a) => a.severity === "info").length;

  const windowLabel = windowHours === 24 ? "last 24 hours" : "last 7 days";

  function formatTimestamp(ts?: string | null): string {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function severityPillClass(severity: string | undefined): string {
    switch (severity) {
      case "critical":
        return "cei-pill-critical";
      case "warning":
        return "cei-pill-warning";
      case "info":
      default:
        return "cei-pill-info";
    }
  }

  function severityLabel(severity: string | undefined): string {
    switch (severity) {
      case "critical":
        return "Critical";
      case "warning":
        return "Warning";
      case "info":
      default:
        return "Info";
    }
  }

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
            Rule-based exceptions generated from your timeseries data.{" "}
            <strong>Critical</strong> alerts indicate high-confidence waste or
            abnormal baselines, while <strong>Warnings</strong> flag patterns
            worth a closer look.
          </p>
        </div>

        {/* Window toggle */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.4rem",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          <div>Window: {windowLabel}</div>
          <div
            style={{
              display: "inline-flex",
              padding: "0.2rem",
              borderRadius: "999px",
              border: "1px solid var(--cei-border-subtle)",
              background: "rgba(15,23,42,0.95)",
            }}
          >
            <button
              type="button"
              onClick={() => setWindowHours(24)}
              style={{
                padding: "0.25rem 0.7rem",
                borderRadius: "999px",
                border: "none",
                fontSize: "0.78rem",
                cursor: "pointer",
                background:
                  windowHours === 24 ? "rgba(56,189,248,0.18)" : "transparent",
                color:
                  windowHours === 24 ? "#e5e7eb" : "var(--cei-text-muted)",
              }}
            >
              24h
            </button>
            <button
              type="button"
              onClick={() => setWindowHours(168)}
              style={{
                padding: "0.25rem 0.7rem",
                borderRadius: "999px",
                border: "none",
                fontSize: "0.78rem",
                cursor: "pointer",
                background:
                  windowHours === 168
                    ? "rgba(56,189,248,0.18)"
                    : "transparent",
                color:
                  windowHours === 168 ? "#e5e7eb" : "var(--cei-text-muted)",
              }}
            >
              7d
            </button>
          </div>
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      {/* Summary row */}
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
            Total alerts – {windowLabel}
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "1.6rem",
              fontWeight: 600,
            }}
          >
            {loading ? "…" : totalAlerts}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Count of all critical, warning, and info-level alerts raised in the
            selected window.
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
            Severity mix
          </div>
          <div
            style={{
              marginTop: "0.5rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.4rem",
              alignItems: "center",
            }}
          >
            <span className="cei-pill-critical">
              Critical: {loading ? "…" : criticalCount}
            </span>
            <span className="cei-pill-warning">
              Warning: {loading ? "…" : warningCount}
            </span>
            <span className="cei-pill-info">
              Info: {loading ? "…" : infoCount}
            </span>
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Use this to understand whether the portfolio is mostly “noise” or if
            true exceptions are creeping in.
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
            Operational playbook
          </div>
          <div
            style={{
              marginTop: "0.3rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.1rem",
                lineHeight: 1.6,
              }}
            >
              <li>
                Work through <strong>critical</strong> alerts first.
              </li>
              <li>Review warnings during daily/weekly ops meetings.</li>
              <li>Use site links below to investigate trends directly.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Alerts list */}
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
                Current alerts
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Site-level exceptions for the selected window. Click through to
                the site dashboard to see the underlying trend.
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

          {!loading && totalAlerts === 0 && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No alerts raised in {windowLabel}. If you recently uploaded data,
              give CEI a moment to crunch baselines and reconverge on
              thresholds.
            </div>
          )}

          {!loading && totalAlerts > 0 && (
            <div
              style={{
                marginTop: "0.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
              }}
            >
              {alerts.map((alert, idx) => {
                const siteIdRaw =
                  alert.site_id || alert.site_name || undefined;
                const siteLabel = alert.site_name || String(siteIdRaw || "—");
                const sev = alert.severity || "info";
                const triggeredLabel = formatTimestamp(alert.triggered_at);

                const key = String(alert.id ?? `${siteLabel}-${idx}`);
                const routeId = siteIdRaw
                  ? toSiteRouteId(String(siteIdRaw))
                  : "";

                return (
                  <div
                    key={key}
                    style={{
                      borderRadius: "0.75rem",
                      border: "1px solid rgba(148,163,184,0.4)",
                      padding: "0.7rem 0.85rem",
                      background:
                        sev === "critical"
                          ? "rgba(127, 29, 29, 0.4)"
                          : sev === "warning"
                          ? "rgba(120, 53, 15, 0.35)"
                          : "rgba(15, 23, 42, 0.8)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        alignItems: "flex-start",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.3rem",
                          flex: 1,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <span className={severityPillClass(sev)}>
                            {severityLabel(sev)}
                          </span>
                          <span
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--cei-text-muted)",
                            }}
                          >
                            Site: <strong>{siteLabel}</strong>{" "}
                            {siteIdRaw && siteIdRaw !== siteLabel && (
                              <span style={{ opacity: 0.7 }}>
                                (<code>{String(siteIdRaw)}</code>)
                              </span>
                            )}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.9rem",
                            fontWeight: 500,
                          }}
                        >
                          {alert.title || "Energy anomaly detected"}
                        </div>
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--cei-text-muted)",
                          }}
                        >
                          {alert.message ||
                            "This site’s recent energy pattern deviates from its baseline. Review the dashboard for confirmation."}
                        </div>
                      </div>

                      <div
                        style={{
                          textAlign: "right",
                          fontSize: "0.78rem",
                          color: "var(--cei-text-muted)",
                          minWidth: "140px",
                        }}
                      >
                        <div>Triggered: {triggeredLabel}</div>
                        {alert.metric && (
                          <div style={{ marginTop: "0.15rem" }}>
                            Metric: <code>{alert.metric}</code>
                          </div>
                        )}
                        {alert.window_hours && (
                          <div style={{ marginTop: "0.15rem" }}>
                            Window: {alert.window_hours}h
                          </div>
                        )}
                        {routeId && (
                          <div style={{ marginTop: "0.3rem" }}>
                            <Link
                              to={`/sites/${routeId}`}
                              style={{
                                color: "var(--cei-text-accent)",
                                fontSize: "0.78rem",
                                textDecoration: "none",
                              }}
                            >
                              View site →
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Alerts;
