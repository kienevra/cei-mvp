// src/components/SiteForecastChart.tsx
import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ForecastPoint {
  ts: string;
  expected_kwh: number;
  lower_kwh?: number | null;
  upper_kwh?: number | null;
  basis?: string | null;
}

interface ChartPoint {
  label: string;
  ts: string;
  expected: number;
  lower: number;
  upper: number;
  band_fill: [number, number]; // for Area stacking: [lower, upper-lower]
  basis: string;
}

interface Props {
  points: ForecastPoint[];
  method?: string;
  loading?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHour(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtFull(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const isStub = (method?: string) =>
  !method || method.includes("stub") || method.includes("baseline");

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ForecastTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;

  const point: ChartPoint = payload[0]?.payload;
  if (!point) return null;

  const hasCI = point.lower > 0 && point.upper > 0 && point.lower !== point.upper;
  const spread = hasCI ? point.upper - point.lower : null;

  return (
    <div style={{
      background: "linear-gradient(135deg, #0f172a 0%, #020617 100%)",
      border: "1px solid rgba(56,189,248,0.2)",
      borderRadius: 10,
      padding: "12px 16px",
      minWidth: 200,
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Timestamp */}
      <p style={{ margin: "0 0 10px", color: "#38bdf8", fontWeight: 700, fontSize: 13 }}>
        {fmtFull(point.ts)}
      </p>

      {/* Expected */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "#9ca3af", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 8, height: 2, background: "#38bdf8", borderRadius: 1 }} />
          Forecast
        </span>
        <span style={{ color: "#e5e7eb", fontWeight: 700 }}>
          {point.expected.toFixed(1)} kWh
        </span>
      </div>

      {/* Confidence band */}
      {hasCI && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: "#9ca3af" }}>Upper bound</span>
            <span style={{ color: "#64748b" }}>{point.upper.toFixed(1)} kWh</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 8 }}>
            <span style={{ color: "#9ca3af" }}>Lower bound</span>
            <span style={{ color: "#64748b" }}>{point.lower.toFixed(1)} kWh</span>
          </div>
          <div style={{
            paddingTop: 8,
            borderTop: "1px solid rgba(148,163,184,0.1)",
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            fontSize: 12,
          }}>
            <span style={{ color: "#9ca3af" }}>CI spread</span>
            <span style={{ color: "#94a3b8" }}>±{(spread! / 2).toFixed(1)} kWh</span>
          </div>
        </>
      )}

      {/* Method badge */}
      <div style={{
        marginTop: 8,
        padding: "3px 10px",
        borderRadius: 999,
        background: "rgba(56,189,248,0.08)",
        border: "1px solid rgba(56,189,248,0.15)",
        color: "#38bdf8",
        fontSize: 10,
        fontWeight: 600,
        textAlign: "center",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}>
        {point.basis || "forecast"}
      </div>
    </div>
  );
}

// ─── Custom legend ────────────────────────────────────────────────────────────

function ForecastLegend({ hasCI, isStubMethod }: { hasCI: boolean; isStubMethod: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexWrap: "wrap",
      gap: 20,
      paddingTop: 10,
      fontSize: 12,
      color: "#9ca3af",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="20" height="8">
          <line x1="0" y1="4" x2="20" y2="4" stroke="#38bdf8" strokeWidth="2" />
          <circle cx="10" cy="4" r="3" fill="#38bdf8" />
        </svg>
        Forecast kWh
      </span>

      {hasCI && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="20" height="10">
            <rect width="20" height="10" fill="rgba(56,189,248,0.12)" rx="2" />
          </svg>
          80% confidence interval
        </span>
      )}

      {isStubMethod && (
        <span style={{
          padding: "2px 8px",
          borderRadius: 999,
          background: "rgba(251,146,60,0.1)",
          border: "1px solid rgba(251,146,60,0.25)",
          color: "#fb923c",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.04em",
        }}>
          BASELINE STUB — upgrade to Prophet for live forecasting
        </span>
      )}
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
          <p style={{ margin: 0, fontSize: 13 }}>Building forecast…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
            No forecast available
          </p>
          <p style={{ margin: 0, fontSize: 12, textAlign: "center", maxWidth: 280 }}>
            Not enough historical data yet. CEI needs at least a few days of readings to build a baseline forecast.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SiteForecastChart: React.FC<Props> = ({ points, method, loading = false }) => {
  const { chartData, hasCI } = useMemo(() => {
    if (!Array.isArray(points) || points.length === 0) {
      return { chartData: [], hasCI: false };
    }

    let ciFound = false;
    const data: ChartPoint[] = points.map((p) => {
      const expected = Number(p.expected_kwh) || 0;
      const lower = Number(p.lower_kwh) || 0;
      const upper = Number(p.upper_kwh) || 0;

      if (lower > 0 && upper > 0 && upper > lower) ciFound = true;

      return {
        label:     fmtHour(p.ts),
        ts:        p.ts,
        expected,
        lower:     lower || expected,
        upper:     upper || expected,
        // Area chart stacking: render transparent base then the CI spread on top
        band_fill: [lower || expected, (upper || expected) - (lower || expected)],
        basis:     p.basis || method || "forecast",
      };
    });

    return { chartData: data, hasCI: ciFound };
  }, [points, method]);

  if (loading || chartData.length === 0) {
    return <EmptyState loading={loading} />;
  }

  const allValues = chartData.flatMap((d) => [d.expected, d.upper]).filter((v) => v > 0);
  const yMax = allValues.length > 0 ? Math.ceil(Math.max(...allValues) * 1.18) : 100;

  const stubMethod = isStub(method);

  // "Now" reference line — first point is 1h from now, so we mark the boundary
  const firstTs = chartData[0]?.label;

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>

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
            content={<ForecastTooltip />}
            cursor={{
              stroke: "rgba(148,163,184,0.15)",
              strokeWidth: 1,
              strokeDasharray: "4 2",
            }}
          />

          {/* "Now" boundary marker */}
          {firstTs && (
            <ReferenceLine
              x={firstTs}
              stroke="rgba(148,163,184,0.2)"
              strokeDasharray="3 3"
              label={{
                value: "now →",
                fill: "#64748b",
                fontSize: 10,
                position: "insideTopLeft",
              }}
            />
          )}

          {/* Confidence interval — transparent base layer */}
          {hasCI && (
            <Area
              type="monotone"
              dataKey="lower"
              stroke="none"
              fill="transparent"
              legendType="none"
              activeDot={false}
              dot={false}
              isAnimationActive={false}
            />
          )}

          {/* Confidence interval — visible fill (stacked on top of base) */}
          {hasCI && (
            <Area
              type="monotone"
              dataKey="upper"
              stroke="none"
              fill="rgba(56,189,248,0.10)"
              strokeWidth={0}
              legendType="none"
              activeDot={false}
              dot={false}
              isAnimationActive={false}
              baseValue="dataMin"
            />
          )}

          {/* Forecast line */}
          <Line
            type="monotone"
            dataKey="expected"
            name="expected"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{
              r: 3.5,
              fill: "#38bdf8",
              stroke: "rgba(2,6,23,0.8)",
              strokeWidth: 1,
            }}
            activeDot={{
              r: 5,
              fill: "#38bdf8",
              stroke: "rgba(56,189,248,0.35)",
              strokeWidth: 4,
            }}
          />

        </ComposedChart>
      </ResponsiveContainer>

      <ForecastLegend hasCI={hasCI} isStubMethod={stubMethod} />
    </div>
  );
};

export default SiteForecastChart;
