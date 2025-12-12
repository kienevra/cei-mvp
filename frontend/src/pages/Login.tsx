// frontend/src/pages/Login.tsx
import React, { useEffect, useState, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import ErrorBanner from "../components/ErrorBanner";
import api from "../services/api";

type AuthMode = "login" | "signup";

const Login: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

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
      setNotice("Your session expired. Please log in again to continue.");
    } else {
      setNotice(null);
    }
  }, [location.search]);

  function toErrorString(err: any): string {
    const backendDetail =
      err?.response?.data?.detail ??
      err?.response?.data?.message ??
      err?.response?.data;

    if (typeof backendDetail === "string") return backendDetail;

    // If backend returns an object (e.g. {code,message}), don't crash React
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

        // 1) Create the user account via /auth/signup
        // organization_name tells backend to create a new org (or reuse if it matches —
        // we’ll harden that on the backend next to avoid accidental org collisions).
        await api.post("/auth/signup", {
          email,
          password,
          organization_name: organizationName.trim() || undefined,
        });

        // 2) Login normally to wire Auth context (token storage, redirects)
        await login({ username: email, password });
      }
    } catch (err: any) {
      setError(toErrorString(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = (nextMode: AuthMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError(null);
    setNotice(null);
    setPassword("");
    setPasswordConfirm("");
    // Keep email; reset org name on switch (signup-only)
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

        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            marginBottom: "0.9rem",
            borderRadius: "999px",
            background: "rgba(15, 23, 42, 0.7)",
            padding: "0.15rem",
          }}
        >
          <button
            type="button"
            onClick={() => toggleMode("login")}
            className="cei-btn"
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
              cursor: "pointer",
            }}
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

        {/* Session notice */}
        {notice && mode === "login" && (
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
          {isSignup && (
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
                This creates your org. (We’ll add “join via invite” next.)
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
                ? "Creating your account…"
                : "Signing you in…"
              : isSignup
              ? "Create account"
              : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
