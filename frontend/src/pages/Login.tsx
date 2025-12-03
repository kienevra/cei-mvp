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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "login") {
        // ---------- LOGIN FLOW ----------
        // Backend expects username + password
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
        await api.post("/auth/signup", {
          email,
          password,
          // organization_id left null for now; we can later
          // extend to accept organization selection / creation.
        });

        // 2) Reuse the existing login flow so the Auth context
        //    is fully wired (token, isAuthenticated, redirects).
        await login({ username: email, password });
      }
    } catch (err: any) {
      const backendDetail =
        err?.response?.data?.detail ??
        err?.response?.data?.message ??
        err?.response?.data;

      const msg =
        typeof backendDetail === "string"
          ? backendDetail
          : err?.message || "Authentication failed. Please try again.";

      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = (nextMode: AuthMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError(null);
    setNotice(null);
    // Do not auto-clear email; but reset passwords when switching.
    setPassword("");
    setPasswordConfirm("");
  };

  const isSignup = mode === "signup";

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Brand / header */}
        <div
          style={{
            marginBottom: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
            }}
          >
            <img
              src="/cei-logo-full.png"
              alt="CEI – Carbon Efficiency Intelligence"
              style={{
                height: "56px",
                width: "auto",
                display: "block",
              }}
            />
            <div
              style={{
                fontSize: "0.8rem",
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "var(--cei-text-muted)",
              }}
            >
              CEI · Carbon Efficiency Intelligence
            </div>
          </div>

          <div className="auth-title">
            We help factories quantify and cut wasted energy.
          </div>

          <div className="auth-subtitle">
            CEI ingests your meter and SCADA data, builds statistical baselines
            for each site, and turns night, weekend, and process inefficiencies
            into actionable alerts and reports – without installing new
            hardware.
          </div>
        </div>

        {/* Mode toggle: Sign in / Create account */}
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
              color:
                mode === "login" ? "#0f172a" : "var(--cei-text-muted)",
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
              color:
                mode === "signup" ? "#0f172a" : "var(--cei-text-muted)",
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

        {/* Auth form (login or signup depending on mode) */}
        <form className="auth-form" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email">
              {isSignup ? "Work email" : "Work email"}
            </label>
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
            <label htmlFor="password">
              {isSignup ? "Create a password" : "Password"}
            </label>
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

        {/* Small value-proposition footer */}
        <div
          style={{
            marginTop: "1.4rem",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            borderTop: "1px solid rgba(31, 41, 55, 0.7)",
            paddingTop: "0.8rem",
          }}
        >
          After {isSignup ? "creating your account" : "signing in"} you can:
          <ul
            style={{
              margin: "0.4rem 0 0",
              paddingLeft: "1.1rem",
              lineHeight: 1.6,
              color: "var(--cei-text-main)",
            }}
          >
            <li>See 24-hour portfolio and per-site energy trends.</li>
            <li>Review alerts for abnormal consumption and missing data.</li>
            <li>Upload CSVs to backfill or test new sites quickly.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Login;
