import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { getAlerts, getAccountMe } from "../services/api";
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

function toSiteRouteId(raw: string): string {
  if (!raw) return raw;
  if (raw.startsWith("site-")) {
    return raw.substring("site-".length);
  }
  return raw;
}

const Alerts: React.FC = () => {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 24h vs 7 days (168h)
  const [windowHours, setWindowHours] = useState<24 | 168>(24);

  // Plan flags coming from /auth/me
  const [planKey, setPlanKey] = useState<string>("cei-starter");
  const [enableAlerts, setEnableAlerts] = useState<boolean>(true);
  const [planLoaded, setPlanLoaded] = useState<boolean>(false);

  // --- Load plan / feature flags once ---
  useEffect(() => {
    let isMounted = true;

    async function loadPlan() {
      try {
        const account = await getAccountMe().catch(() => null);
        if (!isMounted || !account) {
          setPlanLoaded(true);
          return;
        }

        const org =
          (account.org as any) ??
          (account.organization as any) ??
          null;

        const derivedPlanKey: string =
          org?.subscription_plan_key ||
          org?.plan_key ||
          account.subscription_plan_key ||
          "cei-starter";

        const backendEnableAlerts: boolean | undefined =
          account.enable_alerts ?? org?.enable_alerts;

        const effectiveEnableAlerts =
          typeof backendEnableAlerts === "boolean"
            ? backendEnableAlerts
            : derivedPlanKey === "cei-starter" ||
              derivedPlanKey === "cei-growth";

        if (!isMounted) return;

        setPlanKey(derivedPlanKey);
        setEnableAlerts(effectiveEnableAlerts);
        setPlanLoaded(true);
      } catch (_e) {
        // On failure, default to "starter" and alerts enabled to avoid accidental lockout.
        if (!isMounted) return;
        setPlanKey("cei-starter");
        setEnableAlerts(true);
        setPlanLoaded(true);
      }
    }

    loadPlan();

    return () => {
      isMounted = false;
    };
  }, []);

  // --- Load alerts whenever windowHours or plan changes ---
  useEffect(() => {
    let isMounted = true;

    async function loadAlerts() {
      // If plan is not loaded yet, don't do anything.
      if (!planLoaded) return;

      // If alerts are disabled by plan, clear list and stop.
      if (!enableAlerts) {
        if (isMounted) {
          setAlerts([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await getAlerts({ window_hours: windowHours });
        if (!isMounted) return;

        const normalized: AlertRecord[] = Array.isArray(data) ? data : [];
        setAlerts(normalized);
      } catch (e: any) {
        if (!isMounted) return;

        if (axios.isAxiosError(e) && e.response?.status === 403) {
          // Backend gating says "no alerts for this plan" – align frontend state.
          setEnableAlerts(false);
          setError(null);
        } else {
          const detail =
            (axios.isAxiosError(e) &&
              (e.response?.data as any)?.detail) ||
            e?.message ||
            "Failed to load alerts.";
          setError(detail);
        }
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    loadAlerts();

    return () => {
      isMounted = false;
    };
  }, [windowHours, enableAlerts, planLoaded]);

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
            <strong>Critical</strong> alerts indicate high-confidence waste
            or abnormal baselines, while <strong>Warnings</strong> flag
            patterns worth a closer look.
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
                  windowHours === 24
                    ? "rgba(56,189,248,0.18)"
                    : "transparent",
                color:
                  windowHours === 24
                    ? "#e5e7eb"
                    : "var(--cei-text-muted)",
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
                  windowHours === 168
                    ? "#e5e7eb"
                    : "var(--cei-text-muted)",
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

      {/* Upgrade gating banner */}
      {!loading && planLoaded && !enableAlerts && (
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
                Upgrade to unlock alerts
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                  maxWidth: "40rem",
                }}
              >
                Your current plan (<code>{planKey}</code>) does not include
                rule-based alerting. Upgrade to CEI Starter or above to see
                baseline deviations, weekend waste, and portfolio dominance
                patterns directly on this page.
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
                  Alerts will light up automatically as soon as your
                  subscription is active.
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Summary row – only when alerts are enabled */}
      {enableAlerts && (
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
                <li>Work through <strong>critical</strong> alerts first.</li>
                <li>Review warnings during daily/weekly ops meetings.</li>
                <li>Use site links below to investigate trends directly.</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Alerts list – only when alerts are enabled */}
      {enableAlerts && (
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
                give CEI a moment to crunch baselines and reconverge on thresholds.
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
                  const siteIdRaw = alert.site_id || alert.site_name || "—";
                  const siteLabel = alert.site_name || String(siteIdRaw);
                  const sev = alert.severity || "info";
                  const triggeredLabel = formatTimestamp(alert.triggered_at);

                  const key = String(alert.id ?? `${siteIdRaw}-${idx}`);

                  const siteRouteId =
                    typeof siteIdRaw === "string"
                      ? toSiteRouteId(siteIdRaw)
                      : String(siteIdRaw);

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
                              Site:{" "}
                              <strong>{siteLabel}</strong>{" "}
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
                          {siteRouteId && (
                            <div style={{ marginTop: "0.3rem" }}>
                              <Link
                                to={`/sites/${siteRouteId}`}
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
      )}
    </div>
  );
};

export default Alerts;
