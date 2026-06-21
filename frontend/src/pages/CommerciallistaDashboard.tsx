// frontend/src/pages/CommerciallistaDashboard.tsx
// Clean commercialista portal — compliance cards, PDF buttons, invite panel.
// No kWh charts, no ingestion stats, no sensor noise.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import LinkRequestsPanel from "../components/LinkRequestsPanel";
import { useAuth } from "../hooks/useAuth";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import {
  getPortfolioSummary,
  downloadCbamExposurePdf,
  downloadComplianceReadinessPdf,
  listPartnerInvites,
  createPartnerInvite,
  revokePartnerInvite,
  type PortfolioSummary,
  type PartnerInvite,
} from "../services/manageApi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ragColor(score: number): string {
  if (score >= 80) return "var(--cei-green,#22c55e)";
  if (score >= 50) return "var(--cei-amber,#f59e0b)";
  return "var(--cei-red,#ef4444)";
}

function ragLabel(score: number): string {
  if (score >= 80) return "READY";
  if (score >= 50) return "PARTIAL";
  return "AT RISK";
}

// Derive a simple 0-100 readiness proxy from ingestion stats
// (real score comes from the compliance readiness endpoint, but we approximate
// from what the portfolio summary already returns to avoid N+1 calls)
function deriveScore(client: any): number {
  const hasData   = (client.total_records ?? 0) > 0;
  const isActive  = (client.records_last_24h ?? 0) > 0;
  const hasSites  = (client.active_sites ?? 0) > 0;
  const noAlerts  = (client.open_alerts ?? 0) === 0;
  let score = 0;
  if (hasData)  score += 30;
  if (isActive) score += 25;
  if (hasSites) score += 25;
  if (noAlerts) score += 20;
  return score;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: "0.78rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--cei-text-muted)", margin: "1.75rem 0 0.75rem 0" }}>
      {children}
    </h2>
  );
}

