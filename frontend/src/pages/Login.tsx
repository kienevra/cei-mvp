// frontend/src/pages/Login.tsx
import React, { useEffect, useMemo, useState, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import ErrorBanner from "../components/ErrorBanner";
import api from "../services/api";
import { Link } from "react-router-dom";


type AuthMode = "login" | "signup";

const INVITE_PARAM_KEYS = ["invite", "invite_token", "token"];

function pickInviteToken(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const k of INVITE_PARAM_KEYS) {
    const v = params.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

<Link to="/signup" style={{ fontSize: "0.8rem" }}>
  Have an invite? Join an existing organization
</Link>


const Login: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const inviteToken = useMemo(
    () => pickInviteToken(location.search),
    [location.search]
  );

  const [mode, setMode] = useState<AuthMode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // If already authenticated, go straight to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Handle ?reason=session_expired etc.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const reason = params.get("reason");
    if (reason === "session_expired") {
      setNotice("Your session expired. Please sign in again.");
    } else {
      setNotice(null);
    }
  }, [location.search]);

  // If user lands with an invite token, default to signup and hide org-name creation.
  useEffect(() => {
    if (inviteToken) {
      setMode("signup");
      setOrganizationName(""); // invite flow joins an existing org
      setNotice("You’re joining an organization via invite. Create your account to continue.");
    }
    // NOTE: do not include `mode` here; we intentionally force signup when invite exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  function toErrorString(err: any): string {
    const backendDetail =
      err?.response?.data?.detail ??
      err?.response?.data?.message ??
      err?.response?.data;

    if (typeof backendDetail === "string") return backendDetail;

    if (backendDetail && typeof backendDetail === "object") {
      const msg =
        (backendDetail.message && String(backendDetail.message)) ||
        (backendDetail.detail && String(backendDetail.detail));
      if (msg) return msg;
      try {
        return JSON.stringify(backendDetail);
      } catch {
        return "Authentication failed. Please try again.";
      }
    }

    return err?.message || "Authentication failed. Please try again.";
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "login") {
        // ---------- LOGIN FLOW ----------
        await login({ username: email, password });
      } else {
        // ---------- SIGNUP FLOW ----------
        if (!email || !password) {
          throw new Error("Email and password are required.");
        }

        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }

        if (password !== passwordConfirm) {
          throw new Error("Passwords do not match.");
        }

        if (inviteToken) {
          // ---------- INVITE JOIN FLOW ----------
          // This assumes backend implements:
          //   POST /api/v1/auth/invites/accept  { token, email, password }
          //
          // If the endpoint isn't deployed yet, we fail with a clear error.
          try {
            await api.post("/auth/invites/accept", {
              token: inviteToken,
              email,
              password,
            });
          } catch (err: any) {
            const status = err?.response?.status;
            if (status === 404) {
              throw new Error(
                "Invite join isn’t live on this backend yet (missing /auth/invites/accept). Deploy the invite endpoints, then retry."
              );
            }
            throw err;
          }

          // Login normally to wire Auth context (token storage, redirects)
          await login({ username: email, password });
        } else {
          // ---------- SELF-SERVE ORG CREATION FLOW ----------
          await api.post("/auth/signup", {
            email,
            password,
            organization_name: organizationName.trim() || undefined,
          });

          // Login normally to wire Auth context (token storage, redirects)
          await login({ username: email, password });
        }
      }
    } catch (err: any) {
      setError(toErrorString(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = (nextMode: AuthMode) => {
    // When an invite is present, we don't let the user switch to "login"
    // because they likely don't have an account yet.
    if (inviteToken && nextMode === "login") return;

    if (nextMode === mode) return;
    setMode(nextMode);
    setError(null);

    // Preserve invite notice if invite exists; otherwise clear.
    if (!inviteToken) setNotice(null);

    setPassword("");
    setPasswordConfirm("");
    setOrganizationName("");
  };

  const isSignup = mode === "signup";

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Brand / header */}
        <div
          style={{
            marginBottom: "0.05rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.05rem",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <img
            src={encodeURI("/ChatGPT Image Dec 5, 2025, 10_47_03 PM.png")}
            alt="CEI – Carbon Efficiency Intelligence"
            style={{
              height: "320px",
              width: "auto",
              display: "block",
              marginBottom: "0.05rem",
            }}
          />

          <div className="auth-title">We use A.I to cut manufacturing energy waste.</div>

          <div className="auth-subtitle">
            CEI ingests your meter and SCADA data, builds statistical baselines
            for each site, and turns night, weekend, and process inefficiencies
            into actionable alerts and reports – without installing new hardware.
          </div>
        </div>

        {/* Invite badge */}
        {inviteToken && (
          <div
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.8rem",
              padding: "0.5rem 0.7rem",
              borderRadius: "0.6rem",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              background: "rgba(15, 23, 42, 0.8)",
              color: "var(--cei-text-muted)",
            }}
          >
            <strong style={{ color: "var(--cei-text)" }}>Invite detected.</strong>{" "}
            You’ll join an existing organization after account creation.
          </div>
        )}

        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            marginBottom: "0.9rem",
            borderRadius: "999px",
            background: "rgba(15, 23, 42, 0.7)",
            padding: "0.15rem",
            opacity: inviteToken ? 0.9 : 1,
          }}
        >
          <button
            type="button"
            onClick={() => toggleMode("login")}
            className="cei-btn"
            disabled={!!inviteToken}
            style={{
              flex: 1,
              borderRadius: "999px",
              fontSize: "0.85rem",
              padding: "0.4rem 0.75rem",
              border: "none",
              background:
                mode === "login"
                  ? "linear-gradient(135deg, #22d3ee, #0ea5e9)"
                  : "transparent",
              color: mode === "login" ? "#0f172a" : "var(--cei-text-muted)",
              fontWeight: mode === "login" ? 600 : 400,
              cursor: inviteToken ? "not-allowed" : "pointer",
            }}
            title={inviteToken ? "Invite flow requires account creation." : undefined}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => toggleMode("signup")}
            className="cei-btn"
            style={{
              flex: 1,
              borderRadius: "999px",
              fontSize: "0.85rem",
              padding: "0.4rem 0.75rem",
              border: "none",
              background:
                mode === "signup"
                  ? "linear-gradient(135deg, #22d3ee, #0ea5e9)"
                  : "transparent",
              color: mode === "signup" ? "#0f172a" : "var(--cei-text-muted)",
              fontWeight: mode === "signup" ? 600 : 400,
              cursor: "pointer",
            }}
          >
            Create account
          </button>
        </div>

        {/* Session / invite notice */}
        {notice && (
          <div
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.8rem",
              padding: "0.5rem 0.7rem",
              borderRadius: "0.6rem",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              background: "rgba(15, 23, 42, 0.8)",
              color: "var(--cei-text-muted)",
            }}
          >
            {notice}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{ marginBottom: "0.75rem" }}>
            <ErrorBanner message={error} onClose={() => setError(null)} />
          </div>
        )}

        {/* Auth form */}
        <form className="auth-form" onSubmit={handleSubmit}>
          {isSignup && !inviteToken && (
            <div>
              <label htmlFor="organizationName">Organization name</label>
              <input
                id="organizationName"
                type="text"
                autoComplete="organization"
                placeholder="e.g. Dev Manufacturing"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
              />
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--cei-text-muted)",
                  marginTop: "0.25rem",
                }}
              >
                This creates your org. Use an invite link to join an existing org.
              </div>
            </div>
          )}

          <div>
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@factory.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="password">{isSignup ? "Create a password" : "Password"}</label>
            <input
              id="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {isSignup && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--cei-text-muted)",
                  marginTop: "0.25rem",
                }}
              >
                Minimum 8 characters. Use a strong password.
              </div>
            )}
          </div>

          {isSignup && (
            <div>
              <label htmlFor="passwordConfirm">Confirm password</label>
              <input
                id="passwordConfirm"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="cei-btn cei-btn-primary"
            disabled={submitting}
            style={{
              width: "100%",
              marginTop: "0.4rem",
              opacity: submitting ? 0.85 : 1,
            }}
          >
            {submitting
              ? isSignup
                ? inviteToken
                  ? "Joining via invite…"
                  : "Creating your account…"
                : "Signing you in…"
              : isSignup
              ? inviteToken
                ? "Join organization"
                : "Create account"
              : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
