import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  getAlerts,
  getAccountMe,
  getAlertHistory,
  updateAlertEvent,
} from "../services/api";
import type { AlertStatus, AlertEvent } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { downloadCsv } from "../utils/csv";

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

  // Statistical / baseline extras from backend
  deviation_pct?: number | null;
  total_actual_kwh?: number | null;
  total_expected_kwh?: number | null;
  baseline_lookback_days?: number | null;
  global_mean_kwh?: number | null;
  global_p50_kwh?: number | null;
  global_p90_kwh?: number | null;
  critical_hours?: number | null;
  elevated_hours?: number | null;
  below_baseline_hours?: number | null;
  stats_source?: string | null;

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

// Compact formatter for kWh/MWh values
function formatEnergyShort(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined) return "—";
  const val = Number(kwh);
  if (!Number.isFinite(val)) return "—";
  if (Math.abs(val) >= 1000) {
    return `${(val / 1000).toFixed(1)} MWh`;
  }
  return `${val.toFixed(0)} kWh`;
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

  // --- History / workflow state ---
  const [historyEvents, setHistoryEvents] = useState<AlertEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<
    AlertStatus | "all"
  >("open");
  const [updatingAlertId, setUpdatingAlertId] = useState<number | null>(null);

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

  // --- Load history whenever plan or status filter changes ---
  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      if (!planLoaded) return;

      if (!enableAlerts) {
        if (isMounted) {
          setHistoryEvents([]);
          setHistoryLoading(false);
          setHistoryError(null);
        }
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const params: { status?: AlertStatus; limit?: number } = {
          limit: 50,
        };
        if (historyStatusFilter !== "all") {
          params.status = historyStatusFilter;
        }

        const data = await getAlertHistory(params);
        if (!isMounted) return;

        setHistoryEvents(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!isMounted) return;
        const detail =
          (axios.isAxiosError(e) &&
            (e.response?.data as any)?.detail) ||
          e?.message ||
          "Failed to load alert history.";
        setHistoryError(detail);
      } finally {
        if (!isMounted) return;
        setHistoryLoading(false);
      }
    }

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [planLoaded, enableAlerts, historyStatusFilter]);

  const totalAlerts = alerts.length;
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount = alerts.filter((a) => a.severity === "info").length;

  const windowLabel = windowHours === 24 ? "last 24 hours" : "last 7 days";

  // --- Portfolio "top sites" aggregation (based on current alerts list) ---
  const siteAggregates: {
    siteKey: string;
    siteLabel: string;
    total: number;
    critical: number;
    warning: number;
    info: number;
    routeId: string | null;
  }[] = [];

  if (alerts.length > 0) {
    const map = new Map<
      string,
      {
        siteLabel: string;
        total: number;
        critical: number;
        warning: number;
        info: number;
        routeId: string | null;
      }
    >();

    for (const alert of alerts) {
      const rawId = alert.site_id || alert.site_name || "—";
      const siteKey = String(rawId);
      const siteLabel = alert.site_name || siteKey;
      const sev = alert.severity || "info";

      let agg = map.get(siteKey);
      if (!agg) {
        const routeId =
          typeof rawId === "string"
            ? toSiteRouteId(rawId)
            : String(rawId);

        agg = {
          siteLabel,
          total: 0,
          critical: 0,
          warning: 0,
          info: 0,
          routeId,
        };
        map.set(siteKey, agg);
      }

      agg.total += 1;
      if (sev === "critical") {
        agg.critical += 1;
      } else if (sev === "warning") {
        agg.warning += 1;
      } else {
        agg.info += 1;
      }
    }

    siteAggregates.push(
      ...Array.from(map.entries()).map(([siteKey, agg]) => ({
        siteKey,
        siteLabel: agg.siteLabel,
        total: agg.total,
        critical: agg.critical,
        warning: agg.warning,
        info: agg.info,
        routeId: agg.routeId,
      }))
    );

    // Sort by total alerts desc, then alphabetically by site label
    siteAggregates.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.siteLabel.localeCompare(b.siteLabel);
    });
  }

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

  function statusLabel(status?: AlertStatus): string {
    switch (status) {
      case "ack":
        return "Acknowledged";
      case "resolved":
        return "Resolved";
      case "muted":
        return "Muted";
      case "open":
      default:
        return "Open";
    }
  }

  async function handleUpdateAlertStatus(
    id: number,
    status: AlertStatus
  ): Promise<void> {
    try {
      setUpdatingAlertId(id);
      setHistoryError(null);
      await updateAlertEvent(id, { status });

      // Reload history with the current filter
      const params: { status?: AlertStatus; limit?: number } = {
        limit: 50,
      };
      if (historyStatusFilter !== "all") {
        params.status = historyStatusFilter;
      }
      const data = await getAlertHistory(params);
      setHistoryEvents(Array.isArray(data) ? data : []);
    } catch (e: any) {
      const detail =
        (axios.isAxiosError(e) &&
          (e.response?.data as any)?.detail) ||
        e?.message ||
        "Failed to update alert.";
      setHistoryError(detail);
    } finally {
      setUpdatingAlertId(null);
    }
  }

  // --- CSV export handlers ---

  function handleExportCurrentAlertsCsv() {
    if (!alerts.length) return;

    const rows = alerts.map((a) => ({
      id: a.id ?? "",
      site_id: a.site_id ?? "",
      site_name: a.site_name ?? "",
      severity: a.severity ?? "",
      title: a.title ?? "",
      message: a.message ?? "",
      metric: a.metric ?? "",
      window_hours: a.window_hours ?? "",
      triggered_at: a.triggered_at ?? "",
      deviation_pct: a.deviation_pct ?? "",
      total_actual_kwh: a.total_actual_kwh ?? "",
      total_expected_kwh: a.total_expected_kwh ?? "",
      baseline_lookback_days: a.baseline_lookback_days ?? "",
      critical_hours: a.critical_hours ?? "",
      elevated_hours: a.elevated_hours ?? "",
      below_baseline_hours: a.below_baseline_hours ?? "",
      stats_source: a.stats_source ?? "",
    }));

    downloadCsv("cei_current_alerts.csv", rows);
  }

  function handleExportHistoryCsv() {
    if (!historyEvents.length) return;

    const rows = historyEvents.map((ev) => ({
      id: ev.id ?? "",
      site_id: ev.site_id ?? "",
      site_name: ev.site_name ?? "",
      severity: ev.severity ?? "",
      status: ev.status ?? "",
      title: ev.title ?? "",
      message: ev.message ?? "",
      note: ev.note ?? "",
      metric: ev.metric ?? "",
      window_hours: ev.window_hours ?? "",
      triggered_at: ev.triggered_at ?? "",
      updated_at: ev.updated_at ?? "",
    }));

    downloadCsv("cei_alert_history.csv", rows);
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

      {/* Error banner (live alerts) */}
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

      {/* Summary row – only when alerts are enabled and plan is loaded */}
      {planLoaded && enableAlerts && (
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

      {/* Top sites by open alerts – portfolio view */}
      {planLoaded && enableAlerts && totalAlerts > 0 && siteAggregates.length > 0 && (
        <section style={{ marginTop: "0.9rem" }}>
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
                  Sites most impacted by alerts
                </div>
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.8rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Ranked by count of current alerts in {windowLabel}. Use this as
                  your daily triage list.
                </div>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.8rem",
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid rgba(148,163,184,0.5)",
                    }}
                  >
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.4rem 0.3rem",
                        fontWeight: 500,
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      Site
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "0.4rem 0.3rem",
                        fontWeight: 500,
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      Open alerts
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "0.4rem 0.3rem",
                        fontWeight: 500,
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      Critical
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "0.4rem 0.3rem",
                        fontWeight: 500,
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      Warnings
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "0.4rem 0.3rem",
                        fontWeight: 500,
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      Info
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "0.4rem 0.3rem",
                        fontWeight: 500,
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      Navigate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {siteAggregates.map((row) => (
                    <tr
                      key={row.siteKey}
                      style={{
                        borderBottom:
                          "1px solid rgba(30,41,59,0.9)",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.45rem 0.3rem",
                          maxWidth: "16rem",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 500,
                            color: "#e5e7eb",
                          }}
                        >
                          {row.siteLabel}
                        </span>{" "}
                        {row.siteKey !== row.siteLabel && (
                          <span
                            style={{
                              opacity: 0.7,
                              fontSize: "0.75rem",
                            }}
                          >
                            (<code>{row.siteKey}</code>)
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.45rem 0.3rem",
                          textAlign: "right",
                        }}
                      >
                        {row.total}
                      </td>
                      <td
                        style={{
                          padding: "0.45rem 0.3rem",
                          textAlign: "right",
                        }}
                      >
                        {row.critical}
                      </td>
                      <td
                        style={{
                          padding: "0.45rem 0.3rem",
                          textAlign: "right",
                        }}
                      >
                        {row.warning}
                      </td>
                      <td
                        style={{
                          padding: "0.45rem 0.3rem",
                          textAlign: "right",
                        }}
                      >
                        {row.info}
                      </td>
                      <td
                        style={{
                          padding: "0.45rem 0.3rem",
                          textAlign: "right",
                        }}
                      >
                        {row.routeId ? (
                          <Link
                            to={`/sites/${row.routeId}`}
                            style={{
                              color: "var(--cei-text-accent)",
                              textDecoration: "none",
                              fontSize: "0.78rem",
                            }}
                          >
                            View site →
                          </Link>
                        ) : (
                          <span
                            style={{
                              color: "var(--cei-text-muted)",
                            }}
                          >
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Alerts list – only when alerts are enabled and plan is loaded */}
      {planLoaded && enableAlerts && (
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

              {totalAlerts > 0 && (
                <button
                  type="button"
                  onClick={handleExportCurrentAlertsCsv}
                  className="cei-btn"
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.25rem 0.6rem",
                  }}
                >
                  Export current alerts (CSV)
                </button>
              )}
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

                  // Stats from backend (optional)
                  const dev =
                    typeof alert.deviation_pct === "number"
                      ? alert.deviation_pct
                      : null;
                  const totalActual =
                    typeof alert.total_actual_kwh === "number"
                      ? alert.total_actual_kwh
                      : null;
                  const totalExpected =
                    typeof alert.total_expected_kwh === "number"
                      ? alert.total_expected_kwh
                      : null;
                  const baselineDays =
                    typeof alert.baseline_lookback_days === "number"
                      ? alert.baseline_lookback_days
                      : null;
                  const critHours =
                    typeof alert.critical_hours === "number"
                      ? alert.critical_hours
                      : null;
                  const elevHours =
                    typeof alert.elevated_hours === "number"
                      ? alert.elevated_hours
                      : null;
                  const belowHours =
                    typeof alert.below_baseline_hours === "number"
                      ? alert.below_baseline_hours
                      : null;
                  const statsSource =
                    typeof alert.stats_source === "string"
                      ? alert.stats_source
                      : null;

                  const hasStatsBand =
                    dev !== null ||
                    (totalActual !== null && totalExpected !== null) ||
                    baselineDays !== null ||
                    critHours !== null ||
                    elevHours !== null ||
                    belowHours !== null;

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

                      {hasStatsBand && (
                        <div
                          style={{
                            marginTop: "0.55rem",
                            paddingTop: "0.45rem",
                            borderTop:
                              "1px solid rgba(148,163,184,0.45)",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.75rem",
                            fontSize: "0.75rem",
                            color: "var(--cei-text-muted)",
                          }}
                        >
                          {dev !== null && (
                            <span>
                              Δ vs baseline:{" "}
                              <strong>
                                {dev > 0 ? "+" : ""}
                                {dev.toFixed(1)}%
                              </strong>
                            </span>
                          )}
                          {totalActual !== null &&
                            totalExpected !== null && (
                              <span>
                                Actual vs expected:{" "}
                                <strong>
                                  {formatEnergyShort(totalActual)}
                                </strong>{" "}
                                vs{" "}
                                <strong>
                                  {formatEnergyShort(totalExpected)}
                                </strong>
                              </span>
                            )}
                          {baselineDays !== null && (
                            <span>
                              Baseline window: {baselineDays} days
                            </span>
                          )}
                          {(critHours !== null ||
                            elevHours !== null ||
                            belowHours !== null) && (
                            <span>
                              Hours – critical:{" "}
                              <strong>{critHours ?? 0}</strong>, elevated:{" "}
                              <strong>{elevHours ?? 0}</strong>, below
                              baseline:{" "}
                              <strong>{belowHours ?? 0}</strong>
                            </span>
                          )}
                          {statsSource && (
                            <span
                              style={{
                                opacity: 0.9,
                              }}
                            >
                              Stats:{" "}
                              <code>{statsSource}</code>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Alert history / workflow – only when alerts are enabled and plan is loaded */}
      {planLoaded && enableAlerts && (
        <section style={{ marginTop: "1rem" }}>
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
                  Alert history & workflow
                </div>
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.8rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Append-only stream from <code>alert_events</code>. Use this to
                  track who touched what, and when.
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "0.35rem",
                  fontSize: "0.78rem",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    padding: "0.2rem",
                    borderRadius: "999px",
                    border: "1px solid var(--cei-border-subtle)",
                    background: "rgba(15,23,42,0.95)",
                    fontSize: "0.78rem",
                  }}
                >
                  {["all", "open", "ack", "resolved"].map((key) => {
                    const k = key as AlertStatus | "all";
                    const isActive = historyStatusFilter === k;
                    const label =
                      k === "all"
                        ? "All"
                        : k === "ack"
                        ? "Ack"
                        : k === "resolved"
                        ? "Resolved"
                        : "Open";
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setHistoryStatusFilter(k)}
                        style={{
                          padding: "0.25rem 0.7rem",
                          borderRadius: "999px",
                          border: "none",
                          cursor: "pointer",
                          background: isActive
                            ? "rgba(56,189,248,0.18)"
                            : "transparent",
                          color: isActive
                            ? "#e5e7eb"
                            : "var(--cei-text-muted)",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {historyEvents.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportHistoryCsv}
                    className="cei-btn"
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.25rem 0.6rem",
                    }}
                  >
                    Export history (CSV)
                  </button>
                )}
              </div>
            </div>

            {historyError && (
              <div style={{ marginBottom: "0.6rem" }}>
                <ErrorBanner
                  message={historyError}
                  onClose={() => setHistoryError(null)}
                />
              </div>
            )}

            {historyLoading && (
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

            {!historyLoading && historyEvents.length === 0 && (
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                No historical alerts yet for this filter. As /alerts runs over
                time, events will accumulate here.
              </div>
            )}

            {!historyLoading && historyEvents.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                }}
              >
                {historyEvents.map((ev) => {
                  const sev = ev.severity || "info";
                  const siteId = ev.site_id || ev.site_name || "—";
                  const siteLabel = ev.site_name || String(siteId);
                  const triggeredLabel = formatTimestamp(ev.triggered_at);
                  const updatedLabel = formatTimestamp(ev.updated_at);
                  const siteRouteId =
                    typeof siteId === "string"
                      ? toSiteRouteId(siteId)
                      : String(siteId);

                  const isUpdating = updatingAlertId === ev.id;

                  return (
                    <div
                      key={ev.id}
                      style={{
                        borderRadius: "0.75rem",
                        border: "1px solid rgba(148,163,184,0.4)",
                        padding: "0.6rem 0.75rem",
                        background: "rgba(15,23,42,0.9)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.4rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "0.75rem",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.25rem",
                            flex: 1,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.4rem",
                            }}
                          >
                            <span className={severityPillClass(sev)}>
                              {severityLabel(sev)}
                            </span>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                color: "var(--cei-text-muted)",
                              }}
                            >
                              Site:{" "}
                              <strong>{siteLabel}</strong>{" "}
                              {siteId && siteId !== siteLabel && (
                                <span style={{ opacity: 0.7 }}>
                                  (<code>{String(siteId)}</code>)
                                </span>
                              )}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "0.88rem",
                              fontWeight: 500,
                            }}
                          >
                            {ev.title}
                          </div>
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "var(--cei-text-muted)",
                            }}
                          >
                            {ev.message}
                          </div>
                          {ev.note && (
                            <div
                              style={{
                                marginTop: "0.2rem",
                                fontSize: "0.78rem",
                                color: "#e5e7eb",
                              }}
                            >
                              <span
                                style={{
                                  opacity: 0.7,
                                  marginRight: "0.25rem",
                                }}
                              >
                                Note:
                              </span>
                              {ev.note}
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            textAlign: "right",
                            fontSize: "0.75rem",
                            color: "var(--cei-text-muted)",
                            minWidth: "150px",
                          }}
                        >
                          <div
                            style={{
                              display: "inline-flex",
                              padding: "0.1rem 0.55rem",
                              borderRadius: "999px",
                              border:
                                ev.status === "resolved"
                                  ? "1px solid rgba(34,197,94,0.7)"
                                  : ev.status === "ack"
                                  ? "1px solid rgba(59,130,246,0.7)"
                                  : ev.status === "muted"
                                  ? "1px solid rgba(234,179,8,0.7)"
                                  : "1px solid rgba(148,163,184,0.7)",
                              background:
                                ev.status === "resolved"
                                  ? "rgba(22,163,74,0.2)"
                                  : ev.status === "ack"
                                  ? "rgba(37,99,235,0.2)"
                                  : ev.status === "muted"
                                  ? "rgba(234,179,8,0.15)"
                                  : "rgba(15,23,42,0.9)",
                            }}
                          >
                            <span>{statusLabel(ev.status)}</span>
                          </div>

                          <div style={{ marginTop: "0.25rem" }}>
                            Triggered: {triggeredLabel}
                          </div>
                          <div style={{ marginTop: "0.1rem" }}>
                            Updated: {updatedLabel}
                          </div>

                          {siteRouteId && (
                            <div style={{ marginTop: "0.3rem" }}>
                              <Link
                                to={`/sites/${siteRouteId}`}
                                style={{
                                  color: "var(--cei-text-accent)",
                                  fontSize: "0.75rem",
                                  textDecoration: "none",
                                }}
                              >
                                View site →
                              </Link>
                            </div>
                          )}

                          <div
                            style={{
                              marginTop: "0.35rem",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.25rem",
                              alignItems: "flex-end",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.72rem",
                                opacity: 0.7,
                              }}
                            >
                              Update status:
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "0.25rem",
                                justifyContent: "flex-end",
                              }}
                            >
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() =>
                                  handleUpdateAlertStatus(
                                    ev.id,
                                    "ack"
                                  )
                                }
                                className="cei-btn"
                                style={{
                                  padding:
                                    "0.15rem 0.5rem",
                                  fontSize: "0.72rem",
                                  opacity:
                                    isUpdating &&
                                    updatingAlertId === ev.id
                                      ? 0.6
                                      : 1,
                                }}
                              >
                                Ack
                              </button>
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() =>
                                  handleUpdateAlertStatus(
                                    ev.id,
                                    "resolved"
                                  )
                                }
                                className="cei-btn"
                                style={{
                                  padding:
                                    "0.15rem 0.5rem",
                                  fontSize: "0.72rem",
                                  opacity:
                                    isUpdating &&
                                    updatingAlertId === ev.id
                                      ? 0.6
                                      : 1,
                                }}
                              >
                                Resolve
                              </button>
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() =>
                                  handleUpdateAlertStatus(
                                    ev.id,
                                    "open"
                                  )
                                }
                                className="cei-btn"
                                style={{
                                  padding:
                                    "0.15rem 0.5rem",
                                  fontSize: "0.72rem",
                                  opacity:
                                    isUpdating &&
                                    updatingAlertId === ev.id
                                      ? 0.6
                                      : 1,
                                }}
                              >
                                Re-open
                              </button>
                            </div>
                          </div>
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
