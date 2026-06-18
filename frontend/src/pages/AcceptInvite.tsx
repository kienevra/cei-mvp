// frontend/src/pages/AcceptInvite.tsx
import React, { useEffect, useState, FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import LanguageToggle from "../components/LanguageToggle";
import LoadingSpinner from "../components/LoadingSpinner";

type InviteInfo = {
  status: string;
  factory_name: string | null;
  factory_email: string | null;
  partner_name: string;
  expires_at: string | null;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.55rem 0.75rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--cei-border-subtle)",
  background: "rgba(148,163,184,0.07)",
  color: "var(--cei-text-main)",
  fontSize: "0.875rem",
  boxSizing: "border-box",
  outline: "none",
  marginTop: "0.25rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "var(--cei-text-muted)",
};

const AcceptInvite: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load invite info
  useEffect(() => {
    if (!token) { setError("Invalid invite link."); setLoading(false); return; }
    api.get(`/auth/invite-info/${token}`)
      .then(res => {
        const data = res.data as InviteInfo;
        if (data.status !== "active") {
          setError(
            data.status === "used"    ? "This invite link has already been used." :
            data.status === "expired" ? "This invite link has expired. Ask your consultant for a new one." :
            data.status === "revoked" ? "This invite link has been revoked." :
            "This invite link is no longer valid."
          );
        } else {
          setInfo(data);
          if (data.factory_name) setOrgName(data.factory_name);
          if (data.factory_email) setEmail(data.factory_email);
        }
      })
      .catch(() => setError("Invite link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!orgName.trim()) { setSubmitError("Company name is required."); return; }
    if (!email.trim()) { setSubmitError("Email is required."); return; }
    if (password.length < 8) { setSubmitError("Password must be at least 8 characters."); return; }
    if (password !== passwordConfirm) { setSubmitError("Passwords do not match."); return; }

    setSubmitting(true);
    try {
      const res = await api.post(`/auth/accept-invite/${token}`, {
        org_name: orgName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      const accessToken = res.data?.access_token;
      if (!accessToken) throw new Error("Signup succeeded but no access token returned.");
      localStorage.setItem("cei_token", accessToken);
      window.location.href = "/";
    } catch (err: any) {
      const msg = err?.response?.data?.detail?.message
        ?? err?.response?.data?.message
        ?? err?.message
        ?? "Signup failed. Please try again.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cei-bg-main, #0f172a)" }}>
      <LoadingSpinner />
    </div>
  );

  return (
    <div className="auth-page">
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: "1rem", right: "1rem", zIndex: 5 }}>
          <LanguageToggle variant="pill" />
        </div>

        <div className="auth-card" style={{ maxWidth: "460px" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--cei-accent,#38bdf8)", marginBottom: "0.4rem" }}>
              Partner Invitation
            </div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
              Join CEI
            </h1>
            {info && (
              <p style={{ fontSize: "0.88rem", color: "var(--cei-text-muted)", margin: 0 }}>
                <strong style={{ color: "var(--cei-text-main)" }}>{info.partner_name}</strong> has invited you to connect your factory to their compliance platform.
              </p>
            )}
          </div>

          {/* Error state */}
          {error && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.5rem", padding: "1rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⚠️</div>
              <div style={{ color: "var(--cei-red,#ef4444)", fontWeight: 600, marginBottom: "0.5rem" }}>{error}</div>
              <button onClick={() => navigate("/login")} style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--cei-accent,#38bdf8)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                Go to login
              </button>
            </div>
          )}

          {/* Signup form */}
          {info && !error && (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {submitError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.4rem", padding: "0.65rem 0.85rem", color: "var(--cei-red,#ef4444)", fontSize: "0.84rem" }}>
                  {submitError}
                </div>
              )}

              <div>
                <label style={labelStyle}>Company / Factory Name</label>
                <input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="e.g. Ceramica Bianchi Srl" style={inputStyle} required />
              </div>

              <div>
                <label style={labelStyle}>Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourfactory.it" style={inputStyle} required />
              </div>

              <div>
                <label style={labelStyle}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" style={inputStyle} required />
              </div>

              <div>
                <label style={labelStyle}>Confirm Password</label>
                <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder="Repeat password" style={inputStyle} required />
              </div>

              {/* What happens next */}
              <div style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: "0.5rem", padding: "0.75rem 1rem", fontSize: "0.82rem", color: "var(--cei-text-muted)" }}>
                By creating an account, your factory will be connected to <strong style={{ color: "var(--cei-text-main)" }}>{info.partner_name}</strong>'s CEI workspace. They will be able to view your energy compliance data and generate reports on your behalf.
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{ padding: "0.65rem 1.25rem", borderRadius: "999px", border: "none", background: submitting ? "rgba(56,189,248,0.4)" : "var(--cei-accent,#38bdf8)", color: "#0f172a", fontWeight: 700, fontSize: "0.9rem", cursor: submitting ? "not-allowed" : "pointer", marginTop: "0.25rem" }}
              >
                {submitting ? "Creating account..." : "Create Account & Connect"}
              </button>

              <div style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                Already have an account?{" "}
                <button type="button" onClick={() => navigate("/login")} style={{ background: "transparent", border: "none", color: "var(--cei-accent,#38bdf8)", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline" }}>
                  Sign in
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default AcceptInvite;
