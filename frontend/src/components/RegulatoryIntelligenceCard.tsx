// frontend/src/components/RegulatoryIntelligenceCard.tsx
/**
 * Regulatory Intelligence Engine — live ETS/CBAM position card.
 *
 * Shows the factory's current regulatory exposure in plain language:
 * - Projected annual CO₂ vs free allocation
 * - ETS surplus or deficit in tonnes and €
 * - CBAM readiness flag
 * - Sector benchmark gap
 *
 * Data source: GET /api/v1/emissions/calculate/site/{id}
 * No new backend endpoint needed — reuses existing EmissionsResult.
 */

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCheckCircle, FiInfo, FiRefreshCw, FiTrendingDown, FiTrendingUp } from "react-icons/fi";
import { calculateSiteEmissions, type EmissionsResult } from "../services/api";

interface Props {
  siteId: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `€${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ── KPI chip ──────────────────────────────────────────────────────────────────

interface ChipProps {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}

function KpiChip({ label, value, sub, color = "var(--cei-text-main, #e2e8f0)", icon }: ChipProps) {
  return (
    <div style={{
      border: "1px solid var(--cei-border-subtle, rgba(148,163,184,0.2))",
      borderRadius: "0.5rem",
      padding: "0.75rem 1rem",
      background: "rgba(15,23,42,0.4)",
      display: "flex",
      flexDirection: "column",
      gap: "0.2rem",
      minWidth: "140px",
    }}>
      <span style={{ fontSize: "0.68rem", color: "var(--cei-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        {icon && <span style={{ color, fontSize: "0.9rem" }}>{icon}</span>}
        <span style={{ fontSize: "1.15rem", fontWeight: 700, color }}>{value}</span>
      </div>
      {sub && <span style={{ fontSize: "0.68rem", color: "var(--cei-text-muted, #94a3b8)" }}>{sub}</span>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const RegulatoryIntelligenceCard: React.FC<Props> = ({ siteId }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<EmissionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId) return;
    setLoading(true);
    setError(null);
    calculateSiteEmissions(siteId, 168)
      .then(setData)
      .catch(() => setError("Could not load regulatory data."))
      .finally(() => setLoading(false));
  }, [siteId]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ border: "1px solid var(--cei-border-subtle, rgba(148,163,184,0.2))", borderRadius: "0.65rem", padding: "1.5rem", background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <FiRefreshCw style={{ animation: "spin 1s linear infinite", color: "#94a3b8" }} />
        <span style={{ fontSize: "0.82rem", color: "var(--cei-text-muted, #94a3b8)" }}>Loading regulatory position…</span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div style={{ border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.65rem", padding: "1rem", background: "rgba(239,68,68,0.06)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <FiAlertTriangle style={{ color: "#ef4444", flexShrink: 0 }} />
        <span style={{ fontSize: "0.8rem", color: "#fca5a5" }}>
          {error || "Configure emissions settings for this site to see regulatory position."}
        </span>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const {
    annualised_tco2,
    free_allocation_tonnes,
    ets_surplus_deficit,
    ets_credit_cost_eur,
    ets_position_label,
    benchmark_gap_pct,
    benchmark_position_label,
    is_cbam_ready,
    framework,
    sector_code,
    country_code,
    factor_source,
  } = data;

  const hasFreAlloc = free_allocation_tonnes != null && free_allocation_tonnes > 0;
  const hasSurplusDeficit = ets_surplus_deficit != null;
  const isDeficit = hasSurplusDeficit && ets_surplus_deficit! < 0;
  const isSurplus = hasSurplusDeficit && ets_surplus_deficit! > 0;

  // ETS position colour
  const etsColor = isDeficit
    ? "#ef4444"
    : isSurplus
    ? "#22c55e"
    : "var(--cei-text-main, #e2e8f0)";

  // Benchmark colour
  const benchColor = benchmark_gap_pct == null
    ? "var(--cei-text-muted, #94a3b8)"
    : benchmark_gap_pct > 0
    ? "#ef4444"
    : "#22c55e";

  // Plain language ETS sentence
  const etsNarrative = (() => {
    if (!hasFreAlloc) {
      return `Projected annual emissions: ${fmt(annualised_tco2, 1)} tCO₂. No free allocation configured — set up site config to calculate ETS exposure.`;
    }
    if (isDeficit) {
      return `At current consumption you will need to purchase approximately ${fmt(Math.abs(ets_surplus_deficit!), 0)} allowances this year — estimated exposure ${fmtEur(ets_credit_cost_eur)}.`;
    }
    if (isSurplus) {
      return `At current consumption you are on track to have a surplus of ${fmt(ets_surplus_deficit!, 0)} tCO₂ allowances — you may be able to sell or bank these.`;
    }
    return `Projected annual emissions are approximately in line with your free allocation.`;
  })();

  return (
    <div style={{
      border: "1px solid var(--cei-border-subtle, rgba(148,163,184,0.2))",
      borderRadius: "0.65rem",
      background: "rgba(15,23,42,0.5)",
      overflow: "hidden",
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "1rem 1.25rem 0.75rem",
        borderBottom: "1px solid rgba(148,163,184,0.1)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "0.5rem",
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "var(--cei-text-main, #e2e8f0)" }}>
            Regulatory Intelligence
          </h3>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.72rem", color: "var(--cei-text-muted, #94a3b8)" }}>
            ETS position · CBAM readiness · Sector benchmark — based on last 7 days extrapolated annually
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
          <span style={{
            fontSize: "0.65rem", fontWeight: 600, padding: "2px 8px", borderRadius: "999px",
            background: "rgba(59,130,246,0.15)", color: "#93c5fd",
          }}>
            {framework}
          </span>
          {sector_code && (
            <span style={{
              fontSize: "0.65rem", fontWeight: 600, padding: "2px 8px", borderRadius: "999px",
              background: "rgba(148,163,184,0.1)", color: "#94a3b8",
            }}>
              {sector_code}
            </span>
          )}
        </div>
      </div>

      {/* ── KPI chips ── */}
      <div style={{ padding: "1rem 1.25rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <KpiChip
          label="Annual CO₂ (projected)"
          value={`${fmt(annualised_tco2, 1)} tCO₂`}
          sub={`Based on ${fmt(data.total_tco2, 2)} tCO₂ last 7 days`}
        />

        {hasFreAlloc && (
          <KpiChip
            label="Free allocation"
            value={`${fmt(free_allocation_tonnes, 0)} tCO₂`}
            sub="Annual EU ETS free quota"
          />
        )}

        {hasSurplusDeficit && (
          <KpiChip
            label={isDeficit ? "Allowances to buy" : "Surplus allowances"}
            value={`${fmt(Math.abs(ets_surplus_deficit!), 0)} tCO₂`}
            sub={isDeficit ? fmtEur(ets_credit_cost_eur) + " estimated cost" : "Bankable or tradeable"}
            color={etsColor}
            icon={isDeficit ? <FiTrendingUp /> : <FiTrendingDown />}
          />
        )}

        {benchmark_gap_pct != null && (
          <KpiChip
            label="vs sector benchmark"
            value={`${benchmark_gap_pct > 0 ? "+" : ""}${fmt(benchmark_gap_pct, 1)}%`}
            sub={benchmark_position_label || "EU ETS Phase 4"}
            color={benchColor}
            icon={benchmark_gap_pct > 0 ? <FiTrendingUp /> : <FiTrendingDown />}
          />
        )}

        <KpiChip
          label="CBAM ready"
          value={is_cbam_ready ? "Yes" : "No"}
          sub={is_cbam_ready ? "Documentation sufficient" : "Configure site emissions"}
          color={is_cbam_ready ? "#22c55e" : "#f59e0b"}
          icon={is_cbam_ready ? <FiCheckCircle /> : <FiInfo />}
        />
      </div>

      {/* ── Narrative ── */}
      <div style={{
        margin: "0 1.25rem 1rem",
        padding: "0.75rem 1rem",
        borderRadius: "0.5rem",
        background: isDeficit
          ? "rgba(239,68,68,0.07)"
          : isSurplus
          ? "rgba(34,197,94,0.07)"
          : "rgba(148,163,184,0.07)",
        border: `1px solid ${isDeficit ? "rgba(239,68,68,0.2)" : isSurplus ? "rgba(34,197,94,0.2)" : "rgba(148,163,184,0.15)"}`,
        display: "flex",
        gap: "0.6rem",
        alignItems: "flex-start",
      }}>
        {isDeficit
          ? <FiAlertTriangle style={{ color: "#ef4444", flexShrink: 0, marginTop: "2px" }} />
          : isSurplus
          ? <FiTrendingDown style={{ color: "#22c55e", flexShrink: 0, marginTop: "2px" }} />
          : <FiInfo style={{ color: "#94a3b8", flexShrink: 0, marginTop: "2px" }} />}
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--cei-text-main, #e2e8f0)", lineHeight: 1.5 }}>
          {etsNarrative}
        </p>
      </div>

      {/* ── Footer ── */}
      <div style={{
        padding: "0.5rem 1.25rem 0.75rem",
        borderTop: "1px solid rgba(148,163,184,0.08)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ fontSize: "0.65rem", color: "var(--cei-text-muted, #94a3b8)" }}>
          Emission factor: {data.emission_factor_kg_co2_kwh} kgCO₂/kWh · {factor_source || country_code}
        </span>
        <span style={{ fontSize: "0.65rem", color: "var(--cei-text-muted, #94a3b8)" }}>
          Updated {new Date(data.calculated_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
};

export default RegulatoryIntelligenceCard;
