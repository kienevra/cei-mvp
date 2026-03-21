// frontend/src/pages/ManageDashboard.tsx
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import {
  getPortfolioSummary,
  getPortfolioAnalytics,
  getOnboardingStatus,
  downloadClientReport,
  type PortfolioSummary,
  type PortfolioAnalytics,
  type OnboardingStatus,
  type ClientOrgIngestionStats,
  type ClientOrgKPI,
  type OnboardingStep,
} from "../services/manageApi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDt(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function statusColor(hasRecent: boolean): string {
  return hasRecent ? "var(--cei-green, #22c55e)" : "var(--cei-amber, #f59e0b)";
}

function statusDot(hasRecent: boolean) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "8px", height: "8px", borderRadius: "50%",
        background: statusColor(hasRecent),
        marginRight: "6px", flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: boolean;
}) {
  return (
    <div className="cei-card" style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--cei-text-muted)" }}>
        {label}
      </div>
      <div style={{ marginTop: "0.35rem", fontSize: "1.7rem", fontWeight: 600, color: accent ? "var(--cei-green, #22c55e)" : undefined }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>{sub}</div>}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: "0.85rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--cei-text-muted)", margin: "1.5rem 0 0.75rem" }}>
      {children}
    </h2>
  );
}

function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  if (status.all_complete) return null;
  const pending = status.steps.filter((s: OnboardingStep) => !s.complete);
  return (
    <div className="cei-card" style={{ borderLeft: "3px solid var(--cei-amber, #f59e0b)", marginBottom: "1rem" }}>
      <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
        Onboarding checklist — {pending.length} step{pending.length !== 1 ? "s" : ""} remaining
      </div>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 1.8 }}>
        {pending.map((step: OnboardingStep) => (
          <li key={step.key} style={{ color: "var(--cei-text-muted)" }}>
            <strong style={{ color: "var(--cei-text-main)" }}>{step.label}</strong>
            {step.detail ? ` — ${step.detail}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClientTable({
  summary, analytics, onDownload, downloading, onOrgClick,
}: {
  summary: PortfolioSummary;
  analytics: PortfolioAnalytics | null;
  onDownload: (id: number) => void;
  downloading: number | null;
  onOrgClick: (id: number) => void;
}) {
  const kpiMap = new Map<number, ClientOrgKPI>(
    analytics?.clients.map((c: ClientOrgKPI) => [c.org_id, c]) ?? []
  );

  if (summary.clients.length === 0) {
    return (
      <div className="cei-card" style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>
        No client organizations yet. Use <strong>POST /manage/onboarding/bootstrap</strong> to add your first client.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
        <thead>
          <tr>
            {["Client org", "Status", "Sites", "Records (24h)", "Records (7d)", "Total records", "Last ingestion", "Open alerts", "Active tokens", "Report"].map((h) => (
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
                  {/* Clickable org name */}
                  <button
                    onClick={() => onOrgClick(client.org_id)}
                    style={{
                      background: "transparent", border: "none", padding: 0,
                      color: "var(--cei-text-main)", fontWeight: 500, fontSize: "0.84rem",
                      cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(148,163,184,0.4)",
                      textUnderlineOffset: "3px",
                    }}
                  >
                    {client.org_name}
                  </button>
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  <span style={{ display: "flex", alignItems: "center" }}>
                    {statusDot(hasRecent)}
                    <span style={{ color: statusColor(hasRecent), fontSize: "0.8rem" }}>
                      {hasRecent ? "Active" : "Silent"}
                    </span>
                  </span>
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  {client.active_sites}/{kpi?.total_sites ?? client.active_sites}
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{fmtNum(client.records_last_24h)}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{fmtNum(client.records_last_7d)}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{fmtNum(client.total_records)}</td>
                <td style={{ padding: "0.55rem 0.75rem", color: "var(--cei-text-muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                  {fmtDt(client.last_ingestion_at)}
                </td>
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
                  <button
                    onClick={() => onDownload(client.org_id)}
                    disabled={isDownloading}
                    style={{ fontSize: "0.78rem", padding: "0.25rem 0.65rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: "transparent", color: isDownloading ? "var(--cei-text-muted)" : "var(--cei-text-main)", cursor: isDownloading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                  >
                    {isDownloading ? "Downloading…" : "↓ PDF"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const WINDOW_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "14 days", value: 14 },
  { label: "30 days", value: 30 },
];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const ManageDashboard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [analytics, setAnalytics] = useState<PortfolioAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(7);

  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setSummaryLoading(true);
    setSummaryError(null);
    Promise.all([getPortfolioSummary(), getOnboardingStatus()])
      .then(([s, o]: [PortfolioSummary, OnboardingStatus]) => {
        if (!isMounted) return;
        setSummary(s);
        setOnboarding(o);
      })
      .catch((e: Error) => {
        if (!isMounted) return;
        setSummaryError(e?.message ?? "Failed to load portfolio data.");
      })
      .finally(() => {
        if (!isMounted) return;
        setSummaryLoading(false);
      });
    return () => { isMounted = false; };
  }, []);

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
    try {
      await downloadClientReport(orgId);
    } catch (e: unknown) {
      setDownloadError((e as Error)?.message ?? "Failed to download report.");
    } finally {
      setDownloading(null);
    }
  };

  if (summaryLoading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
      <LoadingSpinner />
    </div>
  );

  return (
    <div style={{ maxWidth: "100vw", overflowX: "hidden" }}>
      <section style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
            {t("manage.header.title", { defaultValue: "Portfolio management" })}
          </h1>
          <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
            {t("manage.header.subtitle", { defaultValue: "Overview of all client organizations, ingestion health, and alert status." })}
          </p>
        </div>
        {summary && (
          <div style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            <div><strong>{summary.managing_org_name}</strong></div>
            <div>Generated: {fmtDt(summary.generated_at)}</div>
          </div>
        )}
      </section>

      {summaryError && <section style={{ marginTop: "0.75rem" }}><ErrorBanner message={summaryError} onClose={() => setSummaryError(null)} /></section>}
      {downloadError && <section style={{ marginTop: "0.75rem" }}><ErrorBanner message={downloadError} onClose={() => setDownloadError(null)} /></section>}

      {onboarding && !onboarding.all_complete && (
        <section style={{ marginTop: "1rem" }}>
          <OnboardingChecklist status={onboarding} />
        </section>
      )}

      {summary && (
        <section className="dashboard-row" style={{ marginTop: "1rem" }}>
          <StatCard label="Client orgs" value={summary.total_client_orgs} sub={`${summary.clients_with_recent_ingestion} active in last 24h`} />
          <StatCard label="Total sites" value={fmtNum(summary.total_sites)} sub="Across all client orgs" />
          <StatCard label="Total records" value={fmtNum(summary.total_timeseries_records)} sub="All time, all clients" />
          <StatCard label="Open alerts" value={summary.open_alerts_total} sub="Across all client orgs" accent={summary.open_alerts_total === 0} />
          <StatCard label="Clients without recent data" value={summary.clients_without_recent_ingestion} sub="No ingestion in last 24h" />
        </section>
      )}

      <section style={{ marginTop: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>Analytics window:</span>
        {WINDOW_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => setWindowDays(opt.value)} style={{ fontSize: "0.78rem", padding: "0.25rem 0.75rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: windowDays === opt.value ? "rgba(148,163,184,0.15)" : "transparent", color: windowDays === opt.value ? "var(--cei-text-main)" : "var(--cei-text-muted)", cursor: "pointer" }}>
            {opt.label}
          </button>
        ))}
        {analyticsLoading && <span style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>Loading…</span>}
      </section>

      {analytics && (
        <section className="dashboard-row" style={{ marginTop: "0.75rem" }}>
          <StatCard label={`Records (${windowDays}d)`} value={fmtNum(analytics.total_records_in_window)} />
          <StatCard label="Open alerts" value={analytics.total_open_alerts} />
          <StatCard label="Critical alerts" value={analytics.total_critical_alerts} accent={analytics.total_critical_alerts === 0} />
          <StatCard label="Active tokens" value={analytics.total_active_tokens} />
        </section>
      )}

      <SectionHeading>{t("manage.clients.title", { defaultValue: "Client organizations" })}</SectionHeading>

      {summary ? (
        <div className="cei-card" style={{ padding: 0, overflow: "hidden" }}>
          <ClientTable
            summary={summary}
            analytics={analytics}
            onDownload={handleDownload}
            downloading={downloading}
            onOrgClick={(id) => navigate(`/manage/client-orgs/${id}`)}
          />
        </div>
      ) : (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>No portfolio data available.</div>
      )}

      {onboarding && (
        <>
          <SectionHeading>{t("manage.onboarding.title", { defaultValue: "Onboarding status" })}</SectionHeading>
          <div className="cei-card">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
              {onboarding.steps.map((step: OnboardingStep) => (
                <div key={step.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.83rem" }}>
                  <span style={{ marginTop: "2px", fontSize: "1rem", flexShrink: 0, color: step.complete ? "var(--cei-green, #22c55e)" : "var(--cei-text-muted)" }}>
                    {step.complete ? "✓" : "○"}
                  </span>
                  <div>
                    <div style={{ fontWeight: 500, color: step.complete ? "var(--cei-text-main)" : "var(--cei-text-muted)" }}>{step.label}</div>
                    {step.detail && <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>{step.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ManageDashboard;
