// src/components/ProductionCorrelation.tsx
import { useState, useRef, useCallback } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
  Dot,
} from "recharts";
import {
  fetchProductionCorrelation,
  uploadProductionCsv,
  ProductionCorrelationResponse,
  CorrelationDay,
} from "../services/productionApi";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useTranslation } from "react-i18next";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string, locale = "it-IT") {
  return new Date(d + "T00:00:00").toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
}

function defaultDateRange() {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

const TREND_META = {
  improving: { label: "Improving", color: "#22c55e", arrow: "↓" },
  worsening: { label: "Worsening", color: "#f87171", arrow: "↑" },
  stable: { label: "Stable", color: "#38bdf8", arrow: "→" },
  insufficient_data: { label: "Not enough data", color: "#9ca3af", arrow: "–" },
};

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function CorrelationTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d: CorrelationDay = payload[0]?.payload;
  if (!d) return null;

  return (
    <div style={{
      background: "linear-gradient(135deg, #0f172a 0%, #020617 100%)",
      border: "1px solid rgba(148,163,184,0.2)",
      borderRadius: 10,
      padding: "12px 16px",
      minWidth: 200,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      <p style={{ color: "#38bdf8", fontWeight: 700, margin: "0 0 8px", fontSize: 13 }}>
        {fmt(d.date)}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Row label="Energy" value={`${d.kwh.toLocaleString("it-IT", { maximumFractionDigits: 0 })} kWh`} color="#38bdf8" />
        <Row label="Production" value={`${d.units_produced.toLocaleString("it-IT")} ${d.unit_label}`} color="#818cf8" />
        <Row
          label={`kWh / ${d.unit_label}`}
          value={d.kwh_per_unit.toFixed(3)}
          color={d.is_anomaly ? "#fb923c" : "#22c55e"}
          bold
        />
      </div>
      {d.is_anomaly && d.anomaly_reason && (
        <p style={{
          margin: "10px 0 0",
          padding: "8px 10px",
          background: "rgba(251,146,60,0.12)",
          border: "1px solid rgba(251,146,60,0.3)",
          borderRadius: 6,
          color: "#fb923c",
          fontSize: 11,
          lineHeight: 1.4,
        }}>
          ⚠ {d.anomaly_reason}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, color, bold }: {
  label: string; value: string; color: string; bold?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12 }}>
      <span style={{ color: "#9ca3af" }}>{label}</span>
      <span style={{ color, fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  );
}

// ─── Custom Anomaly Dot ───────────────────────────────────────────────────────

function AnomalyDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.is_anomaly) {
    return <Dot cx={cx} cy={cy} r={3} fill="#22c55e" stroke="transparent" />;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="rgba(251,146,60,0.2)" stroke="#fb923c" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={3} fill="#fb923c" />
    </g>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div style={{
      background: "radial-gradient(circle at top left, #0f172a 0%, #020617 50%)",
      border: "1px solid rgba(148,163,184,0.16)",
      borderRadius: 12,
      padding: "16px 20px",
      flex: 1,
      minWidth: 140,
    }}>
      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: accent || "#e5e7eb", lineHeight: 1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>{sub}</p>
      )}
    </div>
  );
}

// ─── CSV Upload Zone ──────────────────────────────────────────────────────────

