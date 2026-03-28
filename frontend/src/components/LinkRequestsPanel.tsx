// frontend/src/components/LinkRequestsPanel.tsx
// Add this to ManageDashboard.tsx — shows consultant's sent + incoming link requests.

import React, { useCallback, useEffect, useState } from "react";
import {
  consultantSendLinkRequest,
  listConsultantLinkRequests,
  consultantAcceptLinkRequest,
  consultantRejectLinkRequest,
  consultantCancelLinkRequest,
  type LinkRequest,
} from "../services/manageApi";

function fmtDt(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function toMsg(err: unknown, fallback: string): string {
  const e = err as any;
  return e?.response?.data?.detail ?? e?.response?.data?.message ?? e?.message ?? fallback;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--cei-border-subtle)",
  background: "rgba(148,163,184,0.07)",
  color: "var(--cei-text-main)",
  fontSize: "0.875rem",
  boxSizing: "border-box",
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

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    pending:   "var(--cei-amber, #f59e0b)",
    accepted:  "var(--cei-green, #22c55e)",
    rejected:  "var(--cei-red, #ef4444)",
    cancelled: "var(--cei-text-muted)",
  };
  return (
    <span style={{ color: colors[status] ?? "var(--cei-text-muted)", fontSize: "0.78rem", fontWeight: 600, textTransform: "capitalize" }}>
      {status}
    </span>
  );
}

const LinkRequestsPanel: React.FC = () => {
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Send form
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  const [actingId, setActingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequests(await listConsultantLinkRequests());
    } catch (e: unknown) {
      setError(toMsg(e, "Failed to load link requests."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSend = async () => {
    if (!email.trim()) return;
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      await consultantSendLinkRequest(email.trim(), message.trim() || undefined);
      setEmail("");
      setMessage("");
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 3000);
      load();
    } catch (e: unknown) {
      setSendError(toMsg(e, "Failed to send link request."));
    } finally {
      setSending(false);
    }
  };

  const handleAccept = async (id: number) => {
    setActingId(id);
    try { await consultantAcceptLinkRequest(id); load(); }
    catch (e: unknown) { setError(toMsg(e, "Failed to accept.")); }
    finally { setActingId(null); }
  };

  const handleReject = async (id: number) => {
    setActingId(id);
    try { await consultantRejectLinkRequest(id); load(); }
    catch (e: unknown) { setError(toMsg(e, "Failed to reject.")); }
    finally { setActingId(null); }
  };

  const handleCancel = async (id: number) => {
    setActingId(id);
    try { await consultantCancelLinkRequest(id); load(); }
    catch (e: unknown) { setError(toMsg(e, "Failed to cancel.")); }
    finally { setActingId(null); }
  };

  const incoming = requests.filter(r => r.initiated_by === "org_owner" && r.status === "pending");
  const sent     = requests.filter(r => r.initiated_by === "consultant" && r.status === "pending");
  const history  = requests.filter(r => r.status !== "pending");

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.25rem" }}>
        Link an existing organization
      </div>
      <div style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)", marginBottom: "1.25rem" }}>
        Invite a standalone organization to transfer their CEI profile to your management. They must accept before you gain access. Alternatively, an org owner can send you a request directly from their account.
      </div>

      {/* Incoming requests from org owners */}
      {incoming.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.6rem", color: "var(--cei-amber, #f59e0b)" }}>
            ● {incoming.length} incoming request{incoming.length !== 1 ? "s" : ""} from organization owners
          </div>
          {incoming.map(req => (
            <div key={req.id} style={{ border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.05)", borderRadius: "0.5rem", padding: "0.75rem 1rem", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{req.client_org_name}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginTop: "0.2rem" }}>
                  Requested to join your portfolio · {fmtDt(req.created_at)}
                </div>
                {req.message && (
                  <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginTop: "0.25rem", fontStyle: "italic" }}>
                    "{req.message}"
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button style={btnPrimary} onClick={() => handleAccept(req.id)} disabled={actingId === req.id}>
                  {actingId === req.id ? "…" : "Accept"}
                </button>
                <button style={btnDanger} onClick={() => handleReject(req.id)} disabled={actingId === req.id}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Send new request */}
      <div style={{ background: "rgba(148,163,184,0.05)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.6rem", padding: "1rem", marginBottom: "1.25rem" }}>
        <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          Send a link request to an existing organization
        </div>

        {sendError && (
          <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.6rem" }}>{sendError}</div>
        )}
        {sendSuccess && (
          <div style={{ color: "var(--cei-green, #22c55e)", fontSize: "0.82rem", marginBottom: "0.6rem" }}>
            Request sent — the org owner will see it in their account.
          </div>
        )}

        <div style={{ marginBottom: "0.6rem" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Organization owner email *
          </label>
          <input
            style={inputStyle}
            type="email"
            placeholder="owner@manufacturing-company.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)", marginTop: "0.25rem" }}>
            The organization must already have a CEI account.
          </div>
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Message (optional)
          </label>
          <input
            style={inputStyle}
            type="text"
            placeholder="e.g. Following up from our meeting last Tuesday"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <button style={btnPrimary} onClick={handleSend} disabled={sending || !email.trim()}>
          {sending ? "Sending…" : "Send request"}
        </button>
      </div>

      {/* Sent / pending */}
      {error && (
        <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>Loading…</div>
      ) : (
        <>
          {sent.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.6rem" }}>Awaiting response</div>
              {sent.map(req => (
                <div key={req.id} style={{ border: "1px solid var(--cei-border-subtle)", borderRadius: "0.5rem", padding: "0.65rem 1rem", marginBottom: "0.4rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{req.client_org_name}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>
                      Sent {fmtDt(req.created_at)}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {statusBadge(req.status)}
                    <button style={btnSecondary} onClick={() => handleCancel(req.id)} disabled={actingId === req.id}>
                      {actingId === req.id ? "…" : "Cancel"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)" }}>
                Past requests
              </div>
              {history.map(req => (
                <div key={req.id} style={{ border: "1px solid var(--cei-border-subtle)", borderRadius: "0.5rem", padding: "0.65rem 1rem", marginBottom: "0.4rem", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: 0.65 }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{req.client_org_name}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>{fmtDt(req.created_at)}</span>
                  </div>
                  {statusBadge(req.status)}
                </div>
              ))}
            </div>
          )}

          {requests.length === 0 && incoming.length === 0 && (
            <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>
              No link requests yet.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LinkRequestsPanel;
