// frontend/src/components/OpportunityCard.tsx
/**
 * Improved opportunity card for the "Efficiency Opportunities" section.
 *
 * Replaces the plain bullet list with:
 *  - Large € saving headline (most impactful number first)
 *  - Severity colour coding (high/medium/low based on annual savings)
 *  - Pattern type badge (night_overconsumption, spike_cluster, etc.)
 *  - CO₂ and ROI chips
 *  - Rank badge
 *  - Action note + "Mark as actioned" button preserved
 */

import React from "react";
import { useTranslation } from "react-i18next";
import {
  FiMoon, FiZap, FiSunrise, FiTrendingUp, FiCalendar, FiClock, FiAlertTriangle, FiCheckCircle,
} from "react-icons/fi";
import type { OpportunityMeasure } from "../services/api";

// ── Pattern metadata ──────────────────────────────────────────────────────────

interface PatternMeta {
  label: string;
  icon: React.ReactNode;
  color: string;
}

const PATTERN_META: Record<string, PatternMeta> = {
  night_overconsumption: { label: "Night waste",        icon: <FiMoon />,      color: "#6366f1" },
  spike_cluster:         { label: "Spike cluster",      icon: <FiZap />,       color: "#ef4444" },
  morning_ramp_creep:    { label: "Morning ramp",        icon: <FiSunrise />,   color: "#f59e0b" },
  weekend_excess:        { label: "Weekend excess",     icon: <FiCalendar />,  color: "#8b5cf6" },
  sustained_drift:       { label: "Baseline drift",     icon: <FiTrendingUp />, color: "#f97316" },
  shoulder_waste:        { label: "Shoulder hours",     icon: <FiClock />,     color: "#06b6d4" },
  generic:               { label: "General",            icon: <FiAlertTriangle />, color: "#94a3b8" },
};

function getPatternMeta(name: string): PatternMeta {
  // Try exact match first, then partial match on pattern_id embedded in name
  if (PATTERN_META[name]) return PATTERN_META[name];
  for (const key of Object.keys(PATTERN_META)) {
    if (name?.toLowerCase().includes(key.replace(/_/g, " ").split(" ")[0])) {
      return PATTERN_META[key];
    }
  }
  return PATTERN_META.generic;
}

// ── Severity from annual savings ──────────────────────────────────────────────

function getSeverity(eurPerYear: number | null): "high" | "medium" | "low" {
  if (eurPerYear == null) return "low";
  if (eurPerYear >= 3000) return "high";
  if (eurPerYear >= 800)  return "medium";
  return "low";
}

const SEVERITY_STYLES = {
  high:   { border: "rgba(239,68,68,0.4)",   bg: "rgba(239,68,68,0.05)",   badge: "#ef4444",  label: "High impact" },
  medium: { border: "rgba(245,158,11,0.4)",  bg: "rgba(245,158,11,0.05)",  badge: "#f59e0b",  label: "Medium impact" },
  low:    { border: "rgba(148,163,184,0.25)", bg: "rgba(148,163,184,0.03)", badge: "#94a3b8",  label: "Low impact" },
};

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({ icon, label, color = "#94a3b8" }: { icon?: React.ReactNode; label: string; color?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      fontSize: "0.68rem", fontWeight: 500,
      padding: "2px 8px", borderRadius: "999px",
      background: `${color}18`, color, border: `1px solid ${color}30`,
    }}>
      {icon}{label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  opp: OpportunityMeasure;
  rank: number;
  eurPerYear: number | null;
  kpiCurrencyCode: string | null | undefined;
  actionNote: string;
  actionSaving: boolean;
  onActionNoteChange: (val: string) => void;
  onMarkActioned: () => void;
  formatCurrency: (v: number | null | undefined, code: string | null | undefined) => string;
}

