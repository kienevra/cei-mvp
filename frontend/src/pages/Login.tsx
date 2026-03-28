// frontend/src/pages/Login.tsx
import React, { useEffect, useMemo, useState, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import ErrorBanner from "../components/ErrorBanner";
import api, { acceptInvite, upgradeToManaging } from "../services/api";
import LanguageToggle from "../components/LanguageToggle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthMode = "login" | "signup";
type RegType = "manager" | "organization" | "invitee_org" | "invitee_consultant" | null;

const INVITE_PARAM_KEYS = ["invite", "invite_token", "token"];

function pickInviteToken(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const k of INVITE_PARAM_KEYS) {
    const v = params.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Support code helpers
// ---------------------------------------------------------------------------

function getRequestIdFromError(err: any): string | null {
  if (!err) return null;
  const stamped = typeof err?.cei_request_id === "string" ? err.cei_request_id : null;
  if (stamped && stamped.trim()) return stamped.trim();
  const headers: any = err?.response?.headers || {};
  const fromHeader =
    (typeof headers["x-request-id"] === "string" && headers["x-request-id"]) ||
    (typeof headers["X-Request-ID"] === "string" && headers["X-Request-ID"]) ||
    (typeof headers["x-requestid"] === "string" && headers["x-requestid"]) ||
    null;
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
  const data: any = err?.response?.data;
  const fromBody =
    typeof data?.request_id === "string" ? data.request_id :
    typeof data?.requestId === "string" ? data.requestId : null;
  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();
  return null;
}

function appendSupportCode(msg: string, rid: string | null): string {
  if (!msg) msg = "Authentication failed. Please try again.";
  if (!rid) return msg;
  if (msg.toLowerCase().includes("support code:")) return msg;
  return `${msg} (Support code: ${rid})`;
}

// ---------------------------------------------------------------------------
// Registration type cards data
// ---------------------------------------------------------------------------

const REG_OPTIONS: { type: Exclude<RegType, null>; icon: string; titleKey: string; descKey: string; titleDefault: string; descDefault: string }[] = [
  {
    type: "manager",
    icon: "🏢",
    titleKey: "signup.types.manager.title",
    descKey: "signup.types.manager.description",
    titleDefault: "Energy manager / consultant",
    descDefault: "I manage energy for multiple client organizations (ESCO, energy auditor, consultant).",
  },
  {
    type: "organization",
    icon: "🏭",
    titleKey: "signup.types.organization.title",
    descKey: "signup.types.organization.description",
    titleDefault: "Organization",
    descDefault: "I represent a factory, facility, or company and want to monitor my own energy.",
  },
  {
    type: "invitee_org",
    icon: "✉️",
    titleKey: "signup.types.inviteeOrg.title",
    descKey: "signup.types.inviteeOrg.description",
    titleDefault: "Invited to an organization",
    descDefault: "I received an invite link from my organization to join their energy platform.",
  },
  {
    type: "invitee_consultant",
    icon: "🤝",
    titleKey: "signup.types.inviteeConsultant.title",
    descKey: "signup.types.inviteeConsultant.description",
    titleDefault: "Invited to a consultant firm",
    descDefault: "I received an invite link from an energy consultant or ESCO to join their team.",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Login: React.FC = () => {
  const { t } = useTranslation();
  const { login, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const inviteToken = useMemo(() => pickInviteToken(location.search), [location.search]);

  // ── Auth mode ──
  const [mode, setMode] = useState<AuthMode>("login");

  // ── Signup step ──
  // step 1 = choose reg type cards
  // step 2 = fill form for chosen type
  const [regType, setRegType] = useState<RegType>(null);

  // ── Form fields ──
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [inviteTokenInput, setInviteTokenInput] = useState("");

  // ── UI state ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  // Notice + invite auto-detection
  useEffect(() => {
    if (inviteToken) {
      setMode("signup");
      setRegType("invitee_org");
      setInviteTokenInput(inviteToken);
      setOrganizationName("");
      setNotice(t("auth.invite.notice", { defaultValue: "You're joining an organization via invite. Create your account to continue." }));
      return;
    }
    const params = new URLSearchParams(location.search);
    const reason = params.get("reason");
    if (reason === "session_expired") {
      setNotice(t("auth.sessionExpired", { defaultValue: "Your session expired. Please sign in again." }));
      return;
    }
    const stateReason = (location.state as any)?.reason && String((location.state as any).reason);
    if (stateReason === "auth_required") {
      setNotice(t("auth.authRequired", { defaultValue: "Please sign in to continue." }));
      return;
    }
    setNotice(null);
  }, [inviteToken, location.search, location.state, t]);

  // ── Error helpers ──
  function toErrorString(err: any): string {
    const rid = getRequestIdFromError(err);
    const backendDetail = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.response?.data;
    if (typeof backendDetail === "string") return appendSupportCode(backendDetail, rid);
    if (backendDetail && typeof backendDetail === "object") {
      if (typeof (backendDetail as any).code === "string" || typeof (backendDetail as any).message === "string") {
        const code = (backendDetail as any).code ? String((backendDetail as any).code) : "";
        const msg = (backendDetail as any).message ? String((backendDetail as any).message) : "";
        const base = code && msg ? `${code}: ${msg}` : msg || code || t("auth.errors.generic", { defaultValue: "Authentication failed. Please try again." });
        return appendSupportCode(base, rid);
      }
      const msg = ((backendDetail as any).message && String((backendDetail as any).message)) || ((backendDetail as any).detail && String((backendDetail as any).detail));
      if (msg) return appendSupportCode(msg, rid);
      try { return appendSupportCode(JSON.stringify(backendDetail), rid); } catch { /* fall */ }
    }
    return appendSupportCode(err?.message || t("auth.errors.generic", { defaultValue: "Authentication failed. Please try again." }), rid);
  }

  // ── Mode toggle ──
  const handleModeToggle = (nextMode: AuthMode) => {
    if (inviteToken && nextMode === "login") return;
    if (nextMode === mode) return;
    setMode(nextMode);
    setRegType(null);
    setError(null);
    if (!inviteToken) setNotice(null);
    setPassword("");
    setPasswordConfirm("");
    setOrganizationName("");
    if (nextMode === "login") setFullName("");
  };

  // ── Back from form to cards ──
  const handleBackToCards = () => {
    if (inviteToken) return; // can't go back if invite forces a type
    setRegType(null);
    setError(null);
    setPassword("");
    setPasswordConfirm("");
    setOrganizationName("");
  };

  // ── Submit ──
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "login") {
        await login({ username: email, password });
        return;
      }

      // ── Signup ──
      if (!email || !password) throw new Error(t("auth.errors.emailPasswordRequired", { defaultValue: "Email and password are required." }));
      if (password.length < 6) throw new Error(t("auth.errors.passwordMinLength", { defaultValue: "Password must be at least 6 characters." }));
      if (password !== passwordConfirm) throw new Error(t("auth.errors.passwordsNoMatch", { defaultValue: "Passwords do not match." }));

      if (regType === "manager" || regType === "organization") {
        // Self-serve signup
        await api.post("/auth/signup", {
          email,
          password,
          full_name: fullName.trim() || undefined,
          organization_name: organizationName.trim() || undefined,
        });
        // Login to get token
        await login({ username: email, password });
        // Upgrade to managing if ESCO
        if (regType === "manager") {
          try { await upgradeToManaging(null); } catch { /* non-fatal, user can upgrade later */ }
          window.location.href = "/manage";
          return;
        }
        // Standard org lands on dashboard — login() will redirect
        return;
      }

      if (regType === "invitee_org" || regType === "invitee_consultant") {
        const token = (inviteToken || inviteTokenInput).trim();
        if (!token) throw new Error("Please enter your invite token.");

        let res: { access_token: string; token_type: string };
        try {
          res = await acceptInvite({ token, email, password, full_name: fullName.trim() || undefined });
        } catch (err: any) {
          if (err?.response?.status === 404) {
            throw new Error(t("auth.errors.inviteJoinNotLive", { defaultValue: "Invite join isn't live on this backend yet." }));
          }
          throw err;
        }
        const accessToken = (res as any)?.access_token;
        if (!accessToken) throw new Error(t("auth.errors.inviteMissingAccessToken", { defaultValue: "Invite signup succeeded but response missing access_token." }));
        localStorage.setItem("cei_token", accessToken);
        window.location.href = "/";
        return;
      }

    } catch (err: any) {
      setError(toErrorString(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isSignup = mode === "signup";
  const isInvitee = regType === "invitee_org" || regType === "invitee_consultant";
  const isSelfSignup = regType === "manager" || regType === "organization";

  // ── Styles ──
  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--cei-border-subtle, rgba(148,163,184,0.2))",
    borderRadius: "0.75rem",
    padding: "0.85rem 1rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "flex-start",
    gap: "0.85rem",
    background: "transparent",
    width: "100%",
    textAlign: "left",
    transition: "border-color 0.15s, background 0.15s",
    marginBottom: "0.6rem",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    marginTop: "0.25rem",
  };

  return (
    <div className="auth-page">
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: "1rem", right: "1rem", zIndex: 5 }}>
          <LanguageToggle variant="pill" />
        </div>

        <div className="auth-card">
          {/* Brand / header */}
          <div style={{ marginBottom: "0.05rem", display: "flex", flexDirection: "column", gap: "0.05rem", alignItems: "center", textAlign: "center" }}>
            <img
              src={encodeURI("/ChatGPT Image Dec 5, 2025, 10_47_03 PM.png")}
              alt={t("brand.full", { defaultValue: "CEI – Carbon Efficiency Intelligence" })}
              style={{ height: "320px", width: "auto", display: "block", marginBottom: "0.05rem" }}
            />
            <div className="auth-title">
              {t("auth.hero.title", { defaultValue: "We use A.I to reduce your factory's energy costs." })}
            </div>
            <div className="auth-subtitle">
              {t("auth.hero.subtitle", { defaultValue: "CEI ingests your meter and SCADA data, builds statistical baselines for each site, and turns night, weekend, and process inefficiencies into actionable alerts and reports – without installing new hardware." })}
            </div>
          </div>

          {/* Invite badge */}
          {inviteToken && (
            <div style={{ marginBottom: "0.75rem", fontSize: "0.8rem", padding: "0.5rem 0.7rem", borderRadius: "0.6rem", border: "1px solid rgba(56, 189, 248, 0.4)", background: "rgba(15, 23, 42, 0.8)", color: "var(--cei-text-muted)" }}>
              <strong style={{ color: "var(--cei-text)" }}>{t("auth.invite.badgeTitle", { defaultValue: "Invite detected." })}</strong>{" "}
              {t("auth.invite.badgeBody", { defaultValue: "You'll join an existing organization after account creation." })}
            </div>
          )}

          {/* Mode toggle tabs */}
          <div style={{ display: "flex", marginBottom: "0.9rem", borderRadius: "999px", background: "rgba(15, 23, 42, 0.7)", padding: "0.15rem", opacity: inviteToken ? 0.9 : 1 }}>
            <button
              type="button"
              onClick={() => handleModeToggle("login")}
              className="cei-btn"
              disabled={!!inviteToken}
              style={{ flex: 1, borderRadius: "999px", fontSize: "0.85rem", padding: "0.4rem 0.75rem", border: "none", background: mode === "login" ? "linear-gradient(135deg, #22d3ee, #0ea5e9)" : "transparent", color: mode === "login" ? "#0f172a" : "var(--cei-text-muted)", fontWeight: mode === "login" ? 600 : 400, cursor: inviteToken ? "not-allowed" : "pointer" }}
              title={inviteToken ? t("auth.invite.requiresSignup", { defaultValue: "Invite flow requires account creation." }) : undefined}
            >
              {t("auth.actions.signIn", { defaultValue: "Sign in" })}
            </button>
            <button
              type="button"
              onClick={() => handleModeToggle("signup")}
              className="cei-btn"
              style={{ flex: 1, borderRadius: "999px", fontSize: "0.85rem", padding: "0.4rem 0.75rem", border: "none", background: mode === "signup" ? "linear-gradient(135deg, #22d3ee, #0ea5e9)" : "transparent", color: mode === "signup" ? "#0f172a" : "var(--cei-text-muted)", fontWeight: mode === "signup" ? 600 : 400, cursor: "pointer" }}
            >
              {t("auth.actions.createAccount", { defaultValue: "Create account" })}
            </button>
          </div>

          {/* Notice */}
          {notice && (
            <div style={{ marginBottom: "0.75rem", fontSize: "0.8rem", padding: "0.5rem 0.7rem", borderRadius: "0.6rem", border: "1px solid rgba(56, 189, 248, 0.4)", background: "rgba(15, 23, 42, 0.8)", color: "var(--cei-text-muted)" }}>
              {notice}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ marginBottom: "0.75rem" }}>
              <ErrorBanner message={error} onClose={() => setError(null)} />
            </div>
          )}

          {/* ── LOGIN FORM ── */}
          {mode === "login" && (
            <form className="auth-form" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email">{t("auth.fields.email.label", { defaultValue: "Work email" })}</label>
                <input id="email" type="email" autoComplete="username" placeholder={t("auth.fields.email.placeholder", { defaultValue: "you@factory.com" })} value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
              </div>
              <div>
                <label htmlFor="password">{t("auth.fields.password.label", { defaultValue: "Password" })}</label>
                <input id="password" type="password" autoComplete="current-password" placeholder={t("auth.fields.password.placeholder", { defaultValue: "••••••••" })} value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
              </div>
              <button type="submit" className="cei-btn cei-btn-primary" disabled={submitting} style={{ width: "100%", marginTop: "0.4rem", opacity: submitting ? 0.85 : 1 }}>
                {submitting ? t("auth.actions.signingInProgress", { defaultValue: "Signing you in…" }) : t("auth.actions.signIn", { defaultValue: "Sign in" })}
              </button>
              <a href="/forgot-password" style={{ display: "block", marginTop: "0.75rem", fontSize: "0.9rem", color: "var(--cei-text-muted)", textAlign: "center" }}>
                {t("auth.passwordReset.forgot.link", { defaultValue: "Forgot password?" })}
              </a>
            </form>
          )}

          {/* ── SIGNUP: STEP 1 — choose reg type ── */}
          {isSignup && !regType && (
            <div>
              <p style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)", marginBottom: "1rem", textAlign: "center" }}>
                {t("signup.chooseType.subtitle", { defaultValue: "How will you be using CEI?" })}
              </p>
              {REG_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  style={cardStyle}
                  onClick={() => setRegType(opt.type)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--cei-green, #22c55e)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(34,197,94,0.07)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--cei-border-subtle, rgba(148,163,184,0.2))"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  <span style={{ fontSize: "1.4rem", lineHeight: 1, flexShrink: 0, marginTop: "2px" }}>{opt.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.2rem", color: "#e5e7eb" }}>
                      {t(opt.titleKey, { defaultValue: opt.titleDefault })}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", lineHeight: 1.4 }}>
                      {t(opt.descKey, { defaultValue: opt.descDefault })}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ── SIGNUP: STEP 2 — self-signup form (manager or organization) ── */}
          {isSignup && isSelfSignup && (
            <form className="auth-form" onSubmit={handleSubmit}>
              {!inviteToken && (
                <button type="button" onClick={handleBackToCards} style={{ background: "none", border: "none", color: "var(--cei-text-muted)", cursor: "pointer", fontSize: "0.82rem", padding: "0 0 0.75rem 0", display: "block" }}>
                  ← {t("signup.chooseType.subtitle", { defaultValue: "Back" })}
                </button>
              )}

              <p style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginBottom: "0.75rem" }}>
                {regType === "manager"
                  ? t("signup.selfSignup.managerSubtitle", { defaultValue: "Your account will be set up as an energy management firm. You can add client organizations from the Manage dashboard." })
                  : t("signup.selfSignup.orgSubtitle", { defaultValue: "Your account will be set up as a standalone organization with full access to sites, alerts, and reports." })}
              </p>

              <div>
                <label htmlFor="organizationName">
                  {regType === "manager"
                    ? t("signup.selfSignup.firmNameLabel", { defaultValue: "Firm / company name *" })
                    : t("signup.selfSignup.orgNameLabel", { defaultValue: "Organization name *" })}
                </label>
                <input
                  id="organizationName"
                  type="text"
                  autoComplete="organization"
                  placeholder={regType === "manager"
                    ? t("signup.selfSignup.firmNamePlaceholder", { defaultValue: "e.g. GreenEnergy Consulting Srl" })
                    : t("signup.selfSignup.orgNamePlaceholder", { defaultValue: "e.g. Ceramica Rossi Srl" })}
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  required
                  style={inputStyle}
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="fullName">{t("signup.selfSignup.fullNameLabel", { defaultValue: "Your full name" })}</label>
                <input id="fullName" type="text" autoComplete="name" placeholder={t("signup.selfSignup.fullNamePlaceholder", { defaultValue: "e.g. Mario Rossi" })} value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} />
              </div>

              <div>
                <label htmlFor="email">{t("signup.selfSignup.emailLabel", { defaultValue: "Email address *" })}</label>
                <input id="email" type="email" autoComplete="email" placeholder={t("signup.selfSignup.emailPlaceholder", { defaultValue: "you@example.com" })} value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
              </div>

              <div>
                <label htmlFor="password">{t("signup.selfSignup.passwordLabel", { defaultValue: "Password * (min. 6 characters)" })}</label>
                <input id="password" type="password" autoComplete="new-password" placeholder={t("signup.selfSignup.passwordPlaceholder", { defaultValue: "Choose a strong password" })} value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
              </div>

              <div>
                <label htmlFor="passwordConfirm">{t("auth.fields.passwordConfirm.label", { defaultValue: "Confirm password" })}</label>
                <input id="passwordConfirm" type="password" autoComplete="new-password" placeholder={t("auth.fields.passwordConfirm.placeholder", { defaultValue: "••••••••" })} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required style={inputStyle} />
              </div>

              <button type="submit" className="cei-btn cei-btn-primary" disabled={submitting} style={{ width: "100%", marginTop: "0.4rem", opacity: submitting ? 0.85 : 1 }}>
                {submitting
                  ? (regType === "manager" ? t("signup.selfSignup.creatingManagerBtn", { defaultValue: "Creating consultant account…" }) : t("signup.selfSignup.creatingOrgBtn", { defaultValue: "Creating account…" }))
                  : (regType === "manager" ? t("signup.selfSignup.createManagerBtn", { defaultValue: "Create consultant account" }) : t("signup.selfSignup.createOrgBtn", { defaultValue: "Create account" }))}
              </button>
            </form>
          )}

          {/* ── SIGNUP: STEP 2 — invitee form ── */}
          {isSignup && isInvitee && (
            <form className="auth-form" onSubmit={handleSubmit}>
              {!inviteToken && (
                <button type="button" onClick={handleBackToCards} style={{ background: "none", border: "none", color: "var(--cei-text-muted)", cursor: "pointer", fontSize: "0.82rem", padding: "0 0 0.75rem 0", display: "block" }}>
                  ← Back
                </button>
              )}

              <p style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", marginBottom: "0.75rem" }}>
                {regType === "invitee_consultant"
                  ? t("signup.invitee.consultantSubtitle", { defaultValue: "Paste the invite token sent by your energy management firm. You'll be added as a team member." })
                  : t("signup.invitee.orgSubtitle", { defaultValue: "Paste the invite token sent by your organization. You'll be added with the role assigned by your admin." })}
              </p>

              {!inviteToken && (
                <div>
                  <label htmlFor="inviteTokenInput">{t("signup.invitee.tokenLabel", { defaultValue: "Invite token *" })}</label>
                  <input id="inviteTokenInput" type="text" placeholder={t("signup.invitee.tokenPlaceholder", { defaultValue: "cei_inv_…" })} value={inviteTokenInput} onChange={(e) => setInviteTokenInput(e.target.value)} required style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.82rem" }} autoFocus />
                </div>
              )}

              {inviteToken && (
                <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)", marginBottom: "0.5rem" }}>
                  {t("signup.invitee.tokenAutoFilled", { defaultValue: "Token auto-filled from your invite link." })}
                </div>
              )}

              <div>
                <label htmlFor="email">{t("signup.invitee.emailLabel", { defaultValue: "Email address * (must match the invite)" })}</label>
                <input id="email" type="email" autoComplete="email" placeholder={t("signup.invitee.emailPlaceholder", { defaultValue: "you@example.com" })} value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
              </div>

              <div>
                <label htmlFor="fullName">{t("signup.invitee.fullNameLabel", { defaultValue: "Your full name" })}</label>
                <input id="fullName" type="text" autoComplete="name" placeholder={t("signup.invitee.fullNamePlaceholder", { defaultValue: "e.g. Mario Rossi" })} value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} />
              </div>

              <div>
                <label htmlFor="password">{t("signup.invitee.passwordLabel", { defaultValue: "Password * (min. 6 characters)" })}</label>
                <input id="password" type="password" autoComplete="new-password" placeholder={t("signup.invitee.passwordPlaceholder", { defaultValue: "Choose a strong password" })} value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
              </div>

              <div>
                <label htmlFor="passwordConfirm">{t("auth.fields.passwordConfirm.label", { defaultValue: "Confirm password" })}</label>
                <input id="passwordConfirm" type="password" autoComplete="new-password" placeholder={t("auth.fields.passwordConfirm.placeholder", { defaultValue: "••••••••" })} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required style={inputStyle} />
              </div>

              <button type="submit" className="cei-btn cei-btn-primary" disabled={submitting} style={{ width: "100%", marginTop: "0.4rem", opacity: submitting ? 0.85 : 1 }}>
                {submitting
                  ? t("signup.invitee.joiningBtn", { defaultValue: "Joining…" })
                  : (regType === "invitee_consultant"
                    ? t("signup.invitee.joinFirmBtn", { defaultValue: "Join firm" })
                    : t("signup.invitee.joinOrgBtn", { defaultValue: "Join organization" }))}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};

export default Login;
