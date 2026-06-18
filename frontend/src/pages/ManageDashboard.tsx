// frontend/src/pages/ManageDashboard.tsx
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import LinkRequestsPanel from "../components/LinkRequestsPanel";
import {
  getPortfolioSummary,
  getPortfolioAnalytics,
  getOnboardingStatus,
  downloadClientReport,
  downloadCbamExposurePdf,
  downloadComplianceReadinessPdf,
  listPartnerInvites,
  createPartnerInvite,
  revokePartnerInvite,
  type PartnerInvite,
  createClientOrg,
  type PortfolioSummary,
  type PortfolioAnalytics,
  type OnboardingStatus,
  type ClientOrgIngestionStats,
  type ClientOrgKPI,
  type OnboardingStep,
} from "../services/manageApi";
import { fmtDate, fmtDateTime } from "../utils/dateFormat";

function fmtNum(n: number): string { return n.toLocaleString(); }

function statusColor(hasRecent: boolean): string {
  return hasRecent ? "var(--cei-green, #22c55e)" : "var(--cei-amber, #f59e0b)";
}

function statusDot(hasRecent: boolean) {
  return (
    <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: statusColor(hasRecent), marginRight: "6px", flexShrink: 0 }} />
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="cei-card" style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--cei-text-muted)" }}>{label}</div>
      <div style={{ marginTop: "0.35rem", fontSize: "1.7rem", fontWeight: 600, color: accent ? "var(--cei-green, #22c55e)" : undefined }}>{value}</div>
      {sub && <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>{sub}</div>}
    </div>
  );
}

function SectionHeading({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <h2 style={{ fontSize: "0.85rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--cei-text-muted)", margin: "1.5rem 0 0.75rem", ...style }}>
      {children}
    </h2>
  );
}

