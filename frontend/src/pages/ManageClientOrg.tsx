// frontend/src/pages/ManageClientOrg.tsx
import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import {
  getClientOrg, listClientOrgSites, createClientOrgSite, deleteClientOrgSite,
  listClientOrgTokens, createClientOrgToken, revokeClientOrgToken,
  listClientOrgUsers, inviteClientOrgUser, getClientOrgThresholds,
  updateClientOrgThresholds, updateClientOrgPricing, downloadClientReport,
  getClientOrgReport,
  getClientOrgTimeseriesSummary,
  type ClientOrg, type Site, type IntegrationToken, type IntegrationTokenWithSecret,
  type ClientOrgUser, type AlertThresholds, type ClientReportOut, type TimeseriesSummary,
} from "../services/manageApi";
import ComplianceReports from "../components/ComplianceReports";

function fmtDt(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toUiMsg(err: unknown, fallback: string): string {
  const e = err as any;
  return e?.response?.data?.message ?? e?.response?.data?.detail ?? e?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// Dark modal
// ---------------------------------------------------------------------------
function DarkModal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "rgba(15, 23, 42, 0.99)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.75rem", padding: "1.5rem", minWidth: "360px", maxWidth: "480px", width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, fontSize: "1rem" }}>{title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--cei-text-muted)", cursor: "pointer", fontSize: "1.2rem", padding: "0 0.25rem" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.4rem", border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.07)", color: "var(--cei-text-main)", fontSize: "0.875rem", boxSizing: "border-box", outline: "none" };
const btnPrimary: React.CSSProperties = { padding: "0.45rem 1.1rem", borderRadius: "999px", border: "none", background: "var(--cei-green, #22c55e)", color: "#0f172a", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" };
const btnSecondary: React.CSSProperties = { padding: "0.45rem 1.1rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: "transparent", color: "var(--cei-text-muted)", fontSize: "0.82rem", cursor: "pointer" };
const btnDanger: React.CSSProperties = { padding: "0.3rem 0.8rem", borderRadius: "999px", border: "1px solid rgba(239,68,68,0.4)", background: "transparent", color: "var(--cei-red, #ef4444)", fontSize: "0.78rem", cursor: "pointer" };

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------
const TAB_KEYS = ["overview", "sites", "tokens", "users", "thresholds", "energy", "alerts", "reports"] as const;
type TabKey = typeof TAB_KEYS[number];

function TabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--cei-border-subtle)", marginBottom: "1.25rem", overflowX: "auto" }}>
      {TAB_KEYS.map((key) => (
        <button key={key} onClick={() => onChange(key)} style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", background: "transparent", border: "none", borderBottom: active === key ? "2px solid var(--cei-green, #22c55e)" : "2px solid transparent", color: active === key ? "var(--cei-text-main)" : "var(--cei-text-muted)", cursor: "pointer", fontWeight: active === key ? 600 : 400, marginBottom: "-1px", whiteSpace: "nowrap" }}>
          {t(`manage.client.tabs.${key}`, { defaultValue: key.charAt(0).toUpperCase() + key.slice(1) })}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI chip helper
// ---------------------------------------------------------------------------
function KpiChip({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ background: "rgba(148,163,184,0.06)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.6rem", padding: "0.85rem 1rem", minWidth: "140px" }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginTop: "0.2rem" }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Energy tab
// ---------------------------------------------------------------------------
function EnergyTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [report, setReport] = useState<ClientReportOut | null>(null);
  const [summary24h, setSummary24h] = useState<TimeseriesSummary | null>(null);
  const [summary7d, setSummary7d] = useState<TimeseriesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getClientOrgReport(orgId),
      getClientOrgTimeseriesSummary(orgId, 24),
      getClientOrgTimeseriesSummary(orgId, 168),
    ])
      .then(([rep, s24, s7]) => {
        setReport(rep);
        setSummary24h(s24);
        setSummary7d(s7);
      })
      .catch((e: unknown) => setError(toUiMsg(e, "Failed to load energy data.")))
      .finally(() => setLoading(false));
  }, [orgId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onClose={() => setError(null)} />;
  if (!report) return null;

  const tariff  = report.electricity_price_per_kwh != null ? Number(report.electricity_price_per_kwh) : null;
  const kwh24h  = summary24h?.total_value ?? null;
  const kwh7d   = summary7d?.total_value  ?? null;
  const cost24h = tariff != null && kwh24h != null ? (kwh24h * tariff).toFixed(2) : null;
  const cost7d  = tariff != null && kwh7d  != null ? (kwh7d  * tariff).toFixed(2) : null;

  const activeSites   = report.active_site_ids.length;
  const totalSites    = report.total_sites;
  const coveragePct   = totalSites > 0 ? Math.round((activeSites / totalSites) * 100) : 0;
  const hasHistory    = report.total_timeseries_records >= 720;
  const hasTariff     = tariff != null;
  const lastIngestAge = report.last_ingestion_at
    ? Math.round((Date.now() - new Date(report.last_ingestion_at).getTime()) / 3600000)
    : null;
  const isLive = lastIngestAge != null && lastIngestAge < 25;

  const iso50001Score = [isLive, hasTariff, activeSites === totalSites && totalSites > 0, hasHistory].filter(Boolean).length;
  const iso50001Color = iso50001Score === 4 ? "#22c55e" : iso50001Score >= 2 ? "#f59e0b" : "#ef4444";
  const iso50001Label = iso50001Score === 4 ? t("manage.energy.ready") : iso50001Score >= 2 ? t("manage.energy.partial") : t("manage.energy.notReady");

  const check = (ok: boolean, label: string, fix: string) => (
    <div key={label} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.5rem 0", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
      <span style={{ color: ok ? "#22c55e" : "#ef4444", fontSize: "1rem", marginTop: "0.05rem", flexShrink: 0 }}>{ok ? "✓" : "✗"}</span>
      <div>
        <div style={{ fontSize: "0.85rem", color: "var(--cei-text-main)", fontWeight: ok ? 400 : 500 }}>{label}</div>
        {!ok && <div style={{ fontSize: "0.78rem", color: "#f59e0b", marginTop: "0.15rem" }}>{fix}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* ISO 50001 readiness banner */}
      <div style={{ padding: "1rem 1.25rem", borderRadius: "0.75rem", border: `1px solid ${iso50001Color}33`, background: `${iso50001Color}0d`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", color: iso50001Color }}>ISO 50001 Readiness — {iso50001Label}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", marginTop: "0.2rem" }}>
            {t("manage.energy.isoSubtitle", { defaultValue: "{{score}}/4 requirements met for a verifiable EnPI report", score: iso50001Score })}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ width: "28px", height: "6px", borderRadius: "3px", background: i < iso50001Score ? iso50001Color : "rgba(148,163,184,0.2)" }} />
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
        <KpiChip label={t("manage.energy.siteCoverage", { defaultValue: "Site coverage" })} value={<span style={{ color: coveragePct === 100 ? "#22c55e" : "#f59e0b" }}>{coveragePct}%</span>} sub={`${activeSites}/${totalSites} ${t("manage.energy.active", { defaultValue: "active" })}`} />
        <KpiChip label={t("manage.energy.energy24h", { defaultValue: "Energy (24h)" })} value={kwh24h != null ? `${Math.round(kwh24h).toLocaleString()} kWh` : "—"} sub={summary24h?.points ? `${summary24h.points} ${t("manage.energy.readings", { defaultValue: "readings" })}` : t("manage.energy.noData", { defaultValue: "No data" })} />
        <KpiChip label={t("manage.energy.energy7d", { defaultValue: "Energy (7d)" })} value={kwh7d != null ? `${Math.round(kwh7d).toLocaleString()} kWh` : "—"} sub={summary7d?.points ? `${summary7d.points} ${t("manage.energy.readings", { defaultValue: "readings" })}` : t("manage.energy.noData", { defaultValue: "No data" })} />
        {cost24h && <KpiChip label={t("manage.energy.costEst24h", { defaultValue: "Est. cost (24h)" })} value={<span style={{ color: "#22c55e" }}>€{cost24h}</span>} sub={`@ €${tariff}/kWh`} />}
        {cost7d  && <KpiChip label={t("manage.energy.costEst7d",  { defaultValue: "Est. cost (7d)" })}  value={<span style={{ color: "#22c55e" }}>€{cost7d}</span>}  sub={t("manage.energy.basedOnTariff", { defaultValue: "Based on tariff" })} />}
        <KpiChip label={t("manage.energy.lastData", { defaultValue: "Last data" })} value={lastIngestAge != null ? `${lastIngestAge}h ${t("manage.energy.ago", { defaultValue: "ago" })}` : "—"} sub={isLive ? `✓ ${t("manage.energy.live", { defaultValue: "Live" })}` : `⚠ ${t("manage.energy.delayed", { defaultValue: "Delayed" })}`} />
      </div>

      {/* Per-site status */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("manage.energy.siteStatus", { defaultValue: "Site status" })}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {report.sites.length === 0 ? (
            <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)" }}>{t("manage.energy.noSites", { defaultValue: "No sites configured." })}</div>
          ) : report.sites.map((site) => {
            const siteKey = site.site_id ?? `site-${site.id}`;
            const active  = report.active_site_ids.includes(siteKey);
            return (
              <div key={site.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.85rem", borderRadius: "0.5rem", border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.04)" }}>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <span style={{ color: active ? "#22c55e" : "#94a3b8", fontSize: "0.7rem" }}>●</span>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{site.name}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--cei-text-muted)" }}>{site.location ?? "—"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: active ? "#22c55e" : "#94a3b8" }}>{active ? t("manage.energy.recentData", { defaultValue: "Recent data" }) : t("manage.energy.noRecentData", { defaultValue: "No recent data" })}</span>
                  <button style={btnSecondary} onClick={() => navigate(`/manage/client-orgs/${orgId}/sites/${site.id}`)}>{t("manage.energy.open", { defaultValue: "Open →" })}</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ISO 50001 checklist */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("manage.energy.isoChecklist", { defaultValue: "ISO 50001 Checklist" })}</div>
        <div style={{ background: "rgba(148,163,184,0.04)", borderRadius: "0.6rem", border: "1px solid var(--cei-border-subtle)", padding: "0.25rem 1rem" }}>
          {check(isLive,    t("manage.energy.check.ingestion",  { defaultValue: "Continuous data ingestion (< 25h)" }), t("manage.energy.check.ingestionFix",  { defaultValue: "Check integration token in Tokens tab" }))}
          {check(hasTariff, t("manage.energy.check.tariff",     { defaultValue: "Electricity tariff configured" }),     t("manage.energy.check.tariffFix",     { defaultValue: "Add €/kWh cost in Overview tab" }))}
          {check(activeSites === totalSites && totalSites > 0, t("manage.energy.check.allSites", { defaultValue: "All sites transmitting data" }), t("manage.energy.check.allSitesFix", { defaultValue: "Check connection on inactive sites" }))}
          {check(hasHistory, t("manage.energy.check.history",   { defaultValue: "Data history ≥ 30 days" }),            t("manage.energy.check.historyFix",    { defaultValue: "Wait for data accumulation or run CSV backfill" }))}
        </div>
      </div>

      {/* Tariff config summary */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("manage.energy.config", { defaultValue: "Energy configuration" })}</div>
        <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)", lineHeight: 1.8, background: "rgba(148,163,184,0.04)", borderRadius: "0.6rem", border: "1px solid var(--cei-border-subtle)", padding: "0.75rem 1rem" }}>
          <div><strong style={{ color: "var(--cei-text-main)" }}>{t("manage.energy.sources", { defaultValue: "Sources:" })}</strong> {report.primary_energy_sources ?? t("manage.energy.notConfigured", { defaultValue: "Not configured" })}</div>
          <div><strong style={{ color: "var(--cei-text-main)" }}>{t("manage.energy.electricity", { defaultValue: "Electricity:" })}</strong> {report.electricity_price_per_kwh != null ? `€${report.electricity_price_per_kwh}/kWh` : t("manage.energy.notConfigured", { defaultValue: "Not configured" })}</div>
          <div><strong style={{ color: "var(--cei-text-main)" }}>{t("manage.energy.gas", { defaultValue: "Gas:" })}</strong> {report.gas_price_per_kwh != null ? `€${report.gas_price_per_kwh}/kWh` : t("manage.energy.notConfigured", { defaultValue: "Not configured" })}</div>
          <div><strong style={{ color: "var(--cei-text-main)" }}>{t("manage.energy.currency", { defaultValue: "Currency:" })}</strong> {report.currency_code ?? "—"}</div>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts tab
// ---------------------------------------------------------------------------
function AlertsTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<ClientReportOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getClientOrgReport(orgId)
      .then(setReport)
      .catch((e: unknown) => setError(toUiMsg(e, "Failed to load alert data.")))
      .finally(() => setLoading(false));
  }, [orgId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onClose={() => setError(null)} />;
  if (!report) return null;

  // Filter to plant-level events only — exclude org link/unlink/user events
  const plantEvents = report.recent_audit_events.filter((ev) => {
    const tp = (ev.type ?? "").toLowerCase();
    return !tp.includes("link") && !tp.includes("unlink") && !tp.includes("user") && !tp.includes("org_");
  });

  const overallStatus = report.critical_alerts > 0 ? "critical" : report.open_alerts > 0 ? "warning" : "ok";
  const statusColor   = overallStatus === "critical" ? "#ef4444" : overallStatus === "warning" ? "#f59e0b" : "#22c55e";
  const statusLabel   = overallStatus === "critical" ? `⚠ ${t("manage.alerts.critical", { defaultValue: "Critical issues detected" })}` : overallStatus === "warning" ? `⚡ ${t("manage.alerts.warning", { defaultValue: "Anomalies in progress" })}` : `✓ ${t("manage.alerts.ok", { defaultValue: "All sites normal" })}`;

  const siteHealth = (site: { id: number; name: string; site_id: string | null }) => {
    const active = report.active_site_ids.includes(site.site_id ?? `site-${site.id}`);
    if (!active) return { color: "#94a3b8", label: t("manage.alerts.noData", { defaultValue: "No data" }), icon: "○" };
    if (report.critical_alerts > 0) return { color: "#ef4444", label: t("manage.alerts.check", { defaultValue: "Check required" }), icon: "●" };
    if (report.open_alerts > 0)     return { color: "#f59e0b", label: t("manage.alerts.anomaly", { defaultValue: "Anomaly" }),       icon: "●" };
    return { color: "#22c55e", label: t("manage.alerts.normal", { defaultValue: "Normal" }), icon: "●" };
  };

  const lastIngestAge = report.last_ingestion_at
    ? Math.round((Date.now() - new Date(report.last_ingestion_at).getTime()) / 3600000)
    : null;
  const dataGap = lastIngestAge != null && lastIngestAge > 48;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Overall status banner */}
      <div style={{ padding: "1rem 1.25rem", borderRadius: "0.75rem", border: `1px solid ${statusColor}33`, background: `${statusColor}0d` }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: statusColor, marginBottom: "0.25rem" }}>{statusLabel}</div>
        <div style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>
          {t("manage.alerts.summary", { defaultValue: "{{n}} alerts in the last 7 days · {{open}} open · {{critical}} critical", n: report.alerts_last_7d, open: report.open_alerts, critical: report.critical_alerts })}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.75rem" }}>
        <KpiChip label={t("manage.alerts.openAlerts",  { defaultValue: "Open alerts" })}  value={<span style={{ color: report.open_alerts     > 0 ? "#f59e0b" : "#22c55e" }}>{report.open_alerts}</span>} />
        <KpiChip label={t("manage.alerts.criticalKpi", { defaultValue: "Critical" })}     value={<span style={{ color: report.critical_alerts  > 0 ? "#ef4444" : "#22c55e" }}>{report.critical_alerts}</span>} />
        <KpiChip label={t("manage.alerts.alerts7d",    { defaultValue: "Alerts (7d)" })}  value={report.alerts_last_7d} sub={t("manage.alerts.allLevels", { defaultValue: "All levels" })} />
        <KpiChip label={t("manage.alerts.activeSites", { defaultValue: "Active sites" })} value={`${report.active_site_ids.length}/${report.total_sites}`} sub={t("manage.alerts.withRecentData", { defaultValue: "With recent data" })} />
      </div>

      {/* Per-site health grid */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("manage.alerts.siteStatus", { defaultValue: "Site status" })}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {report.sites.length === 0 ? (
            <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)" }}>{t("manage.reports.noSites", { defaultValue: "No sites configured." })}</div>
          ) : report.sites.map((site) => {
            const health = siteHealth(site);
            return (
              <div key={site.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.65rem 0.85rem", borderRadius: "0.5rem", border: `1px solid ${health.color}33`, background: `${health.color}08` }}>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <span style={{ color: health.color, fontSize: "0.8rem" }}>{health.icon}</span>
                  <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{site.name}</span>
                </div>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: health.color }}>{health.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Compliance flags */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("manage.alerts.complianceFlags", { defaultValue: "Compliance flags" })}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ padding: "0.65rem 0.85rem", borderRadius: "0.5rem", border: `1px solid ${dataGap ? "#ef4444" : "#22c55e"}33`, background: `${dataGap ? "#ef4444" : "#22c55e"}08`, fontSize: "0.84rem" }}>
            <span style={{ fontWeight: 600, color: dataGap ? "#ef4444" : "#22c55e" }}>{dataGap ? `⚠ ${t("manage.alerts.dataGap", { defaultValue: "Data gap detected" })}` : `✓ ${t("manage.alerts.dataContinuity", { defaultValue: "Data continuity" })}`}</span>
            <span style={{ color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>
              {dataGap ? t("manage.alerts.dataGapDesc", { defaultValue: "No data for {{h}}h — potential CBAM audit gap", h: lastIngestAge }) : t("manage.alerts.dataContinuityDesc", { defaultValue: "Continuous data flow — suitable for CBAM/ETS MRV" })}
            </span>
          </div>
          <div style={{ padding: "0.65rem 0.85rem", borderRadius: "0.5rem", border: `1px solid ${report.critical_alerts > 0 ? "#ef4444" : "#22c55e"}33`, background: `${report.critical_alerts > 0 ? "#ef4444" : "#22c55e"}08`, fontSize: "0.84rem" }}>
            <span style={{ fontWeight: 600, color: report.critical_alerts > 0 ? "#ef4444" : "#22c55e" }}>
              {report.critical_alerts > 0 ? `⚠ ${report.critical_alerts} ${t("manage.alerts.criticalAnomaly", { defaultValue: "critical anomaly" })}` : `✓ ${t("manage.alerts.noCritical", { defaultValue: "No critical anomalies" })}`}
            </span>
            <span style={{ color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>
              {report.critical_alerts > 0 ? t("manage.alerts.reviewBeforeETS", { defaultValue: "Review recommended before next ETS audit" }) : t("manage.alerts.normalForETS", { defaultValue: "Consumption profile normal for ETS Phase 4" })}
            </span>
          </div>
          <div style={{ padding: "0.65rem 0.85rem", borderRadius: "0.5rem", border: "1px solid rgba(148,163,184,0.16)", background: "rgba(148,163,184,0.04)", fontSize: "0.84rem" }}>
            <span style={{ fontWeight: 600, color: "#f59e0b" }}>ℹ ETS Phase 4</span>
            <span style={{ color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>
              {t("manage.alerts.etsNote", { defaultValue: "Free allowances reduced 4.4%/year — check baseline and efficiency opportunities in Energy tab" })}
            </span>
          </div>
        </div>
      </div>

      {/* Plant-level events only */}
      {plantEvents.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("manage.alerts.recentActivity", { defaultValue: "Recent plant activity" })}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {plantEvents.slice(0, 8).map((ev) => (
              <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.75rem", borderRadius: "0.4rem", background: "rgba(148,163,184,0.04)", border: "1px solid var(--cei-border-subtle)", fontSize: "0.82rem" }}>
                <span style={{ color: "var(--cei-text-main)" }}>{ev.title}</span>
                <span style={{ color: "var(--cei-text-muted)", fontSize: "0.76rem", flexShrink: 0, marginLeft: "1rem" }}>{fmtDt(ev.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
        {t("manage.alerts.thresholdsNote", { defaultValue: "Alert thresholds can be customized in the" })} <strong>Thresholds</strong> {t("manage.alerts.tab", { defaultValue: "tab" })}.
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports tab
// ---------------------------------------------------------------------------
function ReportsTab({ orgId, orgName }: { orgId: number; orgName: string }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<ClientReportOut | null>(null);
  const [summary7d, setSummary7d] = useState<TimeseriesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getClientOrgReport(orgId),
      getClientOrgTimeseriesSummary(orgId, 168),
    ])
      .then(([rep, s7]) => { setReport(rep); setSummary7d(s7); })
      .catch((e: unknown) => setError(toUiMsg(e, "Failed to load report data.")))
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleDownload = async () => {
    setDownloading(true);
    try { await downloadClientReport(orgId); }
    catch (e: unknown) { setError(toUiMsg(e, "Failed to download PDF report.")); }
    finally { setDownloading(false); }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onClose={() => setError(null)} />;
  if (!report) return null;

  const tariff = report.electricity_price_per_kwh != null ? Number(report.electricity_price_per_kwh) : null;
  const kwh7d  = summary7d?.total_value ?? null;
  const cost7d = tariff != null && kwh7d != null ? (kwh7d * tariff).toFixed(2) : null;

  const lastIngestAge  = report.last_ingestion_at
    ? Math.round((Date.now() - new Date(report.last_ingestion_at).getTime()) / 3600000)
    : null;
  const isLive         = lastIngestAge != null && lastIngestAge < 25;
  const hasHistory     = report.total_timeseries_records >= 720;
  const hasTariff      = tariff != null;
  const allSitesActive = report.active_site_ids.length === report.total_sites && report.total_sites > 0;

  const isoChecks = [
    { ok: isLive,                   label: t("manage.reports.check.ingestion",  { defaultValue: "Continuous ingestion (< 25h)" }),          detail: t("manage.reports.check.ingestionDetail",  { defaultValue: "Required for verifiable EnPI" }) },
    { ok: hasTariff,                label: t("manage.reports.check.tariff",     { defaultValue: "€/kWh tariff configured" }),                detail: t("manage.reports.check.tariffDetail",     { defaultValue: "Required for ISO 50001 cost calculation" }) },
    { ok: allSitesActive,           label: t("manage.reports.check.allSites",   { defaultValue: "All sites transmitting data" }),            detail: t("manage.reports.check.allSitesDetail",   { defaultValue: "Complete portfolio coverage" }) },
    { ok: hasHistory,               label: t("manage.reports.check.history",    { defaultValue: "History ≥ 30 days" }),                      detail: t("manage.reports.check.historyDetail",    { defaultValue: "Reliable statistical baseline" }) },
    { ok: report.open_alerts === 0, label: t("manage.reports.check.noAlerts",   { defaultValue: "No open alerts" }),                         detail: t("manage.reports.check.noAlertsDetail",   { defaultValue: "Consumption profile normal" }) },
  ];
  const isoScore  = isoChecks.filter(c => c.ok).length;
  const isoColor  = isoScore === 5 ? "#22c55e" : isoScore >= 3 ? "#f59e0b" : "#ef4444";
  const isoStatus = isoScore === 5 ? t("manage.reports.compliant", { defaultValue: "Compliant" }) : isoScore >= 3 ? t("manage.reports.inProgress", { defaultValue: "In progress" }) : t("manage.reports.nonCompliant", { defaultValue: "Non compliant" });

  const cbamChecks = [
    { ok: isLive,     label: t("manage.reports.cbam.mrv",     { defaultValue: "MRV data updated (< 25h)" }),        detail: t("manage.reports.cbam.mrvDetail",     { defaultValue: "CBAM requires verified data on demand" }) },
    { ok: hasHistory, label: t("manage.reports.cbam.history", { defaultValue: "Emissions history ≥ 30 days" }),     detail: t("manage.reports.cbam.historyDetail", { defaultValue: "Required for customs declaration" }) },
    { ok: hasTariff,  label: t("manage.reports.cbam.source",  { defaultValue: "Energy source configured" }),        detail: t("manage.reports.cbam.sourceDetail",  { defaultValue: "Emissions source identification" }) },
  ];
  const cbamScore  = cbamChecks.filter(c => c.ok).length;
  const cbamColor  = cbamScore === 3 ? "#22c55e" : cbamScore >= 2 ? "#f59e0b" : "#ef4444";
  const cbamStatus = cbamScore === 3 ? t("manage.reports.ready", { defaultValue: "Ready" }) : cbamScore >= 2 ? t("manage.reports.partial", { defaultValue: "Partial" }) : t("manage.reports.notReady", { defaultValue: "Not ready" });

  const checkRow = (ok: boolean, label: string, detail: string) => (
    <div key={label} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", padding: "0.5rem 0", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
      <span style={{ color: ok ? "#22c55e" : "#ef4444", fontSize: "1rem", flexShrink: 0, marginTop: "0.05rem" }}>{ok ? "✓" : "✗"}</span>
      <div>
        <div style={{ fontSize: "0.85rem", color: "var(--cei-text-main)", fontWeight: ok ? 400 : 500 }}>{label}</div>
        <div style={{ fontSize: "0.76rem", color: "var(--cei-text-muted)", marginTop: "0.1rem" }}>{detail}</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* PDF download header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>{t("manage.reports.title", { defaultValue: "Portfolio report" })} — {orgName}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginTop: "0.2rem" }}>
            {t("manage.reports.generated", { defaultValue: "Generated:" })} {fmtDt(report.generated_at)} · {report.total_sites} {t("manage.reports.sites", { defaultValue: "sites" })} · {report.total_timeseries_records.toLocaleString()} {t("manage.reports.totalReadings", { defaultValue: "total readings" })}
            {kwh7d != null && ` · ${Math.round(kwh7d).toLocaleString()} kWh (7d)`}
            {cost7d != null && ` · €${cost7d} ${t("manage.reports.costEst", { defaultValue: "est. cost" })}`}
          </div>
        </div>
        <button style={btnPrimary} onClick={handleDownload} disabled={downloading}>
          {downloading ? `${t("manage.reports.downloading", { defaultValue: "Downloading" })}…` : `↓ ${t("manage.reports.downloadBrief", { defaultValue: "Download Client Brief" })}`}
        </button>
      </div>

      {/* ISO 50001 compliance */}
      <div style={{ borderRadius: "0.75rem", border: `1px solid ${isoColor}33`, overflow: "hidden" }}>
        <div style={{ padding: "0.75rem 1rem", background: `${isoColor}0d`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, color: isoColor }}>ISO 50001 — {isoStatus}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>{isoScore}/5 {t("manage.reports.requirements", { defaultValue: "requirements" })}</div>
        </div>
        <div style={{ padding: "0 1rem 0.25rem" }}>
          {isoChecks.map(c => checkRow(c.ok, c.label, c.detail))}
        </div>
      </div>

      {/* CBAM readiness */}
      <div style={{ borderRadius: "0.75rem", border: `1px solid ${cbamColor}33`, overflow: "hidden" }}>
        <div style={{ padding: "0.75rem 1rem", background: `${cbamColor}0d`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, color: cbamColor }}>CBAM Readiness — {cbamStatus}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>{cbamScore}/3 {t("manage.reports.requirements", { defaultValue: "requirements" })} · {t("manage.reports.cbamInForce", { defaultValue: "In force from Jan 2026" })}</div>
        </div>
        <div style={{ padding: "0 1rem 0.25rem" }}>
          {cbamChecks.map(c => checkRow(c.ok, c.label, c.detail))}
        </div>
      </div>

      {/* ETS Phase 4 note */}
      <div style={{ padding: "0.85rem 1rem", borderRadius: "0.6rem", border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", fontSize: "0.84rem" }}>
        <div style={{ fontWeight: 600, color: "#f59e0b", marginBottom: "0.3rem" }}>ℹ {t("manage.reports.ets.title", { defaultValue: "ETS Phase 4 — Free allowance reduction" })}</div>
        <div style={{ color: "var(--cei-text-muted)", lineHeight: 1.6 }}>
          {t("manage.reports.ets.body1", { defaultValue: "ETS free allowances are reduced by" })} <strong style={{ color: "var(--cei-text-main)" }}>4.4% {t("manage.reports.ets.perYear", { defaultValue: "per year" })}</strong> {t("manage.reports.ets.until2030", { defaultValue: "until 2030." })}
          {" "}{t("manage.reports.ets.body2", { defaultValue: "For {{name}}, this means the cost of uncovered emissions increases each year.", name: orgName })}
          {" "}{t("manage.reports.ets.body3", { defaultValue: "CEI data helps identify and document consumption reductions to maximise available allowances." })}
        </div>
      </div>

      {/* 7-day summary table */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("manage.reports.summary7d", { defaultValue: "7-day summary per site" })}</div>
        {report.sites.length === 0 ? (
          <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)" }}>{t("manage.alerts.noSites", { defaultValue: "No sites configured." })}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr>
                {[
                  t("manage.reports.table.site",       { defaultValue: "Site" }),
                  t("manage.reports.table.location",   { defaultValue: "Location" }),
                  t("manage.reports.table.status",     { defaultValue: "Status" }),
                  t("manage.reports.table.energy7d",   { defaultValue: "Energy 7d" }),
                  t("manage.reports.table.costEst",    { defaultValue: "Est. cost" }),
                  t("manage.reports.table.compliance", { defaultValue: "Compliance" }),
                ].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", borderBottom: "1px solid var(--cei-border-subtle)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.sites.map((site, idx) => {
                const active   = report.active_site_ids.includes(site.site_id ?? `site-${site.id}`);
                const siteKwh  = kwh7d != null && active ? Math.round(kwh7d / Math.max(report.total_sites, 1)) : null;
                const siteCost = tariff != null && siteKwh != null ? `€${(siteKwh * tariff).toFixed(0)}` : "—";
                return (
                  <tr key={site.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(148,163,184,0.04)" }}>
                    <td style={{ padding: "0.5rem 0.6rem", fontWeight: 500 }}>{site.name}</td>
                    <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)" }}>{site.location ?? "—"}</td>
                    <td style={{ padding: "0.5rem 0.6rem" }}>
                      <span style={{ color: active ? "#22c55e" : "#94a3b8", fontSize: "0.8rem" }}>{active ? `● ${t("manage.reports.active", { defaultValue: "Active" })}` : `○ ${t("manage.reports.silent", { defaultValue: "Silent" })}`}</span>
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-main)", fontWeight: 500 }}>
                      {siteKwh != null ? `${siteKwh.toLocaleString()} kWh` : "—"}
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem", color: "#22c55e", fontWeight: 500 }}>{siteCost}</td>
                    <td style={{ padding: "0.5rem 0.6rem" }}>
                      <span style={{ fontSize: "0.76rem", padding: "0.15rem 0.5rem", borderRadius: "999px", background: active && isoScore >= 3 ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.1)", color: active && isoScore >= 3 ? "#22c55e" : "#94a3b8" }}>
                        {active && isoScore >= 3 ? t("manage.reports.inNorm", { defaultValue: "In norm" }) : t("manage.reports.toVerify", { defaultValue: "To verify" })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    {/* Compliance PDF Downloads */}
      <ComplianceReports
        sites={report.sites.map(s => ({ id: s.id, name: s.name, location: s.location }))}
        userOrgId={orgId}
      />

    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
function OverviewTab({ org, onSaved }: { org: ClientOrg; onSaved: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sources, setSources] = useState(org.primary_energy_sources ?? "");
  const [elecPrice, setElecPrice] = useState(org.electricity_price_per_kwh?.toString() ?? "");
  const [gasPrice, setGasPrice] = useState(org.gas_price_per_kwh?.toString() ?? "");
  const [currency, setCurrency] = useState(org.currency_code ?? "EUR");

  const handleSave = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      await updateClientOrgPricing(org.id, { primary_energy_sources: sources.trim() || undefined, electricity_price_per_kwh: elecPrice ? parseFloat(elecPrice) : null, gas_price_per_kwh: gasPrice ? parseFloat(gasPrice) : null, currency_code: currency.trim().toUpperCase() || undefined });
      setSuccess(true); onSaved(); setTimeout(() => setSuccess(false), 2500);
    } catch (e: unknown) { setError(toUiMsg(e, t("manage.client.overview.errorGeneric"))); }
    finally { setSaving(false); }
  };

  const row = (label: string, content: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
      <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>{label}</div>
      <div>{content}</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: "1rem" }}>{t("manage.client.overview.title")}</div>
      {row(t("manage.client.overview.name"), <span style={{ fontSize: "0.9rem" }}>{org.name}</span>)}
      {row(t("manage.client.overview.plan"), <span style={{ fontSize: "0.9rem" }}>{org.plan_key ?? "—"}</span>)}
      {row(t("manage.client.overview.status"), <span style={{ fontSize: "0.9rem" }}>{org.subscription_status ?? "—"}</span>)}
      {row(t("manage.client.overview.created"), <span style={{ fontSize: "0.9rem" }}>{fmtDt(org.created_at)}</span>)}
      <div style={{ borderTop: "1px solid var(--cei-border-subtle)", margin: "1.25rem 0" }} />
      <div style={{ fontWeight: 600, marginBottom: "1rem" }}>{t("manage.client.overview.pricingTitle")}</div>
      {error && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</div>}
      {success && <div style={{ color: "var(--cei-green, #22c55e)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{t("manage.client.overview.savedSuccess")}</div>}
      {row(t("manage.client.overview.energySources"), <input style={inputStyle} value={sources} onChange={(e) => setSources(e.target.value)} placeholder={t("manage.client.overview.energySourcesPlaceholder")} />)}
      {row(t("manage.client.overview.electricityPrice"), <input style={inputStyle} type="number" step="0.0001" min="0" value={elecPrice} onChange={(e) => setElecPrice(e.target.value)} placeholder={t("manage.client.overview.electricityPricePlaceholder")} />)}
      {row(t("manage.client.overview.gasPrice"), <input style={inputStyle} type="number" step="0.0001" min="0" value={gasPrice} onChange={(e) => setGasPrice(e.target.value)} placeholder={t("manage.client.overview.gasPricePlaceholder")} />)}
      {row(t("manage.client.overview.currency"), <input style={{ ...inputStyle, maxWidth: "100px" }} value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="EUR" />)}
      <div style={{ marginTop: "1rem" }}>
        <button style={btnPrimary} onClick={handleSave} disabled={saving}>
          {saving ? t("manage.client.overview.savingPricing") : t("manage.client.overview.savePricing")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sites tab
// ---------------------------------------------------------------------------
function SitesTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Site | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSites(await listClientOrgSites(orgId)); }
    catch (e: unknown) { setError(toUiMsg(e, t("manage.client.sites.errorLoad"))); }
    finally { setLoading(false); }
  }, [orgId, t]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true); setAddError(null);
    try { await createClientOrgSite(orgId, { name: newName.trim(), location: newLocation.trim() || undefined }); setNewName(""); setNewLocation(""); setShowAdd(false); load(); }
    catch (e: unknown) { setAddError(toUiMsg(e, t("manage.client.sites.errorCreate"))); }
    finally { setAdding(false); }
  };

  const handleDelete = async (site: Site) => {
    setDeletingId(site.id);
    try { await deleteClientOrgSite(orgId, site.id); setConfirmDelete(null); load(); }
    catch (e: unknown) { setError(toUiMsg(e, t("manage.client.sites.errorDelete"))); }
    finally { setDeletingId(null); }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 600 }}>{t("manage.client.sites.title", { count: sites.length })}</div>
        <button style={btnPrimary} onClick={() => setShowAdd(true)}>{t("manage.client.sites.addBtn")}</button>
      </div>
      {sites.length === 0 ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>{t("manage.client.sites.noSites")}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr>
              {[t("manage.client.sites.table.name"), t("manage.client.sites.table.location"), t("manage.client.sites.table.siteId"), t("manage.client.sites.table.created"), t("manage.client.sites.table.actions")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", borderBottom: "1px solid var(--cei-border-subtle)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((site, idx) => (
              <tr key={site.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(148,163,184,0.04)" }}>
                <td style={{ padding: "0.5rem 0.6rem", fontWeight: 500 }}>
                  <button
                    style={{ background: "none", border: "none", color: "var(--cei-text-main)", cursor: "pointer", fontWeight: 500, padding: 0, textDecoration: "underline" }}
                    onClick={() => navigate(`/manage/client-orgs/${orgId}/sites/${site.id}`)}
                  >
                    {site.name}
                  </button>
                </td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)" }}>{site.location ?? "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}><code style={{ fontSize: "0.78rem", background: "rgba(148,163,184,0.1)", padding: "0.1rem 0.4rem", borderRadius: "0.25rem" }}>{site.site_id ?? `site-${site.id}`}</code></td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(site.created_at)}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <button style={btnSecondary} onClick={() => navigate(`/manage/client-orgs/${orgId}/sites/${site.id}`)}>View</button>
                    <button style={btnDanger} onClick={() => setConfirmDelete(site)} disabled={deletingId === site.id}>
                      {deletingId === site.id ? t("manage.client.sites.deletingBtn") : t("manage.client.sites.deleteBtn")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DarkModal open={showAdd} title={t("manage.client.sites.addTitle")} onClose={() => { setShowAdd(false); setAddError(null); setNewName(""); setNewLocation(""); }}>
        {addError && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{addError}</div>}
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>{t("manage.client.sites.nameLabel")}</label>
          <input style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("manage.client.sites.namePlaceholder")} autoFocus />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>{t("manage.client.sites.locationLabel")}</label>
          <input style={inputStyle} value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder={t("manage.client.sites.locationPlaceholder")} />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setShowAdd(false)}>{t("manage.client.sites.cancelBtn")}</button>
          <button style={btnPrimary} onClick={handleAdd} disabled={adding || !newName.trim()}>
            {adding ? t("manage.client.sites.creatingBtn") : t("manage.client.sites.createBtn")}
          </button>
        </div>
      </DarkModal>

      <DarkModal open={!!confirmDelete} title={t("manage.client.sites.deleteTitle")} onClose={() => setConfirmDelete(null)}>
        <p style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)", marginBottom: "1rem" }}>
          {t("manage.client.sites.deleteConfirm", { name: confirmDelete?.name })}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setConfirmDelete(null)}>{t("manage.client.sites.cancelBtn")}</button>
          <button style={{ ...btnDanger, padding: "0.45rem 1.1rem" }} onClick={() => confirmDelete && handleDelete(confirmDelete)} disabled={deletingId !== null}>
            {deletingId !== null ? t("manage.client.sites.deletingBtn") : t("manage.client.sites.deleteBtn")}
          </button>
        </div>
      </DarkModal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tokens tab
// ---------------------------------------------------------------------------
function TokensTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("Integration token");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<IntegrationTokenWithSecret | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<IntegrationToken | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTokens(await listClientOrgTokens(orgId)); }
    catch (e: unknown) { setError(toUiMsg(e, t("manage.client.tokens.errorLoad"))); }
    finally { setLoading(false); }
  }, [orgId, t]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true); setCreateError(null);
    try { const result = await createClientOrgToken(orgId, newName.trim() || "Integration token"); setNewToken(result); setShowCreate(false); setNewName("Integration token"); load(); }
    catch (e: unknown) { setCreateError(toUiMsg(e, t("manage.client.tokens.errorCreate"))); }
    finally { setCreating(false); }
  };

  const handleRevoke = async (token: IntegrationToken) => {
    setRevokingId(token.id);
    try { await revokeClientOrgToken(orgId, token.id); setConfirmRevoke(null); load(); }
    catch (e: unknown) { setError(toUiMsg(e, t("manage.client.tokens.errorRevoke"))); }
    finally { setRevokingId(null); }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 600 }}>{t("manage.client.tokens.title", { count: tokens.filter((tok) => tok.is_active).length })}</div>
        <button style={btnPrimary} onClick={() => setShowCreate(true)}>{t("manage.client.tokens.createBtn")}</button>
      </div>

      {newToken && (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "0.5rem", padding: "0.9rem 1rem", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, color: "var(--cei-green, #22c55e)", marginBottom: "0.4rem" }}>{t("manage.client.tokens.newTokenBanner")}</div>
          <code style={{ fontSize: "0.82rem", wordBreak: "break-all", display: "block", marginBottom: "0.6rem" }}>{newToken.token}</code>
          <button style={btnSecondary} onClick={() => { navigator.clipboard.writeText(newToken.token); }}>{t("manage.client.tokens.copyBtn")}</button>
          <button style={{ ...btnSecondary, marginLeft: "0.5rem" }} onClick={() => setNewToken(null)}>{t("manage.client.tokens.dismissBtn")}</button>
        </div>
      )}

      {tokens.length === 0 ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>{t("manage.client.tokens.noTokens")}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr>
              {[t("manage.client.tokens.table.name"), t("manage.client.tokens.table.status"), t("manage.client.tokens.table.created"), t("manage.client.tokens.table.lastUsed"), t("manage.client.tokens.table.actions")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", borderBottom: "1px solid var(--cei-border-subtle)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((tok, idx) => (
              <tr key={tok.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(148,163,184,0.04)" }}>
                <td style={{ padding: "0.5rem 0.6rem", fontWeight: 500 }}>{tok.name}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>
                  <span style={{ color: tok.is_active ? "var(--cei-green, #22c55e)" : "var(--cei-text-muted)", fontSize: "0.8rem" }}>
                    {tok.is_active ? t("manage.client.tokens.statusActive") : t("manage.client.tokens.statusRevoked")}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(tok.created_at)}</td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(tok.last_used_at)}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>
                  {tok.is_active && (
                    <button style={btnDanger} onClick={() => setConfirmRevoke(tok)} disabled={revokingId === tok.id}>
                      {revokingId === tok.id ? t("manage.client.tokens.revokingAction") : t("manage.client.tokens.revokeAction")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DarkModal open={showCreate} title={t("manage.client.tokens.createTitle")} onClose={() => { setShowCreate(false); setCreateError(null); }}>
        {createError && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{createError}</div>}
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>{t("manage.client.tokens.nameLabel")}</label>
          <input style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", marginBottom: "1rem" }}>{t("manage.client.tokens.createHint")}</p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setShowCreate(false)}>{t("manage.client.tokens.cancelBtn")}</button>
          <button style={btnPrimary} onClick={handleCreate} disabled={creating}>
            {creating ? t("manage.client.tokens.creatingAction") : t("manage.client.tokens.createAction")}
          </button>
        </div>
      </DarkModal>

      <DarkModal open={!!confirmRevoke} title={t("manage.client.tokens.revokeTitle")} onClose={() => setConfirmRevoke(null)}>
        <p style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)", marginBottom: "1rem" }}>
          {t("manage.client.tokens.revokeConfirm", { name: confirmRevoke?.name })}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setConfirmRevoke(null)}>{t("manage.client.tokens.cancelBtn")}</button>
          <button style={{ ...btnDanger, padding: "0.45rem 1.1rem" }} onClick={() => confirmRevoke && handleRevoke(confirmRevoke)} disabled={revokingId !== null}>
            {revokingId !== null ? t("manage.client.tokens.revokingAction") : t("manage.client.tokens.revokeAction")}
          </button>
        </div>
      </DarkModal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------
function UsersTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ClientOrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteExpiry, setInviteExpiry] = useState(7);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ token: string; email: string; accept_url: string } | null>(null);
  const [copied, setCopied] = useState<"token" | "link" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await listClientOrgUsers(orgId)); }
    catch (e: unknown) { setError(toUiMsg(e, t("manage.client.users.errorLoad"))); }
    finally { setLoading(false); }
  }, [orgId, t]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true); setInviteError(null);
    try {
      const result = await inviteClientOrgUser(orgId, { email: inviteEmail.trim(), role: inviteRole, expires_in_days: inviteExpiry });
      setInviteResult({ token: result.token, email: result.email, accept_url: result.accept_url_hint || `${window.location.origin}/login?invite=${result.token}` });
      setShowInvite(false); setInviteEmail(""); load();
    } catch (e: unknown) { setInviteError(toUiMsg(e, t("manage.client.users.errorInvite"))); }
    finally { setInviting(false); }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 600 }}>{t("manage.client.users.title", { count: users.length })}</div>
        <button style={btnPrimary} onClick={() => setShowInvite(true)}>{t("manage.client.users.inviteBtn")}</button>
      </div>

      {inviteResult && (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "0.5rem", padding: "0.9rem 1rem", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, color: "var(--cei-green, #22c55e)", marginBottom: "0.4rem" }}>{t("manage.client.users.inviteBanner", { email: inviteResult.email })}</div>
          <code style={{ fontSize: "0.82rem", wordBreak: "break-all", display: "block", marginBottom: "0.6rem" }}>{inviteResult.token}</code>
          <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginBottom: "0.6rem" }}>{t("manage.client.users.inviteHint")}</div>
          <div style={{ fontSize: "0.78rem", marginBottom: "0.6rem" }}>
            <span style={{ color: "var(--cei-text-muted)" }}>Accept link: </span>
            <code style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>{inviteResult.accept_url}</code>
          </div>
          <button style={btnSecondary} onClick={() => { navigator.clipboard.writeText(inviteResult.token); setCopied("token"); setTimeout(() => setCopied(null), 1500); }}>
            {copied === "token" ? "Copied!" : t("manage.client.users.copyToken")}
          </button>
          <button style={{ ...btnSecondary, marginLeft: "0.5rem" }} onClick={() => { navigator.clipboard.writeText(inviteResult.accept_url); setCopied("link"); setTimeout(() => setCopied(null), 1500); }}>
            {copied === "link" ? "Copied!" : "Copy link"}
          </button>
          <button style={{ ...btnSecondary, marginLeft: "0.5rem" }} onClick={() => setInviteResult(null)}>{t("manage.client.users.dismissBtn")}</button>
        </div>
      )}

      {users.length === 0 ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>{t("manage.client.users.noUsers")}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr>
              {[t("manage.client.users.table.email"), t("manage.client.users.table.role"), t("manage.client.users.table.status"), t("manage.client.users.table.created")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", borderBottom: "1px solid var(--cei-border-subtle)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, idx) => (
              <tr key={u.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(148,163,184,0.04)" }}>
                <td style={{ padding: "0.5rem 0.6rem" }}>{u.email}</td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)" }}>{u.role ?? "member"}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>
                  <span style={{ color: u.is_active ? "var(--cei-green, #22c55e)" : "var(--cei-text-muted)", fontSize: "0.8rem" }}>
                    {u.is_active ? t("manage.client.users.statusActive") : t("manage.client.users.statusDisabled")}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DarkModal open={showInvite} title={t("manage.client.users.inviteTitle")} onClose={() => { setShowInvite(false); setInviteError(null); setInviteEmail(""); }}>
        {inviteError && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{inviteError}</div>}
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>{t("manage.client.users.emailLabel")}</label>
          <input style={inputStyle} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={t("manage.client.users.emailPlaceholder")} autoFocus />
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>{t("manage.client.users.roleLabel")}</label>
          <select style={inputStyle} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="member">{t("manage.client.users.roleMember")}</option>
            <option value="owner">{t("manage.client.users.roleOwner")}</option>
          </select>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>{t("manage.client.users.expiryLabel")}</label>
          <input style={{ ...inputStyle, maxWidth: "100px" }} type="number" min={1} max={30} value={inviteExpiry} onChange={(e) => setInviteExpiry(parseInt(e.target.value) || 7)} />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setShowInvite(false)}>{t("manage.client.users.cancelBtn")}</button>
          <button style={btnPrimary} onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? t("manage.client.users.invitingAction") : t("manage.client.users.inviteAction")}
          </button>
        </div>
      </DarkModal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thresholds tab
// ---------------------------------------------------------------------------
function ThresholdsTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation();
  const [thresholds, setThresholds] = useState<AlertThresholds | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    getClientOrgThresholds(orgId)
      .then((data) => {
        setThresholds(data);
        setFields({ night_warning_ratio: String(data.night_warning_ratio), night_critical_ratio: String(data.night_critical_ratio), spike_warning_ratio: String(data.spike_warning_ratio), portfolio_share_info_ratio: String(data.portfolio_share_info_ratio), weekend_warning_ratio: String(data.weekend_warning_ratio), weekend_critical_ratio: String(data.weekend_critical_ratio), min_points: String(data.min_points), min_total_kwh: String(data.min_total_kwh) });
      })
      .catch((e: unknown) => setError(toUiMsg(e, t("manage.client.thresholds.errorLoad"))))
      .finally(() => setLoading(false));
  }, [orgId, t]);

  const handleSave = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      await updateClientOrgThresholds(orgId, { scope: "org", night_warning_ratio: parseFloat(fields.night_warning_ratio), night_critical_ratio: parseFloat(fields.night_critical_ratio), spike_warning_ratio: parseFloat(fields.spike_warning_ratio), portfolio_share_info_ratio: parseFloat(fields.portfolio_share_info_ratio), weekend_warning_ratio: parseFloat(fields.weekend_warning_ratio), weekend_critical_ratio: parseFloat(fields.weekend_critical_ratio), min_points: parseInt(fields.min_points), min_total_kwh: parseFloat(fields.min_total_kwh) });
      setSuccess(true); setTimeout(() => setSuccess(false), 2500);
    } catch (e: unknown) { setError(toUiMsg(e, t("manage.client.thresholds.errorSave"))); }
    finally { setSaving(false); }
  };

  const THRESHOLD_FIELDS: { key: string; tKey: string }[] = [
    { key: "night_warning_ratio", tKey: "nightWarning" },
    { key: "night_critical_ratio", tKey: "nightCritical" },
    { key: "spike_warning_ratio", tKey: "spikeWarning" },
    { key: "portfolio_share_info_ratio", tKey: "portfolioShare" },
    { key: "weekend_warning_ratio", tKey: "weekendWarning" },
    { key: "weekend_critical_ratio", tKey: "weekendCritical" },
    { key: "min_points", tKey: "minPoints" },
    { key: "min_total_kwh", tKey: "minKwh" },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {success && <div style={{ color: "var(--cei-green, #22c55e)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{t("manage.client.thresholds.savedSuccess")}</div>}
      <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{t("manage.client.thresholds.title")}</div>
      <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", marginBottom: "1.25rem" }}>
        {thresholds?.has_custom_thresholds ? t("manage.client.thresholds.customActive") : t("manage.client.thresholds.usingDefaults")}
      </div>

      {THRESHOLD_FIELDS.map(({ key, tKey }) => (
        <div key={key} style={{ marginBottom: "0.75rem", display: "grid", gridTemplateColumns: "220px 120px 1fr", gap: "0.5rem", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "0.83rem" }}>{t(`manage.client.thresholds.fields.${tKey}.label`)}</div>
            <div style={{ fontSize: "0.73rem", color: "var(--cei-text-muted)" }}>{t(`manage.client.thresholds.fields.${tKey}.hint`)}</div>
          </div>
          <input style={{ ...inputStyle, maxWidth: "120px" }} type="number" step="0.01" min="0" value={fields[key] ?? ""} onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))} />
          {thresholds && <span style={{ fontSize: "0.73rem", color: "var(--cei-text-muted)" }}>{t("manage.client.thresholds.defaultLabel", { value: (thresholds as any)[key] })}</span>}
        </div>
      ))}

      <div style={{ marginTop: "1rem" }}>
        <button style={btnPrimary} onClick={handleSave} disabled={saving}>
          {saving ? t("manage.client.thresholds.savingBtn") : t("manage.client.thresholds.saveBtn")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
const ManageClientOrg: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const orgId = parseInt(id ?? "0");

  const [org, setOrg] = useState<ClientOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const hash = window.location.hash.replace("#", "");
    return (TAB_KEYS as readonly string[]).includes(hash) ? hash as TabKey : "overview";
  });
  const [downloading, setDownloading] = useState(false);

  const loadOrg = useCallback(async () => {
    try { setOrg(await getClientOrg(orgId)); }
    catch (e: unknown) { setError(toUiMsg(e, t("errors.generic"))); }
    finally { setLoading(false); }
  }, [orgId, t]);

  useEffect(() => { loadOrg(); }, [loadOrg]);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try { await downloadClientReport(orgId); }
    catch (e: unknown) { setError(toUiMsg(e, t("errors.generic"))); }
    finally { setDownloading(false); }
  };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><LoadingSpinner /></div>;
  if (error && !org) return <div style={{ padding: "2rem" }}><ErrorBanner message={error} onClose={() => navigate("/manage")} /></div>;

  return (
    <div style={{ maxWidth: "100vw", overflowX: "hidden" }}>
      <section>
        <button onClick={() => navigate("/manage")} style={{ ...btnSecondary, marginBottom: "1rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          {t("manage.client.backToPortfolio")}
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 600, letterSpacing: "-0.02em" }}>{org?.name ?? t("manage.client.title")}</h1>
            <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
              {t("manage.client.orgId", { id: orgId })} · {org?.subscription_status ?? "—"} · {org?.currency_code ?? "—"}
            </p>
          </div>
          <button style={btnSecondary} onClick={handleDownloadPdf} disabled={downloading}>
            {downloading ? t("manage.pdf.downloading") : t("manage.pdf.downloadBrief", { defaultValue: "↓ Download Client Brief" })}
          </button>
        </div>
      </section>

      {error && <section style={{ marginTop: "0.75rem" }}><ErrorBanner message={error} onClose={() => setError(null)} /></section>}

      <section style={{ marginTop: "1.5rem" }}>
        <div className="cei-card">
          <TabBar active={activeTab} onChange={setActiveTab} />
          {activeTab === "overview"    && org && <OverviewTab org={org} onSaved={loadOrg} />}
          {activeTab === "sites"       && <SitesTab orgId={orgId} />}
          {activeTab === "tokens"      && <TokensTab orgId={orgId} />}
          {activeTab === "users"       && <UsersTab orgId={orgId} />}
          {activeTab === "thresholds"  && <ThresholdsTab orgId={orgId} />}
          {activeTab === "energy"      && <EnergyTab orgId={orgId} />}
          {activeTab === "alerts"      && <AlertsTab orgId={orgId} />}
          {activeTab === "reports"     && <ReportsTab orgId={orgId} orgName={org?.name ?? ""} />}
        </div>
      </section>
    </div>
  );
};

export default ManageClientOrg;
