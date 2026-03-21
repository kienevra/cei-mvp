// frontend/src/pages/ManageClientOrg.tsx
import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import {
  getClientOrg,
  listClientOrgSites,
  createClientOrgSite,
  deleteClientOrgSite,
  listClientOrgTokens,
  createClientOrgToken,
  revokeClientOrgToken,
  listClientOrgUsers,
  inviteClientOrgUser,
  getClientOrgThresholds,
  updateClientOrgThresholds,
  updateClientOrgPricing,
  downloadClientReport,
  type ClientOrg,
  type Site,
  type IntegrationToken,
  type IntegrationTokenWithSecret,
  type ClientOrgUser,
  type AlertThresholds,
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

function toUiMsg(err: unknown, fallback: string): string {
  const e = err as any;
  return e?.response?.data?.message ?? e?.response?.data?.detail ?? e?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// Dark modal
// ---------------------------------------------------------------------------

function DarkModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.99)",
          border: "1px solid var(--cei-border-subtle)",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          minWidth: "360px",
          maxWidth: "480px",
          width: "100%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, fontSize: "1rem" }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", color: "var(--cei-text-muted)",
              cursor: "pointer", fontSize: "1.2rem", padding: "0 0.25rem",
            }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared input style
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--cei-border-subtle)",
  background: "rgba(148,163,184,0.07)",
  color: "var(--cei-text-main)",
  fontSize: "0.875rem",
  boxSizing: "border-box",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  padding: "0.45rem 1.1rem",
  borderRadius: "999px",
  border: "none",
  background: "var(--cei-green, #22c55e)",
  color: "#0f172a",
  fontWeight: 600,
  fontSize: "0.82rem",
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "0.45rem 1.1rem",
  borderRadius: "999px",
  border: "1px solid var(--cei-border-subtle)",
  background: "transparent",
  color: "var(--cei-text-muted)",
  fontSize: "0.82rem",
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "0.3rem 0.8rem",
  borderRadius: "999px",
  border: "1px solid rgba(239,68,68,0.4)",
  background: "transparent",
  color: "var(--cei-red, #ef4444)",
  fontSize: "0.78rem",
  cursor: "pointer",
};

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const TABS = ["Overview", "Sites", "Tokens", "Users", "Thresholds"] as const;
type Tab = typeof TABS[number];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--cei-border-subtle)", marginBottom: "1.25rem" }}>
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.85rem",
            background: "transparent",
            border: "none",
            borderBottom: active === tab ? "2px solid var(--cei-green, #22c55e)" : "2px solid transparent",
            color: active === tab ? "var(--cei-text-main)" : "var(--cei-text-muted)",
            cursor: "pointer",
            fontWeight: active === tab ? 600 : 400,
            marginBottom: "-1px",
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ org, onSaved }: { org: ClientOrg; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [sources, setSources] = useState(org.primary_energy_sources ?? "");
  const [elecPrice, setElecPrice] = useState(org.electricity_price_per_kwh?.toString() ?? "");
  const [gasPrice, setGasPrice] = useState(org.gas_price_per_kwh?.toString() ?? "");
  const [currency, setCurrency] = useState(org.currency_code ?? "EUR");

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateClientOrgPricing(org.id, {
        primary_energy_sources: sources.trim() || undefined,
        electricity_price_per_kwh: elecPrice ? parseFloat(elecPrice) : null,
        gas_price_per_kwh: gasPrice ? parseFloat(gasPrice) : null,
        currency_code: currency.trim().toUpperCase() || undefined,
      });
      setSuccess(true);
      onSaved();
      setTimeout(() => setSuccess(false), 2500);
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to save pricing."));
    } finally {
      setSaving(false);
    }
  };

  const row = (label: string, content: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
      <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>{label}</div>
      <div>{content}</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: "1rem" }}>Organization details</div>

      {row("Name", <span style={{ fontSize: "0.9rem" }}>{org.name}</span>)}
      {row("Plan", <span style={{ fontSize: "0.9rem" }}>{org.plan_key ?? "—"}</span>)}
      {row("Status", <span style={{ fontSize: "0.9rem" }}>{org.subscription_status ?? "—"}</span>)}
      {row("Created", <span style={{ fontSize: "0.9rem" }}>{fmtDt(org.created_at)}</span>)}

      <div style={{ borderTop: "1px solid var(--cei-border-subtle)", margin: "1.25rem 0" }} />
      <div style={{ fontWeight: 600, marginBottom: "1rem" }}>Energy pricing</div>

      {error && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</div>}
      {success && <div style={{ color: "var(--cei-green, #22c55e)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>Saved ✓</div>}

      {row("Energy sources",
        <input style={inputStyle} value={sources} onChange={(e) => setSources(e.target.value)}
          placeholder="electricity,gas" />
      )}
      {row("Electricity (€/kWh)",
        <input style={inputStyle} type="number" step="0.0001" min="0" value={elecPrice}
          onChange={(e) => setElecPrice(e.target.value)} placeholder="e.g. 0.23" />
      )}
      {row("Gas (€/kWh)",
        <input style={inputStyle} type="number" step="0.0001" min="0" value={gasPrice}
          onChange={(e) => setGasPrice(e.target.value)} placeholder="e.g. 0.08" />
      )}
      {row("Currency",
        <input style={{ ...inputStyle, maxWidth: "100px" }} value={currency}
          onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="EUR" />
      )}

      <div style={{ marginTop: "1rem" }}>
        <button style={btnPrimary} onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save pricing"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sites tab
// ---------------------------------------------------------------------------

function SitesTab({ orgId }: { orgId: number }) {
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
    setLoading(true);
    setError(null);
    try {
      const data = await listClientOrgSites(orgId);
      setSites(data);
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to load sites."));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await createClientOrgSite(orgId, { name: newName.trim(), location: newLocation.trim() || undefined });
      setNewName("");
      setNewLocation("");
      setShowAdd(false);
      load();
    } catch (e: unknown) {
      setAddError(toUiMsg(e, "Failed to create site."));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (site: Site) => {
    setDeletingId(site.id);
    try {
      await deleteClientOrgSite(orgId, site.id);
      setConfirmDelete(null);
      load();
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to delete site."));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 600 }}>Sites ({sites.length})</div>
        <button style={btnPrimary} onClick={() => setShowAdd(true)}>+ Add site</button>
      </div>

      {sites.length === 0 ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>No sites yet. Add one to start ingesting data.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr>
              {["Name", "Location", "Site ID", "Created", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--cei-text-muted)", borderBottom: "1px solid var(--cei-border-subtle)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((site, idx) => (
              <tr key={site.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(148,163,184,0.04)" }}>
                <td style={{ padding: "0.5rem 0.6rem", fontWeight: 500 }}>{site.name}</td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)" }}>{site.location ?? "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>
                  <code style={{ fontSize: "0.78rem", background: "rgba(148,163,184,0.1)", padding: "0.1rem 0.4rem", borderRadius: "0.25rem" }}>{site.site_id ?? `site-${site.id}`}</code>
                </td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(site.created_at)}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>
                  <button style={btnDanger} onClick={() => setConfirmDelete(site)} disabled={deletingId === site.id}>
                    {deletingId === site.id ? "Deleting…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add site modal */}
      <DarkModal open={showAdd} title="Add site" onClose={() => { setShowAdd(false); setAddError(null); setNewName(""); setNewLocation(""); }}>
        {addError && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{addError}</div>}
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Site name *</label>
          <input style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Plant A" autoFocus />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Location</label>
          <input style={inputStyle} value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="e.g. Milan, Italy" />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setShowAdd(false)}>Cancel</button>
          <button style={btnPrimary} onClick={handleAdd} disabled={adding || !newName.trim()}>
            {adding ? "Creating…" : "Create site"}
          </button>
        </div>
      </DarkModal>

      {/* Confirm delete modal */}
      <DarkModal open={!!confirmDelete} title="Delete site" onClose={() => setConfirmDelete(null)}>
        <p style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)", marginBottom: "1rem" }}>
          Are you sure you want to delete <strong style={{ color: "var(--cei-text-main)" }}>{confirmDelete?.name}</strong>?
          This will remove the site and all associated data. This action cannot be undone.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button style={{ ...btnDanger, padding: "0.45rem 1.1rem" }} onClick={() => confirmDelete && handleDelete(confirmDelete)} disabled={deletingId !== null}>
            {deletingId !== null ? "Deleting…" : "Delete"}
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
    try {
      const data = await listClientOrgTokens(orgId);
      setTokens(data);
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to load tokens."));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createClientOrgToken(orgId, newName.trim() || "Integration token");
      setNewToken(result);
      setShowCreate(false);
      setNewName("Integration token");
      load();
    } catch (e: unknown) {
      setCreateError(toUiMsg(e, "Failed to create token."));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (token: IntegrationToken) => {
    setRevokingId(token.id);
    try {
      await revokeClientOrgToken(orgId, token.id);
      setConfirmRevoke(null);
      load();
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to revoke token."));
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 600 }}>Integration tokens ({tokens.filter((t) => t.is_active).length} active)</div>
        <button style={btnPrimary} onClick={() => setShowCreate(true)}>+ Create token</button>
      </div>

      {/* New token banner — shown after creation */}
      {newToken && (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "0.5rem", padding: "0.9rem 1rem", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, color: "var(--cei-green, #22c55e)", marginBottom: "0.4rem" }}>Token created — copy it now, it won't be shown again</div>
          <code style={{ fontSize: "0.82rem", wordBreak: "break-all", display: "block", marginBottom: "0.6rem" }}>{newToken.token}</code>
          <button style={btnSecondary} onClick={() => { navigator.clipboard.writeText(newToken.token); }}>Copy to clipboard</button>
          <button style={{ ...btnSecondary, marginLeft: "0.5rem" }} onClick={() => setNewToken(null)}>Dismiss</button>
        </div>
      )}

      {tokens.length === 0 ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>No tokens yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr>
              {["Name", "Status", "Created", "Last used", ""].map((h) => (
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
                    {tok.is_active ? "Active" : "Revoked"}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(tok.created_at)}</td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(tok.last_used_at)}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>
                  {tok.is_active && (
                    <button style={btnDanger} onClick={() => setConfirmRevoke(tok)} disabled={revokingId === tok.id}>
                      {revokingId === tok.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create token modal */}
      <DarkModal open={showCreate} title="Create integration token" onClose={() => { setShowCreate(false); setCreateError(null); }}>
        {createError && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{createError}</div>}
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Token name</label>
          <input style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", marginBottom: "1rem" }}>
          The raw token will be shown once after creation. Store it securely — it cannot be retrieved again.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
          <button style={btnPrimary} onClick={handleCreate} disabled={creating}>
            {creating ? "Creating…" : "Create token"}
          </button>
        </div>
      </DarkModal>

      {/* Confirm revoke modal */}
      <DarkModal open={!!confirmRevoke} title="Revoke token" onClose={() => setConfirmRevoke(null)}>
        <p style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)", marginBottom: "1rem" }}>
          Revoke <strong style={{ color: "var(--cei-text-main)" }}>{confirmRevoke?.name}</strong>? Any system using this token will lose access immediately.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setConfirmRevoke(null)}>Cancel</button>
          <button style={{ ...btnDanger, padding: "0.45rem 1.1rem" }} onClick={() => confirmRevoke && handleRevoke(confirmRevoke)} disabled={revokingId !== null}>
            {revokingId !== null ? "Revoking…" : "Revoke"}
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
  const [users, setUsers] = useState<ClientOrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteExpiry, setInviteExpiry] = useState(7);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ token: string; email: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listClientOrgUsers(orgId);
      setUsers(data);
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to load users."));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const result = await inviteClientOrgUser(orgId, {
        email: inviteEmail.trim(),
        role: inviteRole,
        expires_in_days: inviteExpiry,
      });
      setInviteResult({ token: result.token, email: result.email });
      setShowInvite(false);
      setInviteEmail("");
      load();
    } catch (e: unknown) {
      setInviteError(toUiMsg(e, "Failed to send invite."));
    } finally {
      setInviting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 600 }}>Users ({users.length})</div>
        <button style={btnPrimary} onClick={() => setShowInvite(true)}>+ Invite user</button>
      </div>

      {/* Invite result banner */}
      {inviteResult && (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "0.5rem", padding: "0.9rem 1rem", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, color: "var(--cei-green, #22c55e)", marginBottom: "0.4rem" }}>
            Invite created for {inviteResult.email} — share this token with them
          </div>
          <code style={{ fontSize: "0.82rem", wordBreak: "break-all", display: "block", marginBottom: "0.6rem" }}>{inviteResult.token}</code>
          <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginBottom: "0.6rem" }}>
            They sign up via: <code>POST /api/v1/org/invites/accept-and-signup</code>
          </div>
          <button style={btnSecondary} onClick={() => { navigator.clipboard.writeText(inviteResult.token); }}>Copy token</button>
          <button style={{ ...btnSecondary, marginLeft: "0.5rem" }} onClick={() => setInviteResult(null)}>Dismiss</button>
        </div>
      )}

      {users.length === 0 ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>No users in this org yet. Invite someone to get started.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr>
              {["Email", "Role", "Status", "Created"].map((h) => (
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
                    {u.is_active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 0.6rem", color: "var(--cei-text-muted)", fontSize: "0.8rem" }}>{fmtDt(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Invite modal */}
      <DarkModal open={showInvite} title="Invite user" onClose={() => { setShowInvite(false); setInviteError(null); setInviteEmail(""); }}>
        {inviteError && <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{inviteError}</div>}
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Email *</label>
          <input style={inputStyle} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" autoFocus />
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Role</label>
          <select style={inputStyle} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.3rem" }}>Expires in (days)</label>
          <input style={{ ...inputStyle, maxWidth: "100px" }} type="number" min={1} max={30} value={inviteExpiry} onChange={(e) => setInviteExpiry(parseInt(e.target.value) || 7)} />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={() => setShowInvite(false)}>Cancel</button>
          <button style={btnPrimary} onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Inviting…" : "Send invite"}
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
        setFields({
          night_warning_ratio: String(data.night_warning_ratio),
          night_critical_ratio: String(data.night_critical_ratio),
          spike_warning_ratio: String(data.spike_warning_ratio),
          portfolio_share_info_ratio: String(data.portfolio_share_info_ratio),
          weekend_warning_ratio: String(data.weekend_warning_ratio),
          weekend_critical_ratio: String(data.weekend_critical_ratio),
          min_points: String(data.min_points),
          min_total_kwh: String(data.min_total_kwh),
        });
      })
      .catch((e: unknown) => setError(toUiMsg(e, "Failed to load thresholds.")))
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateClientOrgThresholds(orgId, {
        scope: "org",
        night_warning_ratio: parseFloat(fields.night_warning_ratio),
        night_critical_ratio: parseFloat(fields.night_critical_ratio),
        spike_warning_ratio: parseFloat(fields.spike_warning_ratio),
        portfolio_share_info_ratio: parseFloat(fields.portfolio_share_info_ratio),
        weekend_warning_ratio: parseFloat(fields.weekend_warning_ratio),
        weekend_critical_ratio: parseFloat(fields.weekend_critical_ratio),
        min_points: parseInt(fields.min_points),
        min_total_kwh: parseFloat(fields.min_total_kwh),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to save thresholds."));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: string, label: string, hint: string) => (
    <div style={{ marginBottom: "0.75rem", display: "grid", gridTemplateColumns: "220px 120px 1fr", gap: "0.5rem", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: "0.83rem" }}>{label}</div>
        <div style={{ fontSize: "0.73rem", color: "var(--cei-text-muted)" }}>{hint}</div>
      </div>
      <input
        style={{ ...inputStyle, maxWidth: "120px" }}
        type="number" step="0.01" min="0"
        value={fields[key] ?? ""}
        onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
      />
      {thresholds && <span style={{ fontSize: "0.73rem", color: "var(--cei-text-muted)" }}>default: {(thresholds as any)[key]}</span>}
    </div>
  );

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {success && <div style={{ color: "var(--cei-green, #22c55e)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>Saved ✓</div>}

      <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Alert thresholds</div>
      <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", marginBottom: "1.25rem" }}>
        {thresholds?.has_custom_thresholds
          ? "Custom thresholds are active for this org."
          : "Using system defaults. Edit and save to set custom thresholds."}
      </div>

      {field("night_warning_ratio", "Night warning ratio", "Fraction of daytime avg")}
      {field("night_critical_ratio", "Night critical ratio", "Fraction of daytime avg")}
      {field("spike_warning_ratio", "Spike warning ratio", "Multiple of recent avg")}
      {field("portfolio_share_info_ratio", "Portfolio share ratio", "Multiple of portfolio avg")}
      {field("weekend_warning_ratio", "Weekend warning ratio", "Fraction of weekday avg")}
      {field("weekend_critical_ratio", "Weekend critical ratio", "Fraction of weekday avg")}
      {field("min_points", "Min points", "Minimum data points required")}
      {field("min_total_kwh", "Min total kWh", "Minimum energy for alert to fire")}

      <div style={{ marginTop: "1rem" }}>
        <button style={btnPrimary} onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save thresholds"}
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
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [downloading, setDownloading] = useState(false);

  const loadOrg = useCallback(async () => {
    try {
      const data = await getClientOrg(orgId);
      setOrg(data);
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to load client organization."));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { loadOrg(); }, [loadOrg]);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      await downloadClientReport(orgId);
    } catch (e: unknown) {
      setError(toUiMsg(e, "Failed to download report."));
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
      <LoadingSpinner />
    </div>
  );

  if (error && !org) return (
    <div style={{ padding: "2rem" }}>
      <ErrorBanner message={error} onClose={() => navigate("/manage")} />
    </div>
  );

  return (
    <div style={{ maxWidth: "100vw", overflowX: "hidden" }}>
      {/* Back + header */}
      <section>
        <button
          onClick={() => navigate("/manage")}
          style={{ ...btnSecondary, marginBottom: "1rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
        >
          ← Portfolio
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
              {org?.name ?? t("manage.client.title", { defaultValue: "Client organization" })}
            </h1>
            <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
              Org ID {orgId} · {org?.subscription_status ?? "—"} · {org?.currency_code ?? "—"}
            </p>
          </div>

          <button style={btnSecondary} onClick={handleDownloadPdf} disabled={downloading}>
            {downloading ? "Downloading…" : "↓ Download PDF report"}
          </button>
        </div>
      </section>

      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <div className="cei-card">
          <TabBar active={activeTab} onChange={setActiveTab} />

          {activeTab === "Overview" && org && (
            <OverviewTab org={org} onSaved={loadOrg} />
          )}
          {activeTab === "Sites" && <SitesTab orgId={orgId} />}
          {activeTab === "Tokens" && <TokensTab orgId={orgId} />}
          {activeTab === "Users" && <UsersTab orgId={orgId} />}
          {activeTab === "Thresholds" && <ThresholdsTab orgId={orgId} />}
        </div>
      </section>
    </div>
  );
};

export default ManageClientOrg;
