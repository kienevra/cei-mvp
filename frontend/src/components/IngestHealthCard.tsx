import React, { useEffect, useState } from "react";
import { getIngestHealth, IngestHealthMeter } from "../services/api";

type Props = {
  windowHours?: number;
};

type Status = "healthy" | "warning" | "critical";

function getStatus(completeness: number): Status {
  if (completeness >= 95) return "healthy";
  if (completeness >= 80) return "warning";
  return "critical";
}

function statusLabel(status: Status) {
  if (status === "healthy") return "Healthy";
  if (status === "warning") return "Degraded";
  return "Critical";
}

export const IngestHealthCard: React.FC<Props> = ({ windowHours = 24 }) => {
  const [meters, setMeters] = useState<IngestHealthMeter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getIngestHealth(windowHours);
        if (!active) return;
        setMeters(data.meters ?? []);
      } catch {
        if (!active) return;
        setError("Unable to load ingest health.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    // Optional: auto-refresh every 5 minutes
    const id = setInterval(load, 5 * 60 * 1000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [windowHours]);

  const overallCompleteness =
    meters.length > 0
      ? meters.reduce((acc, m) => acc + m.completeness_pct, 0) /
        meters.length
      : 0;

  const overallStatus = getStatus(overallCompleteness);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Data pipeline health
          </h2>
          <p className="text-xs text-slate-400">
            Last {windowHours}h – meter ingestion completeness
          </p>
        </div>
        <div
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            overallStatus === "healthy"
              ? "bg-emerald-500/10 text-emerald-300"
              : overallStatus === "warning"
              ? "bg-amber-500/10 text-amber-300"
              : "bg-rose-500/10 text-rose-300"
          }`}
        >
          {statusLabel(overallStatus)}{" "}
          {meters.length > 0
            ? `${overallCompleteness.toFixed(1)}%`
            : "No data"}
        </div>
      </div>

      {loading && (
        <p className="text-xs text-slate-400">Loading ingest health…</p>
      )}

      {error && (
        <p className="text-xs text-rose-300">
          {error} Check backend /timeseries/ingest_health.
        </p>
      )}

      {!loading && !error && meters.length === 0 && (
        <p className="text-xs text-slate-400">
          No meters reported in this window.
        </p>
      )}

      {!loading && !error && meters.length > 0 && (
        <div className="mt-2 max-h-44 overflow-y-auto">
          <table className="w-full text-xs text-slate-300">
            <thead className="text-[11px] text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-1 pr-2 text-left">Site</th>
                <th className="py-1 pr-2 text-left">Meter</th>
                <th className="py-1 pr-2 text-right">Completeness</th>
                <th className="py-1 pl-2 text-right">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {meters.map((m) => {
                const status = getStatus(m.completeness_pct);
                return (
                  <tr
                    key={`${m.site_id}:${m.meter_id}`}
                    className="border-b border-slate-900/60"
                  >
                    <td className="py-1 pr-2">
                      <span className="font-mono text-[11px] text-slate-200">
                        {m.site_id}
                      </span>
                    </td>
                    <td className="py-1 pr-2 text-slate-300">
                      {m.meter_id}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <span
                        className={
                          status === "healthy"
                            ? "text-emerald-300"
                            : status === "warning"
                            ? "text-amber-300"
                            : "text-rose-300"
                        }
                      >
                        {m.completeness_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-1 pl-2 text-right text-[11px] text-slate-400">
                      {m.last_seen
                        ? new Date(m.last_seen).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
