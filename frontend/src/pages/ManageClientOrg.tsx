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
  const iso50001Label = iso50001Score === 4 ? "Pronto" : iso50001Score >= 2 ? "Parziale" : "Non pronto";

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
            {iso50001Score}/4 requisiti soddisfatti per un report EnPI verificabile
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
        <KpiChip label="Copertura siti" value={<span style={{ color: coveragePct === 100 ? "#22c55e" : "#f59e0b" }}>{coveragePct}%</span>} sub={`${activeSites}/${totalSites} attivi`} />
        <KpiChip label="Energia (24h)" value={kwh24h != null ? `${Math.round(kwh24h).toLocaleString()} kWh` : "—"} sub={summary24h?.points ? `${summary24h.points} letture` : "Nessun dato"} />
        <KpiChip label="Energia (7gg)" value={kwh7d  != null ? `${Math.round(kwh7d).toLocaleString()} kWh`  : "—"} sub={summary7d?.points  ? `${summary7d.points} letture`  : "Nessun dato"} />
        {cost24h && <KpiChip label="Costo est. (24h)" value={<span style={{ color: "#22c55e" }}>€{cost24h}</span>} sub={`@ €${tariff}/kWh`} />}
        {cost7d  && <KpiChip label="Costo est. (7gg)" value={<span style={{ color: "#22c55e" }}>€{cost7d}</span>}  sub="Basato su tariffa" />}
        <KpiChip label="Ultimo dato" value={lastIngestAge != null ? `${lastIngestAge}h fa` : "—"} sub={isLive ? "✓ In tempo reale" : "⚠ Ritardo"} />
      </div>

      {/* Per-site status */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Stato impianti</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {report.sites.length === 0 ? (
            <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)" }}>Nessun impianto configurato.</div>
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
                  <span style={{ fontSize: "0.78rem", color: active ? "#22c55e" : "#94a3b8" }}>{active ? "Dati recenti" : "Nessun dato recente"}</span>
                  <button style={btnSecondary} onClick={() => navigate(`/manage/client-orgs/${orgId}/sites/${site.id}`)}>Apri →</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ISO 50001 checklist */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Checklist ISO 50001</div>
        <div style={{ background: "rgba(148,163,184,0.04)", borderRadius: "0.6rem", border: "1px solid var(--cei-border-subtle)", padding: "0.25rem 1rem" }}>
          {check(isLive,       "Ingestion dati continua (< 25h)", "Verificare il token di integrazione nella tab Tokens")}
          {check(hasTariff,    "Tariffa elettrica configurata",    "Aggiungere il costo €/kWh nella tab Overview")}
          {check(activeSites === totalSites && totalSites > 0, "Tutti gli impianti trasmettono dati", "Verificare la connessione sui siti inattivi")}
          {check(hasHistory,   "Storico dati ≥ 30 giorni (720 letture)", "Attendere accumulo dati o eseguire backfill CSV")}
        </div>
      </div>

      {/* Tariff config summary */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Configurazione energetica</div>
        <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)", lineHeight: 1.8, background: "rgba(148,163,184,0.04)", borderRadius: "0.6rem", border: "1px solid var(--cei-border-subtle)", padding: "0.75rem 1rem" }}>
          <div><strong style={{ color: "var(--cei-text-main)" }}>Fonti:</strong> {report.primary_energy_sources ?? "Non configurato"}</div>
          <div><strong style={{ color: "var(--cei-text-main)" }}>Elettricità:</strong> {report.electricity_price_per_kwh != null ? `€${report.electricity_price_per_kwh}/kWh` : "Non configurato"}</div>
          <div><strong style={{ color: "var(--cei-text-main)" }}>Gas:</strong> {report.gas_price_per_kwh != null ? `€${report.gas_price_per_kwh}/kWh` : "Non configurato"}</div>
          <div><strong style={{ color: "var(--cei-text-main)" }}>Valuta:</strong> {report.currency_code ?? "—"}</div>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts tab
// ---------------------------------------------------------------------------
function AlertsTab({ orgId }: { orgId: number }) {
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
  const statusLabel   = overallStatus === "critical" ? "⚠ Criticità rilevate" : overallStatus === "warning" ? "⚡ Anomalie in corso" : "✓ Tutti gli impianti nella norma";

  const siteHealth = (site: { id: number; name: string; site_id: string | null }) => {
    const active = report.active_site_ids.includes(site.site_id ?? `site-${site.id}`);
    if (!active) return { color: "#94a3b8", label: "Nessun dato", icon: "○" };
    if (report.critical_alerts > 0) return { color: "#ef4444", label: "Verificare", icon: "●" };
    if (report.open_alerts > 0)     return { color: "#f59e0b", label: "Anomalia",   icon: "●" };
    return { color: "#22c55e", label: "Normale", icon: "●" };
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
          {report.alerts_last_7d} alert negli ultimi 7 giorni · {report.open_alerts} aperti · {report.critical_alerts} critici
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.75rem" }}>
        <KpiChip label="Alert aperti"   value={<span style={{ color: report.open_alerts     > 0 ? "#f59e0b" : "#22c55e" }}>{report.open_alerts}</span>} />
        <KpiChip label="Critici"        value={<span style={{ color: report.critical_alerts  > 0 ? "#ef4444" : "#22c55e" }}>{report.critical_alerts}</span>} />
        <KpiChip label="Alert (7gg)"    value={report.alerts_last_7d} sub="Tutti i livelli" />
        <KpiChip label="Siti attivi"    value={`${report.active_site_ids.length}/${report.total_sites}`} sub="Con dati recenti" />
      </div>

      {/* Per-site health grid */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Stato impianti</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {report.sites.length === 0 ? (
            <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)" }}>Nessun impianto configurato.</div>
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
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Segnalazioni normative</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ padding: "0.65rem 0.85rem", borderRadius: "0.5rem", border: `1px solid ${dataGap ? "#ef4444" : "#22c55e"}33`, background: `${dataGap ? "#ef4444" : "#22c55e"}08`, fontSize: "0.84rem" }}>
            <span style={{ fontWeight: 600, color: dataGap ? "#ef4444" : "#22c55e" }}>{dataGap ? "⚠ Gap dati rilevato" : "✓ Continuità dati"}</span>
            <span style={{ color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>
              {dataGap ? `Nessun dato da ${lastIngestAge}h — lacuna potenzialmente non conforme per audit CBAM` : "Flusso dati continuo — idoneo per MRV CBAM/ETS"}
            </span>
          </div>
          <div style={{ padding: "0.65rem 0.85rem", borderRadius: "0.5rem", border: `1px solid ${report.critical_alerts > 0 ? "#ef4444" : "#22c55e"}33`, background: `${report.critical_alerts > 0 ? "#ef4444" : "#22c55e"}08`, fontSize: "0.84rem" }}>
            <span style={{ fontWeight: 600, color: report.critical_alerts > 0 ? "#ef4444" : "#22c55e" }}>
              {report.critical_alerts > 0 ? `⚠ ${report.critical_alerts} anomalia critica` : "✓ Nessuna anomalia critica"}
            </span>
            <span style={{ color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>
              {report.critical_alerts > 0 ? "Consigliata revisione prima del prossimo audit ETS" : "Profilo di consumo nella norma per ETS Phase 4"}
            </span>
          </div>
          <div style={{ padding: "0.65rem 0.85rem", borderRadius: "0.5rem", border: "1px solid rgba(148,163,184,0.16)", background: "rgba(148,163,184,0.04)", fontSize: "0.84rem" }}>
            <span style={{ fontWeight: 600, color: "#f59e0b" }}>ℹ ETS Phase 4</span>
            <span style={{ color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>
              Quote gratuite ridotte del 4.4%/anno — verificare baseline e opportunità di efficienza nel tab Energia
            </span>
          </div>
        </div>
      </div>

      {/* Plant-level events only */}
      {plantEvents.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Attività impianti recente</div>
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
        Soglie alert personalizzabili nella tab <strong>Thresholds</strong>.
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports tab
// ---------------------------------------------------------------------------
function ReportsTab({ orgId, orgName }: { orgId: number; orgName: string }) {
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
    { ok: isLive,                       label: "Ingestion continua (< 25h)",           detail: "Necessario per EnPI verificabile" },
    { ok: hasTariff,                    label: "Tariffa €/kWh configurata",            detail: "Necessario per calcolo costi ISO 50001" },
    { ok: allSitesActive,               label: "Tutti gli impianti trasmettono dati",   detail: "Copertura completa del portfolio" },
    { ok: hasHistory,                   label: "Storico ≥ 30 giorni",                  detail: "Baseline statistica affidabile" },
    { ok: report.open_alerts === 0,     label: "Nessun alert aperto",                  detail: "Profilo di consumo nella norma" },
  ];
  const isoScore  = isoChecks.filter(c => c.ok).length;
  const isoColor  = isoScore === 5 ? "#22c55e" : isoScore >= 3 ? "#f59e0b" : "#ef4444";
  const isoStatus = isoScore === 5 ? "Conforme" : isoScore >= 3 ? "In progress" : "Non conforme";

  const cbamChecks = [
    { ok: isLive,     label: "Dati MRV aggiornati (< 25h)",   detail: "CBAM richiede dati verificati su richiesta" },
    { ok: hasHistory, label: "Storico emissioni ≥ 30 giorni", detail: "Necessario per dichiarazione doganale" },
    { ok: hasTariff,  label: "Vettore energetico configurato", detail: "Identificazione fonte emissioni" },
  ];
  const cbamScore  = cbamChecks.filter(c => c.ok).length;
  const cbamColor  = cbamScore === 3 ? "#22c55e" : cbamScore >= 2 ? "#f59e0b" : "#ef4444";
  const cbamStatus = cbamScore === 3 ? "Pronto" : cbamScore >= 2 ? "Parziale" : "Non pronto";

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
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>Report portfolio — {orgName}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginTop: "0.2rem" }}>
            Generato: {fmtDt(report.generated_at)} · {report.total_sites} impianti · {report.total_timeseries_records.toLocaleString()} letture totali
            {kwh7d != null && ` · ${Math.round(kwh7d).toLocaleString()} kWh (7gg)`}
            {cost7d != null && ` · €${cost7d} costo est.`}
          </div>
        </div>
        <button style={btnPrimary} onClick={handleDownload} disabled={downloading}>
          {downloading ? "Download…" : "↓ Scarica PDF"}
        </button>
      </div>

      {/* ISO 50001 compliance */}
      <div style={{ borderRadius: "0.75rem", border: `1px solid ${isoColor}33`, overflow: "hidden" }}>
        <div style={{ padding: "0.75rem 1rem", background: `${isoColor}0d`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, color: isoColor }}>ISO 50001 — {isoStatus}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>{isoScore}/5 requisiti</div>
        </div>
        <div style={{ padding: "0 1rem 0.25rem" }}>
          {isoChecks.map(c => checkRow(c.ok, c.label, c.detail))}
        </div>
      </div>

      {/* CBAM readiness */}
      <div style={{ borderRadius: "0.75rem", border: `1px solid ${cbamColor}33`, overflow: "hidden" }}>
        <div style={{ padding: "0.75rem 1rem", background: `${cbamColor}0d`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, color: cbamColor }}>CBAM Readiness — {cbamStatus}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>{cbamScore}/3 requisiti · In vigore da gen 2026</div>
        </div>
        <div style={{ padding: "0 1rem 0.25rem" }}>
          {cbamChecks.map(c => checkRow(c.ok, c.label, c.detail))}
        </div>
      </div>

      {/* ETS Phase 4 note */}
      <div style={{ padding: "0.85rem 1rem", borderRadius: "0.6rem", border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)", fontSize: "0.84rem" }}>
        <div style={{ fontWeight: 600, color: "#f59e0b", marginBottom: "0.3rem" }}>ℹ ETS Phase 4 — Riduzione quote gratuite</div>
        <div style={{ color: "var(--cei-text-muted)", lineHeight: 1.6 }}>
          Le quote ETS gratuite si riducono del <strong style={{ color: "var(--cei-text-main)" }}>4.4% ogni anno</strong> fino al 2030.
          Per {orgName}, questo significa che ogni anno il costo delle emissioni non coperte aumenta.
          I dati CEI permettono di identificare e documentare le riduzioni di consumo per massimizzare le quote disponibili.
        </div>
      </div>

      {/* 7-day summary table */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Riepilogo 7 giorni per impianto</div>
        {report.sites.length === 0 ? (
          <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)" }}>Nessun impianto configurato.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr>
                {["Impianto", "Posizione", "Stato", "Energia 7gg", "Costo est.", "Conformità"].map(h => (
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
                      <span style={{ color: active ? "#22c55e" : "#94a3b8", fontSize: "0.8rem" }}>{active ? "● Attivo" : "○ Silente"}</span>
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-main)", fontWeight: 500 }}>
                      {siteKwh != null ? `${siteKwh.toLocaleString()} kWh` : "—"}
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem", color: "#22c55e", fontWeight: 500 }}>{siteCost}</td>
                    <td style={{ padding: "0.5rem 0.6rem" }}>
                      <span style={{ fontSize: "0.76rem", padding: "0.15rem 0.5rem", borderRadius: "999px", background: active && isoScore >= 3 ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.1)", color: active && isoScore >= 3 ? "#22c55e" : "#94a3b8" }}>
                        {active && isoScore >= 3 ? "In norma" : "Da verificare"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

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
            {downloading ? t("manage.pdf.downloading") : t("manage.pdf.download")}
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