function UploadZone({
  siteId,
  onSuccess,
}: {
  siteId: number | string;
  onSuccess: (msg: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setError("Please upload a .csv file");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadProductionCsv(siteId, file);
      const msg = `✓ ${res.inserted} inserted, ${res.updated} updated, ${res.skipped} skipped`;
      setResult(msg);
      onSuccess(msg);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  }, [siteId, onSuccess]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `1.5px dashed ${dragging ? "#22c55e" : "rgba(148,163,184,0.25)"}`,
          borderRadius: 10,
          padding: "20px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "rgba(34,197,94,0.05)" : "transparent",
          transition: "all 0.2s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {loading ? (
          <p style={{ margin: 0, color: "#38bdf8", fontSize: 13 }}>Uploading…</p>
        ) : (
          <>
            <p style={{ margin: "0 0 4px", color: "#e5e7eb", fontSize: 13, fontWeight: 600 }}>
              📂 Drop CSV or click to upload
            </p>
            <p style={{ margin: 0, color: "#9ca3af", fontSize: 11 }}>
              Columns: date, units_produced, [unit_label], [notes]
            </p>
          </>
        )}
      </div>

      {result && (
        <p style={{ margin: "8px 0 0", color: "#22c55e", fontSize: 12 }}>{result}</p>
      )}
      {error && (
        <p style={{ margin: "8px 0 0", color: "#f87171", fontSize: 12 }}>⚠ {error}</p>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  siteId: number | string;
}

export default function ProductionCorrelation({ siteId }: Props) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.toLowerCase().startsWith("it") ? "it" : "en";
  const defaults = defaultDateRange();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [data, setData] = useState<ProductionCorrelationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProductionCorrelation(siteId, start, end);
      setData(res);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [siteId, start, end]);

  const handleDownloadISO50001 = () => {
    if (!data || !data.days || data.days.length === 0) return;
    const headers = [
      "date", "site_id", "kwh", "units_produced", "unit_label",
      "kwh_per_unit", "deviation_from_mean_pct", "is_anomaly",
      "anomaly_reason", "baseline_mean_kwh_per_unit"
    ].join(",");
    const rows = data.days.map((d: CorrelationDay) => {
      const dev = data.mean_kwh_per_unit
        ? (((d.kwh_per_unit - data.mean_kwh_per_unit) / data.mean_kwh_per_unit) * 100).toFixed(2)
        : "";
      return [
        d.date, siteId, d.kwh, d.units_produced, d.unit_label,
        d.kwh_per_unit, dev,
        d.is_anomaly ? "TRUE" : "FALSE",
        `"${(d.anomaly_reason || "").replace(/"/g, '""')}"`,
        data.mean_kwh_per_unit ?? "",
      ].join(",");
    });
    const csv  = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `cei_iso50001_site${siteId}_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const trend = data ? TREND_META[data.trend_direction] : null;
  const anomalies = data?.days.filter(d => d.is_anomaly) ?? [];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div>
          <h3 style={{ margin: 0, color: "#e5e7eb", fontSize: 16, fontWeight: 700 }}>
            Energy Intensity — kWh / unit produced
          </h3>
          <p style={{ margin: "2px 0 0", color: "#9ca3af", fontSize: 12 }}>
            ISO 50001 production correlation
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Date inputs */}
          {(["start", "end"] as const).map(key => (
            <DatePicker
              key={key}
              selected={key === "start" ? (start ? new Date(start) : null) : (end ? new Date(end) : null)}
              onChange={(date: Date | null) => {
                if (date) {
                  const iso = date.toISOString().slice(0, 10);
                  key === "start" ? setStart(iso) : setEnd(iso);
                }
              }}
              dateFormat={lang === "it" ? "dd/MM/yyyy" : "MM/dd/yyyy"}
              placeholderText={lang === "it" ? "gg/mm/aaaa" : "mm/dd/yyyy"}
              customInput={
                <input style={{
                  background: "#0f172a",
                  border: "1px solid rgba(148,163,184,0.2)",
                  borderRadius: 8,
                  color: "#e5e7eb",
                  padding: "6px 10px",
                  fontSize: 12,
                  outline: "none",
                }} />
              }
            />
          ))}

          {/* Load button */}
          <button
            onClick={load}
            disabled={loading}
            style={{
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              border: "none",
              borderRadius: 999,
              color: "#fff",
              fontWeight: 700,
              fontSize: 12,
              padding: "7px 18px",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Loading…" : "Load"}
          </button>

          {/* Upload toggle */}
          <button
            onClick={() => setShowUpload(v => !v)}
            style={{
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.25)",
              borderRadius: 999,
              color: "#9ca3af",
              fontSize: 12,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            {showUpload ? "Hide upload" : "Upload CSV"}
          </button>

          {/* ISO 50001 download */}
          {data && data.days?.length > 0 && (
            <button
              onClick={handleDownloadISO50001}
              style={{
                background: "transparent",
                border: "1px solid rgba(34,197,94,0.3)",
                borderRadius: 999,
                color: "#22c55e",
                fontSize: 12,
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              ↓ ISO 50001 CSV
            </button>
          )}
        </div>
      </div>

      {/* ── CSV Upload ── */}
      {showUpload && (
        <UploadZone
          siteId={siteId}
          onSuccess={() => { setShowUpload(false); load(); }}
        />
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: "12px 16px",
          background: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.25)",
          borderRadius: 10,
          color: "#f87171",
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* ── Empty state ── */}
      {!data && !loading && !error && (
        <div style={{
          textAlign: "center",
          padding: "48px 24px",
          color: "#9ca3af",
          background: "radial-gradient(circle at top left, #0f172a 0%, #020617 50%)",
          border: "1px solid rgba(148,163,184,0.1)",
          borderRadius: 14,
        }}>
          <p style={{ fontSize: 32, margin: "0 0 8px" }}>⚡</p>
          <p style={{ margin: "0 0 4px", color: "#e5e7eb", fontWeight: 600 }}>No data loaded yet</p>
          <p style={{ margin: 0, fontSize: 12 }}>
            Upload a production CSV then click Load to see kWh per unit
          </p>
        </div>
      )}

      {/* ── KPI Cards ── */}
      {data && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiCard
              label={`Mean kWh / ${data.unit_label}`}
              value={data.mean_kwh_per_unit?.toFixed(3) ?? "—"}
              sub="energy intensity"
              accent="#38bdf8"
            />
            <KpiCard
              label="Trend"
              value={`${trend?.arrow} ${trend?.label}`}
              sub={data.trend_slope != null ? `${data.trend_slope > 0 ? "+" : ""}${data.trend_slope.toFixed(4)} / day` : undefined}
              accent={trend?.color}
            />
            <KpiCard
              label="Anomalies"
              value={String(data.anomaly_count)}
              sub={`${data.coverage_days} days coverage`}
              accent={data.anomaly_count > 0 ? "#fb923c" : "#22c55e"}
            />
            <KpiCard
              label="Best day"
              value={data.best_day ? `${data.best_day.kwh_per_unit.toFixed(3)}` : "—"}
              sub={data.best_day ? fmt(data.best_day.date, lang === "it" ? "it-IT" : "en-US") : undefined}
              accent="#22c55e"
            />
            <KpiCard
              label="Worst day"
              value={data.worst_day ? `${data.worst_day.kwh_per_unit.toFixed(3)}` : "—"}
              sub={data.worst_day ? fmt(data.worst_day.date, lang === "it" ? "it-IT" : "en-US") : undefined}
              accent="#f87171"
            />
          </div>

          {/* ── Chart ── */}
          {data.days.length === 0 ? (
            <div style={{
              textAlign: "center",
              padding: "40px",
              background: "radial-gradient(circle at top left, #0f172a 0%, #020617 50%)",
              border: "1px solid rgba(148,163,184,0.1)",
              borderRadius: 14,
              color: "#9ca3af",
              fontSize: 13,
            }}>
              No days with both energy and production data in this range.
            </div>
          ) : (
            <div style={{
              background: "radial-gradient(circle at top left, #0f172a 0%, #020617 50%)",
              border: "1px solid rgba(148,163,184,0.16)",
              borderRadius: 14,
              padding: "20px 16px 12px",
            }}>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={data.days} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148,163,184,0.08)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => fmt(d, lang === "it" ? "it-IT" : "en-US")}
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    axisLine={{ stroke: "rgba(148,163,184,0.12)" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  {/* Left axis — kWh */}
                  <YAxis
                    yAxisId="kwh"
                    orientation="left"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                    width={36}
                  />
                  {/* Right axis — kWh/unit */}
                  <YAxis
                    yAxisId="kpu"
                    orientation="right"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => v.toFixed(1)}
                    width={32}
                  />

                  <Tooltip content={<CorrelationTooltip />} />

                  <Legend
                    wrapperStyle={{ fontSize: 12, color: "#9ca3af", paddingTop: 8 }}
                    formatter={val => (
                      <span style={{ color: "#9ca3af" }}>{val}</span>
                    )}
                  />

                  {/* Mean kWh/unit reference line */}
                  {data.mean_kwh_per_unit != null && (
                    <ReferenceLine
                      yAxisId="kpu"
                      y={data.mean_kwh_per_unit}
                      stroke="rgba(34,197,94,0.35)"
                      strokeDasharray="6 3"
                      label={{
                        value: `avg ${data.mean_kwh_per_unit.toFixed(2)}`,
                        fill: "#22c55e",
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  )}

                  {/* Energy bars */}
                  <Bar
                    yAxisId="kwh"
                    dataKey="kwh"
                    name="kWh"
                    fill="rgba(56,189,248,0.18)"
                    stroke="#38bdf8"
                    strokeWidth={1}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />

                  {/* kWh/unit line */}
                  <Line
                    yAxisId="kpu"
                    dataKey="kwh_per_unit"
                    name={`kWh / ${data.unit_label}`}
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={<AnomalyDot />}
                    activeDot={{ r: 5, fill: "#22c55e" }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Anomaly table ── */}
          {anomalies.length > 0 && (
            <div style={{
              background: "radial-gradient(circle at top left, #0f172a 0%, #020617 50%)",
              border: "1px solid rgba(251,146,60,0.2)",
              borderRadius: 14,
              overflow: "hidden",
            }}>
              <div style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(148,163,184,0.1)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{ color: "#fb923c", fontSize: 14 }}>⚠</span>
                <span style={{ color: "#e5e7eb", fontWeight: 700, fontSize: 14 }}>
                  Anomaly Days ({anomalies.length})
                </span>
                <span style={{ color: "#9ca3af", fontSize: 12 }}>
                  — days where energy intensity spiked unexpectedly
                </span>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                    {["Date", "kWh", `${data.unit_label} produced`, `kWh / ${data.unit_label}`, "Reason"].map(h => (
                      <th key={h} style={{
                        padding: "10px 20px",
                        textAlign: "left",
                        color: "#9ca3af",
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a, i) => (
                    <tr
                      key={a.date}
                      style={{
                        borderBottom: i < anomalies.length - 1 ? "1px solid rgba(148,163,184,0.06)" : "none",
                        background: "rgba(251,146,60,0.03)",
                      }}
                    >
                      <td style={{ padding: "10px 20px", color: "#fb923c", fontWeight: 600, fontSize: 13 }}>
                        {fmt(a.date, lang === "it" ? "it-IT" : "en-US")}
                      </td>
                      <td style={{ padding: "10px 20px", color: "#e5e7eb", fontSize: 13 }}>
                        {a.kwh.toLocaleString("it-IT", { maximumFractionDigits: 0 })}
                      </td>
                      <td style={{ padding: "10px 20px", color: "#e5e7eb", fontSize: 13 }}>
                        {a.units_produced.toLocaleString("it-IT")}
                      </td>
                      <td style={{ padding: "10px 20px", color: "#fb923c", fontWeight: 700, fontSize: 13 }}>
                        {a.kwh_per_unit.toFixed(3)}
                      </td>
                      <td style={{ padding: "10px 20px", color: "#9ca3af", fontSize: 12, maxWidth: 320 }}>
                        {a.anomaly_reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
