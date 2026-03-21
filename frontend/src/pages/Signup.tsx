// frontend/src/pages/Signup.tsx
import React, { useMemo, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { signup, acceptInvite, upgradeToManaging } from "../services/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try { return JSON.stringify(val); } catch { return String(val); }
}

function toUiMessage(err: unknown, fallback: string): string {
  const e = err as any;
  const data = e?.response?.data;
  if (data?.detail != null) return typeof data.detail === "string" ? data.detail : safeStringify(data.detail) || fallback;
  if (data?.message != null) return typeof data.message === "string" ? data.message : safeStringify(data.message) || fallback;
  if (e?.message) return String(e.message);
  return fallback;
}

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

// ---------------------------------------------------------------------------
// Registration type
// ---------------------------------------------------------------------------

type RegType = "manager" | "organization" | "invitee_org" | "invitee_consultant" | null;

const REG_OPTIONS: { type: RegType; title: string; description: string; icon: string }[] = [
  {
    type: "manager",
    icon: "🏢",
    title: "Energy manager / consultant",
    description: "I manage energy for multiple client organizations (ESCO, energy auditor, consultant).",
  },
  {
    type: "organization",
    icon: "🏭",
    title: "Organization",
    description: "I represent a factory, facility, or company and want to monitor my own energy.",
  },
  {
    type: "invitee_org",
    icon: "✉️",
    title: "Invited to an organization",
    description: "I received an invite link from my organization to join their energy platform.",
  },
  {
    type: "invitee_consultant",
    icon: "🤝",
    title: "Invited to a consultant firm",
    description: "I received an invite link from an energy consultant or ESCO to join their team.",
  },
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cardBase: React.CSSProperties = {
  border: "1px solid var(--cei-border-subtle)",
  borderRadius: "0.75rem",
  padding: "1rem 1.1rem",
  cursor: "pointer",
  display: "flex",
  alignItems: "flex-start",
  gap: "0.9rem",
  transition: "border-color 0.15s, background 0.15s",
  background: "transparent",
  width: "100%",
  textAlign: "left",
};

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

// ---------------------------------------------------------------------------
// Step 1 — choose registration type
// ---------------------------------------------------------------------------

function ChooseTypeStep({
  selected,
  onSelect,
  onContinue,
}: {
  selected: RegType;
  onSelect: (t: RegType) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Create your account</h1>
        <p style={{ marginTop: "0.35rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
          How will you be using CEI?
        </p>
      </div>

      <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1.25rem" }}>
        {REG_OPTIONS.map((opt) => {
          const active = selected === opt.type;
          return (
            <button
              key={opt.type}
              style={{
                ...cardBase,
                borderColor: active ? "var(--cei-green, #22c55e)" : "var(--cei-border-subtle)",
                background: active ? "rgba(34,197,94,0.07)" : "transparent",
              }}
              onClick={() => onSelect(opt.type)}
            >
              <span style={{ fontSize: "1.4rem", lineHeight: 1, flexShrink: 0, marginTop: "2px" }}>
                {opt.icon}
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.2rem" }}>
                  {opt.title}
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.4 }}>
                  {opt.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button
        className="cei-btn"
        onClick={onContinue}
        disabled={!selected}
        style={{ width: "100%" }}
      >
        Continue →
      </button>

      <div style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--cei-text-muted)", textAlign: "center" }}>
        Already have an account? <Link to="/login">Log in</Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — fill in details (manager or organization self-signup)
// ---------------------------------------------------------------------------

function SelfSignupStep({
  regType,
  onBack,
  onSuccess,
}: {
  regType: "manager" | "organization";
  onBack: () => void;
  onSuccess: (token: string, isManager: boolean) => void;
}) {
  const isManager = regType === "manager";

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    email.trim().length > 0 &&
    password.trim().length >= 6 &&
    orgName.trim().length >= 2 &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // 1. Create account + org
      const resp = await signup({
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim() || undefined,
        organization_name: orgName.trim(),
      });

      const token: string = resp?.access_token;
      if (!token) throw new Error("Signup response missing access_token.");

      // Store token so the upgrade call is authenticated
      localStorage.setItem("cei_token", token);

      // 2. If energy manager, upgrade org to managing type
      if (isManager) {
        await upgradeToManaging(null);
      }

      onSuccess(token, isManager);
    } catch (err: unknown) {
      setError(toUiMessage(err, "Signup failed. Please try again."));
      localStorage.removeItem("cei_token");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", color: "var(--cei-text-muted)", cursor: "pointer", fontSize: "0.82rem", padding: 0, marginBottom: "0.75rem" }}
        >
          ← Back
        </button>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
          {isManager ? "Set up your consultant account" : "Set up your organization"}
        </h1>
        <p style={{ marginTop: "0.35rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
          {isManager
            ? "Your account will be set up as an energy management firm. You can add client organizations from the Manage dashboard."
            : "Your account will be set up as a standalone organization with full access to sites, alerts, and reports."}
        </p>
      </div>

      {error && (
        <div className="cei-pill-danger" style={{ marginBottom: "0.75rem" }}>{error}</div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.6rem" }}>
        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            {isManager ? "Firm / company name *" : "Organization name *"}
          </label>
          <input
            style={inputStyle}
            type="text"
            placeholder={isManager ? "e.g. GreenEnergy Consulting Srl" : "e.g. Ceramica Rossi Srl"}
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            disabled={submitting}
            autoFocus
          />
        </div>

        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Your full name
          </label>
          <input
            style={inputStyle}
            type="text"
            placeholder="e.g. Mario Rossi"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={submitting}
            autoComplete="name"
          />
        </div>

        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Email address *
          </label>
          <input
            style={inputStyle}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
            autoComplete="email"
          />
        </div>

        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Password * (min. 6 characters)
          </label>
          <input
            style={inputStyle}
            type="password"
            placeholder="Choose a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>

        <button
          className="cei-btn"
          type="submit"
          disabled={!canSubmit}
          style={{ marginTop: "0.25rem" }}
        >
          {submitting
            ? isManager ? "Creating consultant account…" : "Creating account…"
            : isManager ? "Create consultant account" : "Create account"}
        </button>
      </form>

      <div style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--cei-text-muted)", textAlign: "center" }}>
        Already have an account? <Link to="/login">Log in</Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — invitee signup (org or consultant firm)
// ---------------------------------------------------------------------------

function InviteeSignupStep({
  regType,
  prefillToken,
  onBack,
  onSuccess,
}: {
  regType: "invitee_org" | "invitee_consultant";
  prefillToken: string;
  onBack: () => void;
  onSuccess: (token: string) => void;
}) {
  const isConsultant = regType === "invitee_consultant";

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState(prefillToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    inviteToken.trim().length > 0 &&
    email.trim().length > 0 &&
    password.trim().length >= 6 &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const tokenNorm = inviteToken.trim();
    if (!tokenNorm.startsWith("cei_inv_")) {
      setError("Invalid invite token. It should start with 'cei_inv_'. Check the link you received.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const resp = await acceptInvite({
        token: tokenNorm,
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim() || undefined,
      });

      const token: string = resp?.access_token;
      if (!token) throw new Error("Response missing access_token.");
      localStorage.setItem("cei_token", token);
      onSuccess(token);
    } catch (err: unknown) {
      setError(toUiMessage(err, "Failed to accept invite. Please check your details and try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", color: "var(--cei-text-muted)", cursor: "pointer", fontSize: "0.82rem", padding: 0, marginBottom: "0.75rem" }}
        >
          ← Back
        </button>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
          {isConsultant ? "Join your consultant firm" : "Join your organization"}
        </h1>
        <p style={{ marginTop: "0.35rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
          {isConsultant
            ? "Paste the invite token sent by your energy management firm. You'll be added as a team member."
            : "Paste the invite token sent by your organization. You'll be added with the role assigned by your admin."}
        </p>
      </div>

      {error && (
        <div className="cei-pill-danger" style={{ marginBottom: "0.75rem" }}>{error}</div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.6rem" }}>
        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Invite token *
          </label>
          <input
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.8rem" }}
            type="text"
            placeholder="cei_inv_…"
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
            required
            disabled={submitting}
            autoFocus={!prefillToken}
          />
          {prefillToken && (
            <div style={{ fontSize: "0.73rem", color: "var(--cei-text-muted)", marginTop: "0.25rem" }}>
              Token auto-filled from your invite link.
            </div>
          )}
        </div>

        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Email address * (must match the invite)
          </label>
          <input
            style={inputStyle}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
            autoComplete="email"
          />
        </div>

        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Your full name
          </label>
          <input
            style={inputStyle}
            type="text"
            placeholder="e.g. Mario Rossi"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={submitting}
            autoComplete="name"
          />
        </div>

        <div>
          <label style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)", display: "block", marginBottom: "0.25rem" }}>
            Password * (min. 6 characters)
          </label>
          <input
            style={inputStyle}
            type="password"
            placeholder="Choose a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>

        <button
          className="cei-btn"
          type="submit"
          disabled={!canSubmit}
          style={{ marginTop: "0.25rem" }}
        >
          {submitting ? "Joining…" : isConsultant ? "Join firm" : "Join organization"}
        </button>
      </form>

      <div style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--cei-text-muted)", textAlign: "center" }}>
        Already have an account? <Link to="/login">Log in</Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Signup page — orchestrates steps
// ---------------------------------------------------------------------------

const Signup: React.FC = () => {
  const navigate = useNavigate();
  const query = useQuery();
  const { t } = useTranslation();

  // Auto-detect invite token from URL (?invite=cei_inv_...)
  const urlToken = (query.get("invite") || "").trim();

  // If a valid token is in the URL, pre-select invitee_org and skip to step 2
  const initialType: RegType = urlToken.startsWith("cei_inv_") ? "invitee_org" : null;
  const initialStep = urlToken.startsWith("cei_inv_") ? 2 : 1;

  const [step, setStep] = useState<1 | 2>(initialStep as 1 | 2);
  const [regType, setRegType] = useState<RegType>(initialType);

  const handleContinue = () => {
    if (regType) setStep(2);
  };

  const handleBack = () => {
    setStep(1);
  };

  const handleSelfSignupSuccess = (token: string, isManager: boolean) => {
    localStorage.setItem("cei_token", token);
    // Navigate to manage dashboard for ESCOs, main dashboard for orgs
    navigate(isManager ? "/manage" : "/", { replace: true });
    // Trigger a page reload so useAuth re-fetches /auth/me with the new token
    window.location.href = isManager ? "/manage" : "/";
  };

  const handleInviteeSuccess = (token: string) => {
    localStorage.setItem("cei_token", token);
    navigate("/", { replace: true });
    window.location.href = "/";
  };

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: "420px" }}>
        {step === 1 && (
          <ChooseTypeStep
            selected={regType}
            onSelect={setRegType}
            onContinue={handleContinue}
          />
        )}

        {step === 2 && (regType === "manager" || regType === "organization") && (
          <SelfSignupStep
            regType={regType}
            onBack={handleBack}
            onSuccess={handleSelfSignupSuccess}
          />
        )}

        {step === 2 && (regType === "invitee_org" || regType === "invitee_consultant") && (
          <InviteeSignupStep
            regType={regType}
            prefillToken={urlToken}
            onBack={handleBack}
            onSuccess={handleInviteeSuccess}
          />
        )}
      </div>
    </div>
  );
};

export default Signup;