function ClientComplianceCard({ client, onCbam, onCompliance, loadingCbam, loadingCompliance, onClick }: {
  client: any;
  onCbam: () => void;
  onCompliance: () => void;
  loadingCbam: boolean;
  loadingCompliance: boolean;
  onClick: () => void;
}) {
  const score    = deriveScore(client);
  const color    = ragColor(score);
  const label    = ragLabel(score);
  const isActive = (client.records_last_24h ?? 0) > 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", background: "rgba(15,23,42,0.4)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.6rem", flexWrap: "wrap" }}>

      {/* Factory name */}
      <button onClick={onClick} style={{ flex: "1 1 160px", background: "transparent", border: "none", padding: 0, color: "var(--cei-text-main)", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", textAlign: "left", textDecoration: "underline", textDecorationColor: "rgba(148,163,184,0.25)", textUnderlineOffset: "3px" }}>
        {client.org_name}
      </button>

      {/* RAG badge */}
      <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "0.15rem 0.55rem", borderRadius: "999px", border: `1px solid ${color}44`, background: `${color}10`, color, whiteSpace: "nowrap" }}>
        {label}
      </span>

      {/* Data status */}
      <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: isActive ? "var(--cei-green,#22c55e)" : "var(--cei-amber,#f59e0b)" }} />
        {isActive ? "Active" : "No data"}
      </span>

      {/* Sites */}
      <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", whiteSpace: "nowrap" }}>
        {client.active_sites ?? 0} site{(client.active_sites ?? 0) !== 1 ? "s" : ""}
      </span>

      {/* Alerts */}
      {(client.open_alerts ?? 0) > 0 && (
        <span style={{ fontSize: "0.75rem", color: "var(--cei-red,#ef4444)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {client.open_alerts} alert{client.open_alerts !== 1 ? "s" : ""}
        </span>
      )}

      {/* PDF buttons — right side */}
      <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto" }}>
        <button
          onClick={onCbam}
          disabled={loadingCbam}
          title="Download CBAM Exposure Summary PDF"
          style={{ padding: "0.3rem 0.7rem", borderRadius: "999px", border: "1px solid rgba(56,189,248,0.4)", background: "transparent", color: loadingCbam ? "var(--cei-text-muted)" : "var(--cei-accent,#38bdf8)", fontSize: "0.75rem", fontWeight: 500, cursor: loadingCbam ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
        >
          {loadingCbam ? "..." : "CBAM PDF"}
        </button>
        <button
          onClick={onCompliance}
          disabled={loadingCompliance}
          title="Download Compliance Readiness Assessment PDF"
          style={{ padding: "0.3rem 0.7rem", borderRadius: "999px", border: "1px solid rgba(34,197,94,0.4)", background: "transparent", color: loadingCompliance ? "var(--cei-text-muted)" : "var(--cei-green,#22c55e)", fontSize: "0.75rem", fontWeight: 500, cursor: loadingCompliance ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
        >
          {loadingCompliance ? "..." : "Compliance PDF"}
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Invite Panel
// ---------------------------------------------------------------------------
function InvitePanel() {
  const [invites, setInvites] = useState<PartnerInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    listPartnerInvites()
      .then(setInvites)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true); setError(null);
    try {
      const inv = await createPartnerInvite({ factory_name: name.trim(), factory_email: email.trim() || undefined });
      setInvites(prev => [inv, ...prev]);
      setName(""); setEmail("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to create invite.");
    } finally { setCreating(false); }
  };

  const handleRevoke = async (id: number) => {
    try {
      await revokePartnerInvite(id);
      setInvites(prev => prev.filter(i => i.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to revoke.");
    }
  };

  const handleCopy = (id: number, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const inputSt: React.CSSProperties = {
    flex: "1 1 150px", padding: "0.45rem 0.7rem", borderRadius: "0.4rem",
    border: "1px solid var(--cei-border-subtle)", background: "rgba(148,163,184,0.07)",
    color: "var(--cei-text-main)", fontSize: "0.84rem", outline: "none",
  };

  return (
    <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.75rem", padding: "1.25rem" }}>
      {error && <div style={{ color: "var(--cei-red,#ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</div>}

      {/* Create form */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1.25rem" }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Factory name" style={inputSt} />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (optional)" style={inputSt} />
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          style={{ padding: "0.45rem 1rem", borderRadius: "999px", border: "none", background: "var(--cei-green,#22c55e)", color: "#0f172a", fontWeight: 600, fontSize: "0.82rem", cursor: creating || !name.trim() ? "not-allowed" : "pointer", opacity: creating || !name.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}
        >
          {creating ? "Generating..." : "+ New Invite Link"}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>Loading...</div>
      ) : invites.length === 0 ? (
        <div style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>
          No invite links yet. Generate a link above and send it to a factory — they'll sign up and be automatically connected to your account.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {invites.map(inv => {
            const sc = inv.status === "active" ? "var(--cei-green,#22c55e)" : inv.status === "used" ? "var(--cei-text-muted)" : "var(--cei-red,#ef4444)";
            return (
              <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0.85rem", borderRadius: "0.5rem", background: "rgba(148,163,184,0.04)", border: "1px solid var(--cei-border-subtle)", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 140px", fontWeight: 500, fontSize: "0.84rem" }}>{inv.factory_name ?? "-"}</div>
                <div style={{ flex: "1 1 140px", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>{inv.factory_email ?? "-"}</div>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: sc, padding: "0.15rem 0.5rem", borderRadius: "999px", border: `1px solid ${sc}44`, background: `${sc}10` }}>
                  {inv.status.toUpperCase()}
                </span>
                <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                  Expires {new Date(inv.expires_at).toLocaleDateString()}
                </div>
                {inv.status === "active" && (
                  <>
                    <button onClick={() => handleCopy(inv.id, inv.invite_url)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "999px", border: "1px solid var(--cei-border-subtle)", background: "transparent", color: copiedId === inv.id ? "var(--cei-green,#22c55e)" : "var(--cei-accent,#38bdf8)", cursor: "pointer" }}>
                      {copiedId === inv.id ? "Copied!" : "Copy Link"}
                    </button>
                    <button onClick={() => handleRevoke(inv.id)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "999px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "var(--cei-red,#ef4444)", cursor: "pointer" }}>
                      Revoke
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
const CommerciallistaDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingCbam, setLoadingCbam] = useState<number | null>(null);
  const [loadingCompliance, setLoadingCompliance] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    getPortfolioSummary()
      .then(setSummary)
      .catch(e => setError(e?.message ?? "Failed to load clients."))
      .finally(() => setLoading(false));
  }, []);

  const handleCbam = async (orgId: number) => {
    setLoadingCbam(orgId); setPdfError(null);
    try { await downloadCbamExposurePdf(orgId); }
    catch (e: any) { setPdfError(e?.message ?? "Failed to generate CBAM PDF."); }
    finally { setLoadingCbam(null); }
  };

  const handleCompliance = async (orgId: number) => {
    setLoadingCompliance(orgId); setPdfError(null);
    try { await downloadComplianceReadinessPdf(orgId); }
    catch (e: any) { setPdfError(e?.message ?? "Failed to generate Compliance PDF."); }
    finally { setLoadingCompliance(null); }
  };

  const orgName = (user as any)?.org?.name ?? (user as any)?.organization?.name ?? "Your Practice";

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "1.5rem 1.25rem" }}>

      {/* Page header */}
      <div style={{ marginBottom: "0.25rem" }}>
        <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--cei-accent,#38bdf8)", marginBottom: "0.3rem" }}>
          Commercialista Portal
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.4rem" }}>
          {orgName}
        </h1>
        <p style={{ fontSize: "0.88rem", color: "var(--cei-text-muted)", margin: 0 }}>
          CBAM & ETS compliance overview for your factory clients. Generate co-branded reports to share directly.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {pdfError && (
        <div style={{ marginTop: "1rem", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.5rem", padding: "0.65rem 1rem", color: "var(--cei-red,#ef4444)", fontSize: "0.84rem" }}>
          {pdfError}
        </div>
      )}

      {/* Summary stats */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem", marginTop: "1.5rem" }}>
          {[
            { label: "Factory Clients", value: summary.clients.length },
            { label: "Active (24h)", value: summary.clients.filter((c: any) => (c.records_last_24h ?? 0) > 0).length },
            { label: "Open Alerts", value: summary.clients.reduce((a: number, c: any) => a + (c.open_alerts ?? 0), 0) },
            { label: "Total Sites", value: summary.clients.reduce((a: number, c: any) => a + (c.active_sites ?? 0), 0) },
          ].map(({ label, value }) => (
            <div key={label} className="cei-card" style={{ textAlign: "center", padding: "0.85rem" }}>
              <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", marginTop: "0.2rem" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Client compliance cards */}
      <SectionHeading>Factory Clients</SectionHeading>

      {loading ? (
        <LoadingSpinner />
      ) : summary && summary.clients.length === 0 ? (
        <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.75rem", padding: "2rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>🏭</div>
          <div style={{ fontWeight: 600, marginBottom: "0.4rem" }}>No factory clients yet</div>
          <div style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)", marginBottom: "1rem" }}>
            Use the invite link below to onboard your first factory. They'll sign up and connect automatically.
          </div>
          <button
            onClick={() => document.getElementById("invite-panel")?.scrollIntoView({ behavior: "smooth" })}
            style={{ padding: "0.5rem 1.25rem", borderRadius: "999px", border: "none", background: "var(--cei-green,#22c55e)", color: "#0f172a", fontWeight: 600, fontSize: "0.84rem", cursor: "pointer" }}
          >
            Generate First Invite Link
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {summary?.clients.map((client: any) => (
            <ClientComplianceCard
              key={client.org_id}
              client={client}
              onCbam={() => handleCbam(client.org_id)}
              onCompliance={() => handleCompliance(client.org_id)}
              loadingCbam={loadingCbam === client.org_id}
              loadingCompliance={loadingCompliance === client.org_id}
              onClick={() => navigate(`/manage/client-orgs/${client.org_id}`)}
            />
          ))}
        </div>
      )}

      {/* Link requests from factories */}
      <div style={{ marginTop: "2rem" }}>
        <SectionHeading>Factory Connection Requests</SectionHeading>
        <p style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)", margin: "0 0 0.75rem" }}>
          Factories that have requested to connect their CEI account to your practice.
        </p>
        <LinkRequestsPanel onAccepted={() => getPortfolioSummary().then(setSummary)} />
      </div>

      {/* Invite panel */}
      <div id="invite-panel">
        <SectionHeading>Factory Onboarding — Invite Links</SectionHeading>
        <p style={{ fontSize: "0.84rem", color: "var(--cei-text-muted)", margin: "0 0 0.75rem" }}>
          Generate a secure link and send it to a factory. When they sign up, their account connects to yours automatically — no manual setup required.
        </p>
        <InvitePanel />
      </div>

      {/* Link to full technical dashboard */}
      <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid var(--cei-border-subtle)", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => navigate("/manage")}
          style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", background: "transparent", border: "1px solid var(--cei-border-subtle)", borderRadius: "999px", padding: "0.3rem 0.9rem", cursor: "pointer" }}
        >
          Technical dashboard →
        </button>
      </div>
    </div>
  );
};

export default CommerciallistaDashboard;
