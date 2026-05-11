// src/components/PortfolioTrendChart.tsx
import React, { useMemo } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeriesPoint {
  ts: string;
  value: number;
}

interface ChartPoint {
  label: string;
  ts: string;
  kwh: number;
  isPeak: boolean;
  isNight: boolean;
}

interface Props {
  points: SeriesPoint[];
  loading?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5, 6]);

function fmtHour(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtFull(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function PortfolioTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point: ChartPoint = payload[0]?.payload;
  if (!point) return null;

  return (
    <div style={{
      background: "linear-gradient(135deg, #0f172a 0%, #020617 100%)",
      border: "1px solid rgba(148,163,184,0.18)",
      borderRadius: 10,
      padding: "12px 16px",
      minWidth: 170,
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <p style={{ margin: "0 0 8px", color: "#38bdf8", fontWeight: 700, fontSize: 13 }}>
        {fmtFull(point.ts)}
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "#9ca3af" }}>Portfolio kWh</span>
        <span style={{ color: "#e5e7eb", fontWeight: 700 }}>
          {point.kwh >= 1000
            ? `${(point.kwh / 1000).toFixed(2)} MWh`
            : `${point.kwh.toFixed(1)} kWh`}
        </span>
      </div>

      {point.isPeak && (
        <div style={{
          marginTop: 6,
          padding: "3px 10px",
          borderRadius: 999,
          background: "rgba(251,146,60,0.12)",
          border: "1px solid rgba(251,146,60,0.3)",
          color: "#fb923c",
          fontSize: 10,
          fontWeight: 700,
          textAlign: "center",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}>
          Peak hour
        </div>
      )}

      {point.isNight && (
        <div style={{
          marginTop: point.isPeak ? 4 : 6,
          padding: "3px 10px",
          borderRadius: 999,
          background: "rgba(148,163,184,0.08)",
          border: "1px solid rgba(148,163,184,0.15)",
          color: "#64748b",
          fontSize: 10,
          fontWeight: 600,
          textAlign: "center",
          letterSpacing: "0.04em",
        }}>
          Night hours
        </div>
      )}
    </div>
  );
}

// ─── Custom dot — only renders on peak hour ───────────────────────────────────

function PeakDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.isPeak || cx == null || cy == null) {
    // Render small normal dot for all non-peak hours
    return <circle cx={cx} cy={cy} r={2.5} fill="#38bdf8" opacity={0.6} />;
  }

  // Peak hour — glowing amber dot
  return (
    <g>
      <circle cx={cx} cy={cy} r={10} fill="rgba(251,146,60,0.15)" />
      <circle cx={cx} cy={cy} r={6} fill="rgba(251,146,60,0.25)" />
      <circle cx={cx} cy={cy} r={4} fill="#fb923c" stroke="rgba(2,6,23,0.8)" strokeWidth={1.5} />
    </g>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function TrendLegend() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 20,
      paddingTop: 10,
      fontSize: 12,
      color: "#9ca3af",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="20" height="10">
          <defs>
            <linearGradient id="lg-legend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <rect width="20" height="10" fill="url(#lg-legend)" rx="2" />
          <line x1="0" y1="2" x2="20" y2="2" stroke="#38bdf8" strokeWidth="1.5" />
        </svg>
        Portfolio kWh/h
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="10" height="10">
          <circle cx="5" cy="5" r="4" fill="rgba(251,146,60,0.25)" stroke="#fb923c" strokeWidth="1" />
          <circle cx="5" cy="5" r="2" fill="#fb923c" />
        </svg>
        Peak hour
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
      height: 260,
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
          <p style={{ margin: 0, fontSize: 13 }}>Loading portfolio trend…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
            No trend data yet
          </p>
          <p style={{ margin: 0, fontSize: 12, textAlign: "center", maxWidth: 280 }}>
            Upload a CSV or connect a live feed to see the portfolio energy trend here.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PortfolioTrendChart: React.FC<Props> = ({ points, loading = false }) => {
  const { chartData, peakLabel } = useMemo(() => {
    if (!Array.isArray(points) || points.length === 0) {
      return { chartData: [], peakLabel: null };
    }

    const mapped = points.map((p) => ({
      label: fmtHour(p.ts),
      ts: p.ts,
      kwh: Number(p.value) || 0,
      isPeak: false,
      isNight: NIGHT_HOURS.has(new Date(p.ts).getHours()),
    }));

    // Mark the single peak hour
    const maxKwh = Math.max(...mapped.map((d) => d.kwh));
    let peakIdx = -1;
    mapped.forEach((d, i) => {
      if (d.kwh === maxKwh) {
        d.isPeak = true;
        peakIdx = i;
      }
    });

    return {
      chartData: mapped,
      peakLabel: peakIdx >= 0 ? mapped[peakIdx].label : null,
    };
  }, [points]);

  if (loading || chartData.length === 0) {
    return <EmptyState loading={loading} />;
  }

  const allValues = chartData.map((d) => d.kwh).filter((v) => v > 0);
  const yMax = allValues.length > 0 ? Math.ceil(Math.max(...allValues) * 1.2) : 100;

  // Night reference lines (mark boundaries between night/day transitions)
  const nightRanges: { x1: string; x2: string }[] = [];
  let nightStart: string | null = null;
  chartData.forEach((d, i) => {
    if (d.isNight && nightStart === null) nightStart = d.label;
    if (!d.isNight && nightStart !== null) {
      nightRanges.push({ x1: nightStart, x2: chartData[i - 1].label });
      nightStart = null;
    }
    if (i === chartData.length - 1 && nightStart !== null) {
      nightRanges.push({ x1: nightStart, x2: d.label });
      nightStart = null;
    }
  });

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>

          {/* SVG gradient defs for area fill */}
          <defs>
            <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#38bdf8" stopOpacity={0.25} />
              <stop offset="60%"  stopColor="#38bdf8" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Night shading */}
          {nightRanges.map((r, i) => (
            <ReferenceLine
              key={`night-start-${i}`}
              x={r.x1}
              stroke="transparent"
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
            content={<PortfolioTooltip />}
            cursor={{
              stroke: "rgba(148,163,184,0.15)",
              strokeWidth: 1,
              strokeDasharray: "4 2",
            }}
          />

          {/* Peak hour reference line */}
          {peakLabel && (
            <ReferenceLine
              x={peakLabel}
              stroke="rgba(251,146,60,0.25)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}

          {/* Gradient area fill */}
          <Area
            type="monotone"
            dataKey="kwh"
            stroke="none"
            fill="url(#portfolioGradient)"
            isAnimationActive={true}
            animationDuration={600}
            dot={false}
            activeDot={false}
          />

          {/* Main line with peak dots */}
          <Line
            type="monotone"
            dataKey="kwh"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={<PeakDot />}
            activeDot={{
              r: 5,
              fill: "#38bdf8",
              stroke: "rgba(56,189,248,0.35)",
              strokeWidth: 4,
            }}
            isAnimationActive={true}
            animationDuration={600}
          />

        </ComposedChart>
      </ResponsiveContainer>

      <TrendLegend />
    </div>
  );
};

export default PortfolioTrendChart;
