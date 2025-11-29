import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import api, { getAlertHistory } from "../services/api";
import LoadingSpinner from "./LoadingSpinner";
import ErrorBanner from "./ErrorBanner";

type AlertStatus = "open" | "ack" | "resolved";

type AlertHistoryRecord = {
  id?: string | number;
  site_id?: string | null;
  site_name?: string | null;
  severity?: "critical" | "warning" | "info" | string;
  title?: string;
  message?: string;
  metric?: string | null;
  window_hours?: number | null;
  status?: string | null;
  triggered_at?: string | null;

  deviation_pct?: number | null;
  total_actual_kwh?: number | null;
  total_expected_kwh?: number | null;
  baseline_lookback_days?: number | null;
  critical_hours?: number | null;
  elevated_hours?: number | null;
  below_baseline_hours?: number | null;
  stats_source?: string | null;

  [key: string]: any;
};

interface SiteAlertsStripProps {
  /** Backend site_id, e.g. "site-1" */
  siteKey: string;
  /** How many alerts to show in the strip */
  limit?: number;
}

function formatTimestamp(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
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

const SiteAlertsStrip: React.FC<SiteAlertsStripProps> = ({
  siteKey,
  limit = 3,
}) => {
  const [alerts, setAlerts] = useState<AlertHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AlertStatus>("open");
  const [updatingId, setUpdatingId] = useState<string | number | null>(null);

  // Load recent alerts for this site + status
  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!siteKey) return;
      setLoading(true);
      setError(null);

      try {
        const data = await getAlertHistory({
          siteId: siteKey, // camelCase param expected by api helper
          status: statusFilter,
          limit,
        });

        if (!isMounted) return;
        const normalized: AlertHistoryRecord[] = Array.isArray(data) ? data : [];
        setAlerts(normalized);
      } catch (e: any) {
        if (!isMounted) return;

        if (axios.isAxiosError(e)) {
          const detail =
            (e.response?.data as any)?.detail ||
            e.message ||
            "Failed to load alert history.";
          setError(detail);
        } else {
          setError("Failed to load alert history.");
        }
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [siteKey, statusFilter, limit]);

  const hasAlerts = alerts.length > 0;

  // Inline status update (ack / resolve) from the strip
  async function handleStatusChange(
    alertId: string | number | undefined,
    newStatus: AlertStatus
  ) {
    if (!alertId) return;
    setUpdatingId(alertId);
    setError(null);

    try {
      // Use shared axios instance from services/api
      const idStr = String(alertId);
      await api.patch(`/alerts/${idStr}`, { status: newStatus });

      // Re-fetch the current list with the same filter
      const data = await getAlertHistory({
        siteId: siteKey,
        status: statusFilter,
        limit,
      });

      const normalized: AlertHistoryRecord[] = Array.isArray(data) ? data : [];
      setAlerts(normalized);
    } catch (e: any) {
      if (axios.isAxiosError(e)) {
        const detail =
          (e.response?.data as any)?.detail ||
          e.message ||
          "Failed to update alert.";
        setError(detail);
      } else {
        setError("Failed to update alert.");
      }
    } finally {
      setUpdatingId(null);
    }
  }

  return (
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
            Recent alerts for this site
          </div>
          <div
            style={{
              marginTop: "0.2rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Snapshot of the most recent{" "}
            <strong>{statusFilter}</strong> alerts for this site. Use this
            strip as a launch pad into the full alerts workspace.
          </div>
        </div>

        {/* Status filter toggle */}
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
          <button
            type="button"
            onClick={() => setStatusFilter("open")}
            style={{
              padding: "0.25rem 0.7rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              background:
                statusFilter === "open"
                  ? "rgba(56,189,248,0.18)"
                  : "transparent",
              color:
                statusFilter === "open"
                  ? "#e5e7eb"
                  : "var(--cei-text-muted)",
            }}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("ack")}
            style={{
              padding: "0.25rem 0.7rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              background:
                statusFilter === "ack"
                  ? "rgba(56,189,248,0.18)"
                  : "transparent",
              color:
                statusFilter === "ack"
                  ? "#e5e7eb"
                  : "var(--cei-text-muted)",
            }}
          >
            Ack
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("resolved")}
            style={{
              padding: "0.25rem 0.7rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              background:
                statusFilter === "resolved"
                  ? "rgba(56,189,248,0.18)"
                  : "transparent",
              color:
                statusFilter === "resolved"
                  ? "#e5e7eb"
                  : "var(--cei-text-muted)",
            }}
          >
            Resolved
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: "0.6rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </div>
      )}

      {loading && (
        <div
          style={{
            padding: "1rem 0.3rem",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <LoadingSpinner />
        </div>
      )}

      {!loading && !hasAlerts && (
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          No {statusFilter} alerts found for this site in the recent history
          window. You can still see the full portfolio view in{" "}
          <Link
            to="/alerts"
            style={{
              color: "var(--cei-text-accent)",
              textDecoration: "none",
            }}
          >
            Alerts
          </Link>
          .
        </div>
      )}

      {!loading && hasAlerts && (
        <div
          style={{
            marginTop: "0.3rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {alerts.map((alert) => {
            const key = String(
              alert.id ?? alert.triggered_at ?? Math.random()
            );
            const sev = alert.severity || "info";
            const currentStatus =
              (alert.status as AlertStatus | null) || "open";
            const isUpdating =
              updatingId !== null &&
              String(updatingId) === String(alert.id);

            const ackLabel = isUpdating ? "Updating…" : "Mark ack";
            const resolveLabel = isUpdating ? "Updating…" : "Resolve";

            return (
              <div
                key={key}
                style={{
                  borderRadius: "0.6rem",
                  border: "1px solid rgba(148,163,184,0.4)",
                  padding: "0.55rem 0.7rem",
                  background:
                    sev === "critical"
                      ? "rgba(127, 29, 29, 0.3)"
                      : sev === "warning"
                      ? "rgba(120, 53, 15, 0.3)"
                      : "rgba(15, 23, 42, 0.85)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.5rem",
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
                      gap: "0.45rem",
                    }}
                  >
                    <span className={severityPillClass(sev)}>
                      {severityLabel(sev)}
                    </span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--cei-text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {currentStatus}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.86rem",
                      fontWeight: 500,
                    }}
                  >
                    {alert.title || "Energy anomaly detected"}
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--cei-text-muted)",
                    }}
                  >
                    {alert.message ||
                      "This site’s recent energy pattern deviates from its baseline. Review the alerts workspace for a full history."}
                  </div>
                </div>

                <div
                  style={{
                    textAlign: "right",
                    fontSize: "0.75rem",
                    color: "var(--cei-text-muted)",
                    minWidth: "140px",
                  }}
                >
                  <div>Triggered: {formatTimestamp(alert.triggered_at)}</div>
                  {alert.window_hours && (
                    <div style={{ marginTop: "0.15rem" }}>
                      Window: {alert.window_hours}h
                    </div>
                  )}
                  {alert.metric && (
                    <div style={{ marginTop: "0.15rem" }}>
                      Metric: <code>{alert.metric}</code>
                    </div>
                  )}

                  {/* Inline status actions */}
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
                        display: "flex",
                        gap: "0.35rem",
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      {currentStatus !== "ack" && (
                        <button
                          type="button"
                          disabled={isUpdating || !alert.id}
                          onClick={() =>
                            handleStatusChange(alert.id, "ack")
                          }
                          style={{
                            fontSize: "0.72rem",
                            padding: "0.2rem 0.6rem",
                            borderRadius: "999px",
                            border:
                              "1px solid rgba(148,163,184,0.7)",
                            background: "rgba(15,23,42,0.9)",
                            cursor: isUpdating ? "default" : "pointer",
                            opacity: isUpdating ? 0.7 : 1,
                          }}
                        >
                          {ackLabel}
                        </button>
                      )}
                      {currentStatus !== "resolved" && (
                        <button
                          type="button"
                          disabled={isUpdating || !alert.id}
                          onClick={() =>
                            handleStatusChange(alert.id, "resolved")
                          }
                          style={{
                            fontSize: "0.72rem",
                            padding: "0.2rem 0.6rem",
                            borderRadius: "999px",
                            border: "none",
                            background:
                              "linear-gradient(to right, rgba(34,197,94,0.9), rgba(22,163,74,0.9))",
                            cursor: isUpdating ? "default" : "pointer",
                            opacity: isUpdating ? 0.7 : 1,
                            color: "#e5e7eb",
                          }}
                        >
                          {resolveLabel}
                        </button>
                      )}
                    </div>

                    <div>
                      <Link
                        to="/alerts"
                        style={{
                          color: "var(--cei-text-accent)",
                          textDecoration: "none",
                        }}
                      >
                        View in Alerts →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SiteAlertsStrip;
