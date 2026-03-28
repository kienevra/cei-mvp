// frontend/src/components/ConnectConsultant.tsx
// Drop this component into Account.tsx for standalone org owners.
// Shows: send a link request to a consultant + view incoming/outgoing requests.
import { useAuth } from "../hooks/useAuth";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  orgSendLinkRequest,
  listOrgLinkRequests,
  orgAcceptLinkRequest,
  orgRejectLinkRequest,
  orgCancelLinkRequest,
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

const ConnectConsultant: React.FC<{ onLinked?: () => void }> = ({ onLinked }) => {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();

  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Send form state
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
      const data = await listOrgLinkRequests();
      setRequests(data);
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
      await orgSendLinkRequest(email.trim(), message.trim() || undefined);
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
    try { await orgAcceptLinkRequest(id); await refreshUser(); onLinked?.(); load(); }
    catch (e: unknown) { setError(toMsg(e, "Failed to accept request.")); }
    finally { setActingId(null); }
  };

  const handleReject = async (id: number) => {
    setActingId(id);
    try { await orgRejectLinkRequest(id); load(); }
    catch (e: unknown) { setError(toMsg(e, "Failed to reject request.")); }
    finally { setActingId(null); }
  };

  const handleCancel = async (id: number) => {
    setActingId(id);
    try { await orgCancelLinkRequest(id); load(); }
    catch (e: unknown) { setError(toMsg(e, "Failed to cancel request.")); }
    finally { setActingId(null); }
  };

  const pending   = requests.filter(r => r.status === "pending");
  const historical = requests.filter(r => r.status !== "pending");

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.25rem" }}>
        Connect an energy consultant
      </div>
      <div style={{ fontSize: "0.82rem", color: "var(--cei-text-muted)", marginBottom: "1.25rem" }}>
        Invite an ESCO or certified energy manager to manage your CEI profile. Once linked, they can manage your sites, tokens, alerts and reports. Your account becomes read-only.
      </div>

      {/* Send request form */}
      <div style={{ background: "rgba(148,163,184,0.05)", border: "1px solid var(--cei-border-subtle)", borderRadius: "0.6rem", padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          Request a consultant to manage your organization
        </div>

        {sendError && (
          <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.6rem" }}>{sendError}</div>
        )}
        {sendSuccess && (
          <div style={{ color: "var(--cei-green, #22c55e)", fontSize: "0.82rem", marginBottom: "0.6rem" }}>
            Request sent — the consultant will be notified.
          </div>
        )}

        <div style={{ marginBottom: "0.6rem" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Consultant firm owner email *
          </label>
          <input
            style={inputStyle}
            type="email"
            placeholder="consultant@escofirm.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div style={{ fontSize: "0.72rem", color: "var(--cei-text-muted)", marginTop: "0.25rem" }}>
            The consultant must already have a CEI account registered as an energy manager.
          </div>
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Message (optional)
          </label>
          <input
            style={inputStyle}
            type="text"
            placeholder="e.g. We spoke at the FIRE conference last week"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <button style={btnPrimary} onClick={handleSend} disabled={sending || !email.trim()}>
          {sending ? "Sending…" : "Send request"}
        </button>
      </div>

      {/* Pending requests */}
      {error && (
        <div style={{ color: "var(--cei-red, #ef4444)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>Loading…</div>
      ) : (
        <>
          {pending.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.6rem" }}>
                Pending requests
              </div>
              {pending.map(req => (
                <div key={req.id} style={{ border: "1px solid var(--cei-border-subtle)", borderRadius: "0.5rem", padding: "0.75rem 1rem", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: "0.88rem" }}>{req.managing_org_name}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginTop: "0.2rem" }}>
                      {req.initiated_by === "consultant" ? "They sent you this request" : "You sent this request"} · {fmtDt(req.created_at)}
                    </div>
                    {req.message && (
                      <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginTop: "0.25rem", fontStyle: "italic" }}>
                        "{req.message}"
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0, alignItems: "center" }}>
                    {req.initiated_by === "consultant" ? (
                      <>
                        <button style={btnPrimary} onClick={() => handleAccept(req.id)} disabled={actingId === req.id}>
                          {actingId === req.id ? "…" : "Accept"}
                        </button>
                        <button style={btnDanger} onClick={() => handleReject(req.id)} disabled={actingId === req.id}>
                          Reject
                        </button>
                      </>
                    ) : (
                      <button style={btnSecondary} onClick={() => handleCancel(req.id)} disabled={actingId === req.id}>
                        {actingId === req.id ? "…" : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {historical.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.6rem", color: "var(--cei-text-muted)" }}>
                Past requests
              </div>
              {historical.map(req => (
                <div key={req.id} style={{ border: "1px solid var(--cei-border-subtle)", borderRadius: "0.5rem", padding: "0.65rem 1rem", marginBottom: "0.4rem", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: 0.7 }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{req.managing_org_name}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginLeft: "0.5rem" }}>{fmtDt(req.created_at)}</span>
                  </div>
                  {statusBadge(req.status)}
                </div>
              ))}
            </div>
          )}

          {requests.length === 0 && (
            <div style={{ color: "var(--cei-text-muted)", fontSize: "0.85rem" }}>
              No link requests yet. Enter a consultant's email above to get started.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ConnectConsultant;
