// src/components/SiteEnergyChart.tsx
import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HourBand {
  hour: number;
  actual_kwh: number;
  expected_kwh: number;
  delta_kwh: number;
  delta_pct: number;
  z_score: number;
  band: string;
}

interface ChartPoint {
  label: string;
  hour: number;
  actual: number;
  baseline: number;
  delta_pct: number;
  band: string;
}

interface Props {
  hours: HourBand[];
  windowHours?: number;
  siteName?: string | null;
  loading?: boolean;
}

// ─── Band config ──────────────────────────────────────────────────────────────

const BAND: Record<string, { dot: string; glow: string; label: string }> = {
  critical: { dot: "#f87171", glow: "rgba(248,113,113,0.5)", label: "Critical" },
  elevated: { dot: "#fb923c", glow: "rgba(251,146,60,0.5)", label: "Elevated" },
  below:    { dot: "#22c55e", glow: "rgba(34,197,94,0.4)",  label: "Below baseline" },
  normal:   { dot: "#38bdf8", glow: "rgba(56,189,248,0.3)", label: "Normal" },
};

// Night hours (22:00–06:00) for subtle background shading
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5, 6]);

// ─── Custom dot — colours by band ────────────────────────────────────────────

function ActualDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;

  const cfg = BAND[payload.band] ?? BAND.normal;
  const anomalous = payload.band === "critical" || payload.band === "elevated";

  return (
    <g>
      {anomalous && (
        <circle cx={cx} cy={cy} r={9} fill={cfg.glow} />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={anomalous ? 5 : 3.5}
        fill={cfg.dot}
        stroke={anomalous ? "rgba(2,6,23,0.8)" : "transparent"}
        strokeWidth={anomalous ? 1.5 : 0}
      />
    </g>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;

  const point: ChartPoint = payload[0]?.payload;
  if (!point) return null;

  const cfg = BAND[point.band] ?? BAND.normal;
  const isOver  = point.delta_pct > 10;
  const isUnder = point.delta_pct < -10;
  const deltaColor = isOver ? "#f87171" : isUnder ? "#22c55e" : "#9ca3af";
  const sign = point.delta_pct >= 0 ? "+" : "";

  return (
    <div style={{
      background: "linear-gradient(135deg, #0f172a 0%, #020617 100%)",
      border: "1px solid rgba(148,163,184,0.18)",
      borderRadius: 10,
      padding: "12px 16px",
      minWidth: 190,
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Hour label */}
      <p style={{ margin: "0 0 10px", color: "#38bdf8", fontWeight: 700, fontSize: 13 }}>
        {point.label}
      </p>

      {/* Actual */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "#9ca3af", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 8, height: 2, background: "#38bdf8", borderRadius: 1 }} />
          Actual
        </span>
        <span style={{ color: "#e5e7eb", fontWeight: 600 }}>
          {point.actual.toFixed(1)} kWh
        </span>
      </div>

      {/* Baseline */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 8 }}>
        <span style={{ color: "#9ca3af", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 8, height: 0, borderTop: "2px dashed #475569" }} />
          Baseline
        </span>
        <span style={{ color: "#9ca3af" }}>
          {point.baseline.toFixed(1)} kWh
        </span>
      </div>

      {/* Deviation */}
      <div style={{
        paddingTop: 8,
        borderTop: "1px solid rgba(148,163,184,0.1)",
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        fontSize: 12,
      }}>
        <span style={{ color: "#9ca3af" }}>vs baseline</span>
        <span style={{ color: deltaColor, fontWeight: 700 }}>
          {sign}{point.delta_pct.toFixed(1)}%
        </span>
      </div>

      {/* Band badge */}
      {point.band !== "normal" && (
        <div style={{
          marginTop: 8,
          padding: "3px 10px",
          borderRadius: 999,
          background: `${cfg.glow}`,
          color: cfg.dot,
          fontSize: 11,
          fontWeight: 700,
          textAlign: "center",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}>
          {cfg.label}
        </div>
      )}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function ChartLegend() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
      paddingTop: 10,
      fontSize: 12,
      color: "#9ca3af",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="20" height="4">
          <line x1="0" y1="2" x2="20" y2="2" stroke="#38bdf8" strokeWidth="2" />
          <circle cx="10" cy="2" r="3" fill="#38bdf8" />
        </svg>
        Actual kWh
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="20" height="4">
          <line x1="0" y1="2" x2="20" y2="2" stroke="#475569" strokeWidth="2" strokeDasharray="4 2" />
        </svg>
        Baseline
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="10" height="10">
          <circle cx="5" cy="5" r="4" fill="rgba(251,146,60,0.3)" stroke="#fb923c" strokeWidth="1" />
          <circle cx="5" cy="5" r="2" fill="#fb923c" />
        </svg>
        Anomaly
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="16" height="10">
          <rect width="16" height="10" fill="rgba(148,163,184,0.06)" rx="2" />
        </svg>
        Night hours
      </span>
    </div>
  );
}

// ─── Empty / loading states ───────────────────────────────────────────────────

function EmptyState({ loading }: { loading?: boolean }) {
  return (
    <div style={{
      height: 280,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: "#9ca3af",
      gap: 8,
    }}>
      {loading ? (
        <>
          <div style={{
            width: 28,
            height: 28,
            border: "2px solid rgba(56,189,248,0.2)",
            borderTopColor: "#38bdf8",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <p style={{ margin: 0, fontSize: 13 }}>Loading chart…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
            No hourly data
          </p>
          <p style={{ margin: 0, fontSize: 12 }}>
            Upload timeseries data for this site to see the energy chart.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SiteEnergyChart: React.FC<Props> = ({
  hours,
  windowHours = 24,
  siteName,
  loading = false,
}) => {
  const chartData = useMemo((): ChartPoint[] => {
    if (!Array.isArray(hours) || hours.length === 0) return [];

    return [...hours]
      .sort((a, b) => a.hour - b.hour)
      .map((h) => ({
        label: `${String(h.hour).padStart(2, "0")}:00`,
        hour: h.hour,
        actual:    Number(h.actual_kwh)   || 0,
        baseline:  Number(h.expected_kwh) || 0,
        delta_pct: Number(h.delta_pct)    || 0,
        band:      h.band || "normal",
      }));
  }, [hours]);

  if (loading || chartData.length === 0) {
    return <EmptyState loading={loading} />;
  }

  const allValues = chartData.flatMap((d) => [d.actual, d.baseline]).filter((v) => v > 0);
  const yMax = allValues.length > 0 ? Math.ceil(Math.max(...allValues) * 1.18) : 100;

  // Build night ReferenceArea ranges: consecutive night hours grouped together
  // so we can render one shaded block per contiguous night run
  const nightRanges: { x1: string; x2: string }[] = [];
  let nightStart: string | null = null;
  chartData.forEach((d, i) => {
    const isNight = NIGHT_HOURS.has(d.hour);
    if (isNight && nightStart === null) {
      nightStart = d.label;
    }
    if (!isNight && nightStart !== null) {
      const prev = chartData[i - 1];
      nightRanges.push({ x1: nightStart, x2: prev.label });
      nightStart = null;
    }
    if (i === chartData.length - 1 && nightStart !== null) {
      nightRanges.push({ x1: nightStart, x2: d.label });
      nightStart = null;
    }
  });

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>

          {/* Night shading */}
          {nightRanges.map((r, i) => (
            <ReferenceArea
              key={i}
              x1={r.x1}
              x2={r.x2}
              fill="rgba(148,163,184,0.05)"
              stroke="none"
            />
          ))}

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(148,163,184,0.07)"
            vertical={false}
          />

          <XAxis
            dataKey="label"
            tick={{ fill: "#9ca3af", fontSize: 10.5 }}
            axisLine={{ stroke: "rgba(148,163,184,0.1)" }}
            tickLine={false}
            interval={2}
          />

          <YAxis
            domain={[0, yMax]}
            tick={{ fill: "#9ca3af", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) =>
              v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))
            }
            width={36}
          />

          <Tooltip
            content={<ChartTooltip />}
            cursor={{
              stroke: "rgba(148,163,184,0.15)",
              strokeWidth: 1,
              strokeDasharray: "4 2",
            }}
          />

          {/* Baseline — dashed, muted */}
          <Line
            type="monotone"
            dataKey="baseline"
            name="baseline"
            stroke="#475569"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 4, fill: "#475569", stroke: "transparent" }}
          />

          {/* Actual — solid, coloured dots by band */}
          <Line
            type="monotone"
            dataKey="actual"
            name="actual"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={<ActualDot />}
            activeDot={{ r: 5, fill: "#38bdf8", stroke: "rgba(56,189,248,0.3)", strokeWidth: 4 }}
          />

        </ComposedChart>
      </ResponsiveContainer>

      <ChartLegend />
    </div>
  );
};

export default SiteEnergyChart;
