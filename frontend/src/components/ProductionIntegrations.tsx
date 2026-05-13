// frontend/src/components/ProductionIntegrations.tsx
import React, { useEffect, useState } from "react";
import api from "../services/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type IntegrationType = "webhook" | "sap_b1" | "teamsystem";

interface Integration {
  id:                number;
  site_id:           number;
  integration_type:  IntegrationType;
  label:             string | null;
  webhook_url:       string | null;
  is_active:         boolean;
  last_sync_at:      string | null;
  last_sync_status:  string | null;
  last_sync_message: string | null;
  created_at:        string;
}

interface Props {
  siteId: number;
}

// ── Config forms ──────────────────────────────────────────────────────────────

const INTEGRATION_LABELS: Record<IntegrationType, string> = {
  webhook:    "Generic Webhook",
  sap_b1:     "SAP Business One",
  teamsystem: "Teamsystem Alyante",
};

const INTEGRATION_DESCRIPTIONS: Record<IntegrationType, string> = {
  webhook:
    "CEI generates a unique URL. Your ERP/MES POSTs daily production to it — works with any system.",
  sap_b1:
    "CEI pulls daily production from SAP B1 Service Layer REST API. Requires a read-only API user.",
  teamsystem:
    "CEI pulls from Teamsystem Alyante Enterprise v4 REST API via OAuth2 client credentials.",
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const color =
    status === "ok"      ? "#22c55e" :
    status === "error"   ? "#f87171" :
    status === "pending" ? "#fb923c" : "#9ca3af";
  const bg =
    status === "ok"      ? "rgba(34,197,94,0.12)" :
    status === "error"   ? "rgba(248,113,113,0.12)" :
    status === "pending" ? "rgba(251,146,60,0.12)" : "rgba(148,163,184,0.08)";
  return (
    <span style={{
      fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.5rem",
      borderRadius: 999, background: bg, color,
      border: `1px solid ${color}30`,
    }}>
      {status.toUpperCase()}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const ProductionIntegrations: React.FC<Props> = ({ siteId }) => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [creating,     setCreating]     = useState<IntegrationType | null>(null);
  const [syncing,      setSyncing]      = useState<number | null>(null);
  const [copied,       setCopied]       = useState(false);

  // SAP B1 form state
  const [sapUrl,       setSapUrl]       = useState("");
  const [sapCompany,   setSapCompany]   = useState("");
  const [sapUser,      setSapUser]      = useState("");
  const [sapPassword,  setSapPassword]  = useState("");
  const [sapItemCode,  setSapItemCode]  = useState("");
  const [sapUnitLabel, setSapUnitLabel] = useState("pezzi");

  // Teamsystem form state
  const [tsUrl,        setTsUrl]        = useState("");
  const [tsClientId,   setTsClientId]   = useState("");
  const [tsSecret,     setTsSecret]     = useState("");
  const [tsCompany,    setTsCompany]    = useState("01");
  const [tsUnitLabel,  setTsUnitLabel]  = useState("pezzi");

  const [saving,       setSaving]       = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Integration[]>(
        `/production-integrations/sites/${siteId}`
      );
      setIntegrations(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to load integrations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [siteId]);

  const existingTypes = new Set(integrations.map(i => i.integration_type));

  // ── Create ──────────────────────────────────────────────────────────────────

  const handleCreate = async (type: IntegrationType) => {
    setSaving(true);
    setError(null);
    try {
      let config: Record<string, string> | undefined;

      if (type === "sap_b1") {
        config = {
          server_url:  sapUrl,
          company_db:  sapCompany,
          username:    sapUser,
          password:    sapPassword,
          unit_label:  sapUnitLabel,
          ...(sapItemCode ? { item_code: sapItemCode } : {}),
          verify_ssl: "false",
        };
      } else if (type === "teamsystem") {
        config = {
          tenant_url:    tsUrl,
          client_id:     tsClientId,
          client_secret: tsSecret,
          company_code:  tsCompany,
          unit_label:    tsUnitLabel,
        };
      }

      await api.post(`/production-integrations/sites/${siteId}`, {
        integration_type: type,
        label: INTEGRATION_LABELS[type],
        config,
      });
      setCreating(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to create integration.");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (id: number) => {
    if (!window.confirm("Remove this integration?")) return;
    try {
      await api.delete(`/production-integrations/${id}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to delete integration.");
    }
  };

  // ── Manual sync ─────────────────────────────────────────────────────────────

  const handleSync = async (id: number) => {
    setSyncing(id);
    setError(null);
    try {
      await api.post(`/production-integrations/${id}/sync?days_back=30`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Sync failed.");
    } finally {
      setSyncing(null);
    }
  };

  // ── Copy webhook URL ─────────────────────────────────────────────────────────

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  // ── Render form ──────────────────────────────────────────────────────────────

  const renderCreateForm = (type: IntegrationType) => {
    const inputStyle: React.CSSProperties = {
      width: "100%", padding: "0.4rem 0.6rem",
      borderRadius: "0.375rem",
      border: "1px solid rgba(156,163,175,0.4)",
      background: "rgba(15,23,42,0.8)",
      color: "var(--cei-text)", fontSize: "0.85rem",
      marginTop: "0.2rem",
    };

    const labelStyle: React.CSSProperties = {
      display: "block", fontSize: "0.75rem",
      fontWeight: 500, color: "#9ca3af",
    };

    if (type === "webhook") {
      return (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "0.75rem" }}>
            CEI will generate a unique webhook URL. Configure your ERP/MES to POST
            daily production data to it in this format:
          </p>
          <pre style={{
            background: "rgba(15,23,42,0.8)", border: "1px solid rgba(148,163,184,0.15)",
            borderRadius: 6, padding: "0.75rem", fontSize: "0.78rem",
            color: "#38bdf8", marginBottom: "1rem", overflow: "auto",
          }}>{`POST https://api.carbonefficiencyintel.com/api/v1/production/webhook/{token}
Content-Type: application/json

{
  "date": "2026-05-11",
  "units_produced": 4800,
  "unit_label": "pezzi"
}`}</pre>
          <button
            type="button" className="cei-btn"
            onClick={() => handleCreate(type)}
            disabled={saving}
            style={{ opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Creating…" : "Generate webhook URL →"}
          </button>
        </div>
      );
    }

    if (type === "sap_b1") {
      return (
        <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>Service Layer URL *</label>
            <input style={inputStyle} placeholder="https://192.168.1.100:50000"
              value={sapUrl} onChange={e => setSapUrl(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Company DB *</label>
            <input style={inputStyle} placeholder="MYCOMPANY"
              value={sapCompany} onChange={e => setSapCompany(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>API Username *</label>
            <input style={inputStyle} placeholder="CEI_USER"
              value={sapUser} onChange={e => setSapUser(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Password *</label>
            <input style={inputStyle} type="password" placeholder="••••••••"
              value={sapPassword} onChange={e => setSapPassword(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Item Code filter (optional)</label>
            <input style={inputStyle} placeholder="CERAMICTILE"
              value={sapItemCode} onChange={e => setSapItemCode(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Unit label</label>
            <input style={inputStyle} placeholder="pezzi"
              value={sapUnitLabel} onChange={e => setSapUnitLabel(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1/-1", marginTop: "0.25rem" }}>
            <button type="button" className="cei-btn"
              onClick={() => handleCreate(type)}
              disabled={saving || !sapUrl || !sapCompany || !sapUser || !sapPassword}
              style={{ opacity: saving || !sapUrl || !sapCompany ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save SAP B1 integration →"}
            </button>
          </div>
        </div>
      );
    }

    if (type === "teamsystem") {
      return (
        <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>Tenant URL *</label>
            <input style={inputStyle} placeholder="https://mycompany.alyante.cloud"
              value={tsUrl} onChange={e => setTsUrl(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Client ID *</label>
            <input style={inputStyle} placeholder="abc123"
              value={tsClientId} onChange={e => setTsClientId(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Client Secret *</label>
            <input style={inputStyle} type="password" placeholder="••••••••"
              value={tsSecret} onChange={e => setTsSecret(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Company Code</label>
            <input style={inputStyle} placeholder="01"
              value={tsCompany} onChange={e => setTsCompany(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Unit label</label>
            <input style={inputStyle} placeholder="pezzi"
              value={tsUnitLabel} onChange={e => setTsUnitLabel(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1/-1", marginTop: "0.25rem" }}>
            <button type="button" className="cei-btn"
              onClick={() => handleCreate(type)}
              disabled={saving || !tsUrl || !tsClientId || !tsSecret}
              style={{ opacity: saving || !tsUrl || !tsClientId ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save Teamsystem integration →"}
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{
        fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem",
        display: "flex", alignItems: "center", gap: "0.5rem",
      }}>
        <span>Production data sources</span>
        <span style={{
          fontSize: "0.7rem", padding: "0.15rem 0.5rem", borderRadius: 999,
          background: "rgba(56,189,248,0.1)", color: "#38bdf8",
          border: "1px solid rgba(56,189,248,0.2)",
        }}>
          {integrations.length} active
        </span>
      </div>

      <p style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "0.75rem" }}>
        Connect your ERP or MES to automatically push daily production quantities.
        CEI uses this to compute kWh/unit — the ISO 50001 energy intensity metric.
      </p>

      {error && (
        <div style={{ marginBottom: "0.6rem", fontSize: "0.78rem", color: "#f87171" }}>
          ⚠ {error}
        </div>
      )}

      {/* Existing integrations */}
      {loading ? (
        <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {integrations.map(intg => (
            <div key={intg.id} style={{
              background: "radial-gradient(circle at top left, #0f172a, #020617)",
              border: "1px solid rgba(148,163,184,0.16)",
              borderRadius: "0.75rem", padding: "1rem 1.25rem",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#e5e7eb", marginBottom: "0.2rem" }}>
                    {intg.label || INTEGRATION_LABELS[intg.integration_type]}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                      {intg.integration_type}
                    </span>
                    <StatusBadge status={intg.last_sync_status} />
                    {intg.last_sync_at && (
                      <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
                        Last sync: {new Date(intg.last_sync_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {intg.last_sync_message && (
                    <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                      {intg.last_sync_message}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  {intg.integration_type !== "webhook" && (
                    <button
                      type="button" className="cei-btn"
                      onClick={() => handleSync(intg.id)}
                      disabled={syncing === intg.id}
                      style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem",
                        opacity: syncing === intg.id ? 0.7 : 1 }}
                    >
                      {syncing === intg.id ? "Syncing…" : "Sync now"}
                    </button>
                  )}
                  <button
                    type="button" className="cei-btn"
                    onClick={() => handleDelete(intg.id)}
                    style={{
                      fontSize: "0.78rem", padding: "0.3rem 0.75rem",
                      background: "transparent",
                      border: "1px solid rgba(248,113,113,0.3)",
                      color: "#f87171",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Webhook URL display */}
              {intg.integration_type === "webhook" && intg.webhook_url && (
                <div style={{
                  marginTop: "0.75rem", padding: "0.6rem 0.75rem",
                  background: "rgba(15,23,42,0.8)",
                  border: "1px solid rgba(148,163,184,0.15)",
                  borderRadius: 6,
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
                }}>
                  <code style={{ fontSize: "0.75rem", color: "#38bdf8",
                    wordBreak: "break-all", flex: 1 }}>
                    {intg.webhook_url}
                  </code>
                  <button type="button" className="cei-btn"
                    onClick={() => handleCopy(intg.webhook_url!)}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem",
                      whiteSpace: "nowrap" }}
                  >
                    {copied ? "Copied ✓" : "Copy URL"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new integration */}
      {(["webhook", "sap_b1", "teamsystem"] as IntegrationType[]).map(type => {
        if (existingTypes.has(type)) return null;
        const isOpen = creating === type;
        return (
          <div key={type} style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              onClick={() => setCreating(isOpen ? null : type)}
              style={{
                width: "100%", padding: "0.75rem 1rem",
                background: "radial-gradient(circle at top left, #0f172a, #020617)",
                border: "1px dashed rgba(148,163,184,0.25)",
                borderRadius: "0.75rem", cursor: "pointer",
                display: "flex", justifyContent: "space-between",
                alignItems: "center", color: "#9ca3af",
                fontSize: "0.85rem",
              }}
            >
              <span>
                <span style={{ color: "#38bdf8", marginRight: "0.5rem" }}>+</span>
                {INTEGRATION_LABELS[type]}
              </span>
              <span style={{ fontSize: "0.75rem" }}>
                {INTEGRATION_DESCRIPTIONS[type].slice(0, 60)}…
              </span>
            </button>

            {isOpen && (
              <div style={{
                background: "radial-gradient(circle at top left, #0f172a, #020617)",
                border: "1px solid rgba(148,163,184,0.16)",
                borderTop: "none", borderRadius: "0 0 0.75rem 0.75rem",
                padding: "1rem 1.25rem",
              }}>
                <p style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                  {INTEGRATION_DESCRIPTIONS[type]}
                </p>
                {renderCreateForm(type)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ProductionIntegrations;