const OpportunityCard: React.FC<Props> = ({
  opp,
  rank,
  eurPerYear,
  kpiCurrencyCode,
  actionNote,
  actionSaving,
  onActionNoteChange,
  onMarkActioned,
  formatCurrency,
}) => {
  const { t } = useTranslation();
  const o = opp as any;

  const isManual = o?.source === "manual";
  const patternId = o?.pattern_id ?? (isManual ? "manual" : "generic");
  const patternMeta = getPatternMeta(patternId);
  const severity = getSeverity(eurPerYear);
  const styles = SEVERITY_STYLES[severity];

  const roiYears     = typeof o?.simple_roi_years === "number" && Number.isFinite(o.simple_roi_years) ? o.simple_roi_years : null;
  const co2          = typeof o?.est_co2_tons_saved_per_year === "number" && Number.isFinite(o.est_co2_tons_saved_per_year) ? o.est_co2_tons_saved_per_year : null;
  const kwhYr        = typeof o?.est_annual_kwh_saved === "number" && Number.isFinite(o.est_annual_kwh_saved) ? o.est_annual_kwh_saved : null;
  const capex        = typeof o?.est_capex_eur === "number" && Number.isFinite(o.est_capex_eur) ? o.est_capex_eur : null;
  const affectedHrs  = o?.affected_hours_label ?? o?.affected_time_window ?? null;

  return (
    <div style={{
      border: `1px solid ${styles.border}`,
      borderRadius: "0.65rem",
      background: styles.bg,
      padding: "1rem 1.1rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.6rem",
    }}>
      {/* ── Header row ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Pattern badge + rank */}
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
            <Chip
              icon={patternMeta.icon}
              label={isManual ? "Manual" : patternMeta.label}
              color={patternMeta.color}
            />
            <Chip
              label={styles.label}
              color={styles.badge}
            />
            {severity === "high" && (
              <Chip icon={<FiAlertTriangle />} label="Act now" color="#ef4444" />
            )}
          </div>

          {/* Opportunity name */}
          <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--cei-text-main, #e2e8f0)", lineHeight: 1.3 }}>
            {o?.name ?? t("siteView.manualOpp.defaultName", { defaultValue: "Opportunity" })}
          </div>

          {/* Description */}
          {o?.description && (
            <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted, #94a3b8)", marginTop: "0.25rem", lineHeight: 1.5 }}>
              {o.description}
            </div>
          )}
        </div>

        {/* ── € saving headline ── */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {eurPerYear != null ? (
            <>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, color: "#22c55e", lineHeight: 1 }}>
                {formatCurrency(eurPerYear, kpiCurrencyCode)}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--cei-text-muted, #94a3b8)", marginTop: "2px" }}>
                per year
              </div>
            </>
          ) : kwhYr != null ? (
            <>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#22c55e", lineHeight: 1 }}>
                {kwhYr.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--cei-text-muted, #94a3b8)", marginTop: "2px" }}>
                saved / year
              </div>
            </>
          ) : (
            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted, #94a3b8)" }}>
              #{rank}
            </span>
          )}
        </div>
      </div>

      {/* ── Metric chips ── */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {co2 != null && (
          <Chip label={`${co2.toFixed(2)} tCO₂/yr`} color="#22c55e" />
        )}
        {roiYears != null && (
          <Chip label={`ROI ${roiYears.toFixed(1)} yrs`} color="#60a5fa" />
        )}
        {capex != null && (
          <Chip label={`Capex ~${formatCurrency(capex, kpiCurrencyCode)}`} color="#94a3b8" />
        )}
        {affectedHrs && (
          <Chip icon={<FiClock />} label={affectedHrs} color="#94a3b8" />
        )}
      </div>

      {/* ── Action row ── */}
      <div style={{
        display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap",
        paddingTop: "0.5rem",
        borderTop: "1px solid rgba(148,163,184,0.1)",
      }}>
        <input
          type="text"
          value={actionNote}
          onChange={(e) => onActionNoteChange(e.target.value)}
          placeholder={t("siteView.opps.actionNotePlaceholder", { defaultValue: "Optional note (who/when/what changed)…" })}
          style={{
            flex: "1 1 220px",
            minWidth: 160,
            padding: "0.35rem 0.6rem",
            borderRadius: "0.45rem",
            border: "1px solid rgba(148,163,184,0.3)",
            backgroundColor: "rgba(15,23,42,0.7)",
            color: "var(--cei-text-main)",
            fontSize: "0.78rem",
            fontFamily: "inherit",
          }}
        />
        <button
          type="button"
          onClick={onMarkActioned}
          disabled={actionSaving}
          style={{
            display: "flex", alignItems: "center", gap: "5px",
            fontSize: "0.75rem", fontWeight: 600,
            padding: "0.35rem 0.85rem", borderRadius: "0.45rem",
            background: actionSaving ? "rgba(34,197,94,0.4)" : "var(--cei-green, #22c55e)",
            color: "#0f172a", border: "none",
            cursor: actionSaving ? "not-allowed" : "pointer",
            transition: "opacity 0.15s",
            opacity: actionSaving ? 0.7 : 1,
          }}
        >
          <FiCheckCircle />
          {actionSaving
            ? t("common.savingEllipsis", { defaultValue: "Saving…" })
            : t("siteView.opps.markActioned", { defaultValue: "Mark as actioned" })}
        </button>
      </div>
    </div>
  );
};

export default OpportunityCard;
