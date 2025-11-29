// frontend/src/components/AlertHistoryPanel.tsx
import React, { useEffect, useState } from "react";
import {
  AlertEvent,
  AlertStatus,
  getAlertHistory,
  updateAlertEvent,
} from "../services/api";

type StatusFilter = AlertStatus | "all";

const statusLabel: Record<AlertStatus, string> = {
  open: "Open",
  ack: "Acknowledged",
  resolved: "Resolved",
  muted: "Muted",
};

const severityLabel: Record<AlertEvent["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export const AlertHistoryPanel: React.FC<{
  defaultStatus?: StatusFilter;
  siteId?: string;
}> = ({ defaultStatus = "open", siteId }) => {
  const [items, setItems] = useState<AlertEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(defaultStatus);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const loadHistory = async (opts?: { hard?: boolean }) => {
    const hard = opts?.hard ?? false;
    if (hard) setIsLoading(true);
    else setIsRefreshing(true);
    setError(null);

    try {
      const data = await getAlertHistory({
        siteId,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 100,
      });
      setItems(data);
    } catch (err: any) {
      console.error("Failed to load alert history", err);
      setError("Failed to load alert history.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadHistory({ hard: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, siteId]);

  const handleStatusChange = (id: number, status: AlertStatus) => {
    setUpdatingId(id);
    setError(null);

    // Basic note capture; we can replace later with a proper UI
    let note: string | undefined = undefined;
    if (status === "ack" || status === "resolved" || status === "muted") {
      const input = window.prompt("Add note (optional):", "");
      if (input !== null && input.trim().length > 0) {
        note = input.trim();
      }
    }

    updateAlertEvent(id, { status, note })
      .then((updated) => {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? updated : item))
        );
      })
      .catch((err: any) => {
        console.error("Failed to update alert", err);
        setError("Failed to update alert. Check console for details.");
      })
      .finally(() => {
        setUpdatingId(null);
      });
  };

  const renderStatusBadge = (row: AlertEvent) => {
    const label = statusLabel[row.status] ?? row.status;
    let bg = "bg-slate-700";
    if (row.status === "open") bg = "bg-red-700";
    if (row.status === "ack") bg = "bg-amber-600";
    if (row.status === "resolved") bg = "bg-emerald-700";
    if (row.status === "muted") bg = "bg-slate-600";

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${bg}`}
      >
        {label}
      </span>
    );
  };

  const renderSeverityBadge = (row: AlertEvent) => {
    const label = severityLabel[row.severity] ?? row.severity;
    let bg = "bg-slate-700";
    if (row.severity === "critical") bg = "bg-red-800";
    if (row.severity === "warning") bg = "bg-amber-700";
    if (row.severity === "info") bg = "bg-sky-700";

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${bg}`}
      >
        {label}
      </span>
    );
  };

  return (
    <div className="mt-8 border border-slate-700 rounded-2xl bg-slate-900/70 p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Alert history & workflow
          </h2>
          <p className="text-xs text-slate-400">
            Append-only stream from <code>alert_events</code>. Use this to
            drive acknowledge / resolve workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="bg-slate-800 text-slate-100 text-xs rounded-lg px-2 py-1 border border-slate-700"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as StatusFilter)
            }
          >
            <option value="open">Open</option>
            <option value="ack">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="muted">Muted</option>
            <option value="all">All statuses</option>
          </select>
          <button
            type="button"
            onClick={() => loadHistory({ hard: false })}
            className="text-xs px-3 py-1 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700"
            disabled={isRefreshing || isLoading}
          >
            {isRefreshing || isLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-xs text-red-400 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {isLoading && items.length === 0 ? (
        <div className="text-xs text-slate-400 py-4">Loading history…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-slate-400 py-4">
          No alert history for this filter yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs text-left text-slate-200">
            <thead className="bg-slate-800/90 text-slate-300 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-800 hover:bg-slate-800/60"
                >
                  <td className="px-3 py-2 align-top whitespace-nowrap text-slate-400">
                    {new Date(row.triggered_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">
                    {row.site_name || row.site_id || "—"}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {renderSeverityBadge(row)}
                  </td>
                  <td className="px-3 py-2 align-top max-w-xs">
                    <div className="font-medium text-slate-100">
                      {row.title}
                    </div>
                    <div className="text-slate-400 line-clamp-2">
                      {row.message}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {renderStatusBadge(row)}
                  </td>
                  <td className="px-3 py-2 align-top max-w-xs">
                    {row.note ? (
                      <span className="text-slate-300">{row.note}</span>
                    ) : (
                      <span className="text-slate-500 italic">No note</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      {row.status !== "ack" && (
                        <button
                          type="button"
                          className="px-2 py-1 rounded-md border border-amber-600 text-amber-200 hover:bg-amber-900/40"
                          disabled={updatingId === row.id}
                          onClick={() =>
                            handleStatusChange(row.id, "ack")
                          }
                        >
                          Ack
                        </button>
                      )}
                      {row.status !== "resolved" && (
                        <button
                          type="button"
                          className="px-2 py-1 rounded-md border border-emerald-600 text-emerald-200 hover:bg-emerald-900/40"
                          disabled={updatingId === row.id}
                          onClick={() =>
                            handleStatusChange(row.id, "resolved")
                          }
                        >
                          Resolve
                        </button>
                      )}
                      {row.status !== "muted" && (
                        <button
                          type="button"
                          className="px-2 py-1 rounded-md border border-slate-600 text-slate-200 hover:bg-slate-800"
                          disabled={updatingId === row.id}
                          onClick={() =>
                            handleStatusChange(row.id, "muted")
                          }
                        >
                          Mute
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AlertHistoryPanel;