function ClientTable({ summary, analytics, onDownload, downloading, onOrgClick }: {
  summary: PortfolioSummary;
  analytics: PortfolioAnalytics | null;
  onDownload: (id: number) => void;
  downloading: number | null;
  onOrgClick: (id: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.toLowerCase().startsWith("it") ? "it" : "en";
  const kpiMap = new Map<number, ClientOrgKPI>(analytics?.clients.map((c: ClientOrgKPI) => [c.org_id, c]) ?? []);

  if (summary.clients.length === 0) {
    return (
      <div className="cei-card" style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>
        {t("manage.clients.noClients")}
      </div>
    );
  }

  const headers = [
    t("manage.clients.table.name"),
    t("manage.clients.table.status"),
    t("manage.clients.table.sites"),
    t("manage.clients.table.records24h"),
    t("manage.clients.table.records7d"),
    t("manage.clients.table.totalRecords"),
    t("manage.clients.table.lastIngestion"),
    t("manage.clients.table.openAlerts"),
    t("manage.clients.table.activeTokens"),
    t("manage.clients.table.report"),
    "CBAM PDF",
    "Compliance PDF",
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "0.5rem 0.75rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", borderBottom: "1px solid var(--cei-border-subtle)", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.clients.map((client: ClientOrgIngestionStats, idx: number) => {
            const kpi: ClientOrgKPI | undefined = kpiMap.get(client.org_id);
            const hasRecent = client.records_last_24h > 0;
            const openAlerts = kpi?.open_alerts ?? 0;
            const criticalAlerts = kpi?.critical_alerts ?? 0;
            const isDownloading = downloading === client.org_id;

            return (
              <tr key={client.org_id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(148, 163, 184, 0.04)" }}>
                <td style={{ padding: "0.55rem 0.75rem", fontWeight: 500 }}>
                  <button onClick={() => onOrgClick(client.org_id)} style={{ background: "transparent", border: "none", padding: 0, color: "var(--cei-text-main)", fontWeight: 500, fontSize: "0.84rem", cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(148,163,184,0.4)", textUnderlineOffset: "3px" }}>
                    {client.org_name}
                  </button>
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  <span style={{ display: "flex", alignItems: "center" }}>
                    {statusDot(hasRecent)}
                    <span style={{ color: statusColor(hasRecent), fontSize: "0.8rem" }}>
                      {hasRecent ? t("manage.clients.status.active") : t("manage.clients.status.silent")}
                    </span>
                  </span>
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{client.active_sites}/{kpi?.total_sites ?? client.active_sites}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{fmtNum(client.records_last_24h)}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{fmtNum(client.records_last_7d)}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{fmtNum(client.total_records)}</td>
                <td style={{ padding: "0.55rem 0.75rem", color: "var(--cei-text-muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>{fmtDateTime(client.last_ingestion_at, lang)}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  {openAlerts > 0 ? (
                    <span style={{ color: criticalAlerts > 0 ? "var(--cei-red, #ef4444)" : "var(--cei-amber, #f59e0b)", fontWeight: 600 }}>
                      {openAlerts}{criticalAlerts > 0 && ` (${criticalAlerts} crit)`}
                    </span>
                  ) : (
                    <span style={{ color: "var(--cei-green, #22c55e)" }}>0</span>
                  )}
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{kpi?.active_tokens ?? "—"}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  <button onClick={() => onDownload(client.org_id)} disabled={isDownloading} style={{ fontSize: "0.78rem", padding: "0.25rem 0.65rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: "transparent", color: isDownloading ? "var(--cei-text-muted)" : "var(--cei-text-main)", cursor: isDownloading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                    {isDownloading ? t("manage.clients.downloading") : t("manage.clients.downloadPdf")}
                  </button>
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  <button onClick={() => onDownloadCbam(client.org_id)} disabled={downloadingCbam === client.org_id} style={{ fontSize: "0.78rem", padding: "0.25rem 0.65rem", borderRadius: "999px", border: "1px solid rgba(56,189,248,0.4)", background: "transparent", color: downloadingCbam === client.org_id ? "var(--cei-text-muted)" : "var(--cei-accent,#38bdf8)", cursor: downloadingCbam === client.org_id ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                    {downloadingCbam === client.org_id ? "..." : "CBAM"}
                  </button>
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  <button onClick={() => onDownloadCompliance(client.org_id)} disabled={downloadingCompliance === client.org_id} style={{ fontSize: "0.78rem", padding: "0.25rem 0.65rem", borderRadius: "999px", border: "1px solid rgba(34,197,94,0.4)", background: "transparent", color: downloadingCompliance === client.org_id ? "var(--cei-text-muted)" : "var(--cei-green,#22c55e)", cursor: downloadingCompliance === client.org_id ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                    {downloadingCompliance === client.org_id ? "..." : "Readiness"}
                  </button>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ManageDashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.toLowerCase().startsWith("it") ? "it" : "en";
  const navigate = useNavigate();

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<PortfolioAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(7);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloadingCbam, setDownloadingCbam] = useState<number | null>(null);
  const [downloadingCompliance, setDownloadingCompliance] = useState<number | null>(null);
  const [invites, setInvites] = useState<PartnerInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [newInviteName, setNewInviteName] = useState("");
  const [newInviteEmail, setNewInviteEmail] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSources, setNewOrgSources] = useState("");
  const [newOrgCurrency, setNewOrgCurrency] = useState("EUR");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return;
    setCreatingOrg(true);
    setCreateOrgError(null);
    try {
      const org = await createClientOrg({
        name: newOrgName.trim(),
        primary_energy_sources: newOrgSources.trim() || undefined,
        currency_code: newOrgCurrency.trim().toUpperCase() || undefined,
      });
      setShowCreateOrg(false);
      setNewOrgName("");
      setNewOrgSources("");
      setNewOrgCurrency("EUR");
      const [s, o] = await Promise.all([getPortfolioSummary(), getOnboardingStatus()]);
      setSummary(s);
      setOnboarding(o);
      navigate(`/manage/client-orgs/${org.id}`);
    } catch (e: unknown) {
      const err = e as any;
      setCreateOrgError(err?.response?.data?.message ?? err?.message ?? "Failed to create organization.");
    } finally {
      setCreatingOrg(false);
    }
  };

  const loadSummary = async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const [s, o] = await Promise.all([getPortfolioSummary(), getOnboardingStatus()]);
      setSummary(s);
      setOnboarding(o);
    } catch (e: any) {
      setSummaryError(e?.message ?? t("errors.generic"));
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => { loadSummary(); }, [t]);

  useEffect(() => {
    let isMounted = true;
    setAnalyticsLoading(true);
    getPortfolioAnalytics(windowDays)
      .then((a: PortfolioAnalytics) => { if (!isMounted) return; setAnalytics(a); })
      .catch(() => { if (!isMounted) return; setAnalytics(null); })
      .finally(() => { if (!isMounted) return; setAnalyticsLoading(false); });
    return () => { isMounted = false; };
  }, [windowDays]);

  const handleDownload = async (orgId: number) => {
    setDownloading(orgId);
    setDownloadError(null);
    try { await downloadClientReport(orgId); }
    catch (e: unknown) { setDownloadError((e as Error)?.message ?? t("errors.generic")); }
    finally { setDownloading(null); }
  };

  const WINDOW_OPTIONS = [
    { label: t("manage.header.windowBtn7"), value: 7 },
    { label: t("manage.header.windowBtn14"), value: 14 },
    { label: t("manage.header.windowBtn30"), value: 30 },
  ];

  if (summaryLoading) return <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><LoadingSpinner /></div>;

  return (
    <div style={{ maxWidth: "100vw", overflowX: "hidden" }}>
      <section style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 600, letterSpacing: "-0.02em" }}>{t("manage.header.title")}</h1>
          <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>{t("manage.header.subtitle")}</p>
        </div>
        {summary && (
          <div style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            <div><strong>{summary.managing_org_name}</strong></div>
            <div>{t("manage.header.generatedBy")}: {fmtDate(summary.generated_at, lang)}</div>
          </div>
        )}
      </section>

      {summaryError && <section style={{ marginTop: "0.75rem" }}><ErrorBanner message={summaryError} onClose={() => setSummaryError(null)} /></section>}
      {downloadError && <section style={{ marginTop: "0.75rem" }}><ErrorBanner message={downloadError} onClose={() => setDownloadError(null)} /></section>}

    
        <section style={{ marginTop: "1rem" }}>
          <div className="cei-card">
            <LinkRequestsPanel onAccepted={loadSummary} />
          </div>
        </section>
        {summary && (
        <section className="dashboard-row" style={{ marginTop: "1rem" }}>
          <StatCard label={t("manage.kpis.clientOrgs")} value={summary.total_client_orgs} sub={t("manage.kpis.clientOrgsActive", { count: summary.clients_with_recent_ingestion })} />
          <StatCard label={t("manage.kpis.totalSites")} value={fmtNum(summary.total_sites)} sub={t("manage.kpis.totalSitesSub")} />
          <StatCard label={t("manage.kpis.totalRecords")} value={fmtNum(summary.total_timeseries_records)} sub={t("manage.kpis.totalRecordsSub")} />
          <StatCard label={t("manage.kpis.openAlerts")} value={summary.open_alerts_total} sub={t("manage.kpis.openAlertsSub")} accent={summary.open_alerts_total === 0} />
          <StatCard label={t("manage.kpis.clientsWithoutData")} value={summary.clients_without_recent_ingestion} sub={t("manage.kpis.clientsWithoutDataSub")} />
        </section>
      )}

      <section style={{ marginTop: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>{t("manage.header.analyticsWindow")}</span>
        {WINDOW_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => setWindowDays(opt.value)} style={{ fontSize: "0.78rem", padding: "0.25rem 0.75rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: windowDays === opt.value ? "rgba(148,163,184,0.15)" : "transparent", color: windowDays === opt.value ? "var(--cei-text-main)" : "var(--cei-text-muted)", cursor: "pointer" }}>
            {opt.label}
          </button>
        ))}
        {analyticsLoading && <span style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>{t("manage.header.analyticsLoading")}</span>}
      </section>

      {analytics && (
        <section className="dashboard-row" style={{ marginTop: "0.75rem" }}>
          <StatCard label={t("manage.kpis.recordsWindow", { days: windowDays })} value={fmtNum(analytics.total_records_in_window)} />
          <StatCard label={t("manage.kpis.openAlerts")} value={analytics.total_open_alerts} />
          <StatCard label={t("manage.kpis.criticalAlerts")} value={analytics.total_critical_alerts} accent={analytics.total_critical_alerts === 0} />
          <StatCard label={t("manage.kpis.activeTokens")} value={analytics.total_active_tokens} />
        </section>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem", marginBottom: "0.75rem" }}>
        <SectionHeading style={{ margin: 0 }}>{t("manage.clients.title")}</SectionHeading>
        <button
          onClick={() => setShowCreateOrg(true)}
          style={{ padding: "0.45rem 1.1rem", borderRadius: "999px", border: "none", background: "var(--cei-green, #22c55e)", color: "#0f172a", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
        >
          + Add client org
        </button>
      </div>

      {summary ? (
        <div className="cei-card" style={{ padding: 0, overflow: "hidden" }}>
          <ClientTable summary={summary} analytics={analytics} onDownload={handleDownload} downloading={downloading} onOrgClick={(id) => navigate(`/manage/client-orgs/${id}`)} />
            onDownloadCbam={handleDownloadCbam}
            onDownloadCompliance={handleDownloadCompliance}
            downloadingCbam={downloadingCbam}
            downloadingCompliance={downloadingCompliance}
        </div>
      ) : (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>{t("manage.clients.noClients")}</div>
      )}

      {onboarding && (
        <>
          <SectionHeading>{t("manage.onboarding.title")}</SectionHeading>
          <div className="cei-card">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
              {onboarding.steps.map((step: OnboardingStep) => (
                <div key={step.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.83rem" }}>
                  <span style={{ marginTop: "2px", fontSize: "1rem", flexShrink: 0, color: step.complete ? "var(--cei-green, #22c55e)" : "var(--cei-text-muted)" }}>
                    {step.complete ? "✓" : "○"}
                  </span>
                  <div>
                    <div style={{ fontWeight: 500, color: step.complete ? "var(--cei-text-main)" : "var(--cei-text-muted)" }}>
                      {t(`manage.onboarding.steps.${step.key}.label`, { defaultValue: step.label })}
                    </div>
                    {step.detail && (
                      <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                        {t(`manage.onboarding.steps.${step.key}.detail`, { defaultValue: step.detail })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    {showCreateOrg && (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
        onClick={(e) => { if (e.target === e.currentTarget) setShowCreateOrg(false); }}>
        <div style={{ background: "rgba(15, 23, 42, 0.99)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.75rem", padding: "1.5rem", minWidth: "360px", maxWidth: "480px", width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 600, fontSize: "1rem" }}>Add client organization</div>
            <button onClick={() => setShowCreateOrg(false)} style={{ background: "transparent", border: "none", color: "var(--cei-text-muted)", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
          </div>
          {createOrgError && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{createOrgError}</div>}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Organization name *</label>
            <input style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.4rem", border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.07)", color: "var(--cei-text-main)", fontSize: "0.875rem", boxSizing: "border-box", outline: "none" }}
              value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder="e.g. Ceramica Rossi Srl" autoFocus />
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Primary energy sources</label>
            <input style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.4rem", border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.07)", color: "var(--cei-text-main)", fontSize: "0.875rem", boxSizing: "border-box", outline: "none" }}
              value={newOrgSources} onChange={(e) => setNewOrgSources(e.target.value)} placeholder="e.g. electricity, gas" />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Currency</label>
            <input style={{ width: "100px", padding: "0.5rem 0.75rem", borderRadius: "0.4rem", border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.07)", color: "var(--cei-text-main)", fontSize: "0.875rem", boxSizing: "border-box", outline: "none" }}
              value={newOrgCurrency} onChange={(e) => setNewOrgCurrency(e.target.value)} maxLength={3} placeholder="EUR" />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button onClick={() => setShowCreateOrg(false)} style={{ padding: "0.45rem 1.1rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: "transparent", color: "var(--cei-text-muted)", fontSize: "0.82rem", cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleCreateOrg} disabled={creatingOrg || !newOrgName.trim()}
              style={{ padding: "0.45rem 1.1rem", borderRadius: "999px", border: "none", background: "var(--cei-green, #22c55e)", color: "#0f172a", fontWeight: 600, fontSize: "0.82rem", cursor: creatingOrg || !newOrgName.trim() ? "not-allowed" : "pointer", opacity: creatingOrg || !newOrgName.trim() ? 0.6 : 1 }}>
              {creatingOrg ? "Creating…" : "Create organization"}
            </button>
          </div>
        </div>
      </div>
    )}

      {/* Partner Invites Panel */}
      <div style={{ marginTop: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <SectionHeading style={{ margin: 0 }}>Partner Invite Links</SectionHeading>
          <button onClick={() => { setShowInvitePanel(!showInvitePanel); if (!showInvitePanel) loadInvites(); }} style={{ fontSize: "0.8rem", padding: "0.3rem 0.8rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: "transparent", color: "var(--cei-text-muted)", cursor: "pointer" }}>
            {showInvitePanel ? "Hide" : "Manage Invites"}
          </button>
        </div>
        {showInvitePanel && (
          <div className="cei-card">
            {inviteError && <div style={{ color: "var(--cei-red,#ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{inviteError}</div>}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 160px" }}>
                <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.3rem" }}>Factory name</div>
                <input value={newInviteName} onChange={e => setNewInviteName(e.target.value)} placeholder="e.g. Ceramica Bianchi Srl" style={{ width: "100%", padding: "0.45rem 0.7rem", borderRadius: "0.4rem", border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.07)", color: "var(--cei-text-main)", fontSize: "0.85rem", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginBottom: "0.3rem" }}>Factory email (optional)</div>
                <input value={newInviteEmail} onChange={e => setNewInviteEmail(e.target.value)} placeholder="admin@factory.it" style={{ width: "100%", padding: "0.45rem 0.7rem", borderRadius: "0.4rem", border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.07)", color: "var(--cei-text-main)", fontSize: "0.85rem", boxSizing: "border-box" }} />
              </div>
              <button onClick={handleCreateInvite} disabled={creatingInvite || !newInviteName.trim()} style={{ padding: "0.45rem 1.1rem", borderRadius: "999px", border: "none", background: "var(--cei-green,#22c55e)", color: "#0f172a", fontWeight: 600, fontSize: "0.82rem", cursor: creatingInvite || !newInviteName.trim() ? "not-allowed" : "pointer", opacity: creatingInvite || !newInviteName.trim() ? 0.5 : 1 }}>
                {creatingInvite ? "Generating..." : "+ Generate Invite Link"}
              </button>
            </div>
            {invitesLoading ? (
              <div style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>Loading...</div>
            ) : invites.length === 0 ? (
              <div style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>No invites yet. Generate a link to onboard a factory client.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead><tr>
                  {["Factory", "Email", "Status", "Expires", "Link", "Actions"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", borderBottom: "1px solid var(--cei-border-subtle)" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {invites.map((inv, idx) => {
                    const sc = inv.status === "active" ? "var(--cei-green,#22c55e)" : inv.status === "used" ? "var(--cei-text-muted)" : "var(--cei-red,#ef4444)";
                    return (
                      <tr key={inv.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(148,163,184,0.04)" }}>
                        <td style={{ padding: "0.45rem 0.6rem", fontWeight: 500 }}>{inv.factory_name ?? "—"}</td>
                        <td style={{ padding: "0.45rem 0.6rem", color: "var(--cei-text-muted)" }}>{inv.factory_email ?? "—"}</td>
                        <td style={{ padding: "0.45rem 0.6rem" }}><span style={{ color: sc, fontWeight: 600, fontSize: "0.78rem" }}>{inv.status.toUpperCase()}</span></td>
                        <td style={{ padding: "0.45rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.78rem" }}>{new Date(inv.expires_at).toLocaleDateString()}</td>
                        <td style={{ padding: "0.45rem 0.6rem" }}>
                          {inv.status === "active" ? (
                            <button onClick={() => handleCopyInvite(inv.id, inv.invite_url)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.55rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: "transparent", color: copiedId === inv.id ? "var(--cei-green,#22c55e)" : "var(--cei-accent,#38bdf8)", cursor: "pointer" }}>
                              {copiedId === inv.id ? "Copied!" : "Copy Link"}
                            </button>
                          ) : <span style={{ color: "var(--cei-text-muted)", fontSize: "0.75rem" }}>{inv.status}</span>}
                        </td>
                        <td style={{ padding: "0.45rem 0.6rem" }}>
                          {inv.status === "active" && (
                            <button onClick={() => handleRevokeInvite(inv.id)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.55rem", borderRadius: "999px", border: "1px solid rgba(239,68,68,0.4)", background: "transparent", color: "var(--cei-red,#ef4444)", cursor: "pointer" }}>Revoke</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManageDashboard;
