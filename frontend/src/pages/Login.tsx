// frontend/src/pages/Login.tsx
import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import api from "../services/api";

type Tab = "signin" | "signup";

const Login: React.FC = () => {
  const { login } = useAuth();
  const [searchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<Tab>("signin");

  // Sign-in state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Sign-up state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);
  const [signingUp, setSigningUp] = useState(false);

  const reason = searchParams.get("reason");
  const showSessionExpired = reason === "session_expired";

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInError(null);
    setSigningIn(true);

    try {
      await login({ username: email.trim(), password });
      // login() will navigate to "/"
    } catch (err: any) {
      setSignInError("Login failed. Check your credentials.");
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError(null);
    setSignupSuccess(null);
    setSigningUp(true);

    const trimmedEmail = signupEmail.trim();

    if (!trimmedEmail || !signupPassword) {
      setSignupError("Email and password are required.");
      setSigningUp(false);
      return;
    }

    try {
      // Minimal payload that should work with your existing /auth/signup
      await api.post("/auth/signup", {
        email: trimmedEmail,
        password: signupPassword,
      });

      setSignupSuccess("Account created. You can sign in now.");
      setActiveTab("signin");
      // Optionally pre-fill login form
      setEmail(trimmedEmail);
      setPassword("");
    } catch (err: any) {
      setSignupError(
        err?.response?.data?.detail ||
          err?.message ||
          "Failed to create account."
      );
    } finally {
      setSigningUp(false);
    }
  };

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    // reset transient errors when switching
    setSignInError(null);
    setSignupError(null);
    setSignupSuccess(null);
  };

  return (
    <div className="auth-page">
      {/* Left side: Hero / marketing copy */}
      <div
        style={{
          flex: 1,
          maxWidth: 520,
          paddingRight: "2.5rem",
        }}
      >
        <div
          style={{
            marginBottom: "1.25rem",
            fontSize: "0.8rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--cei-text-accent)",
          }}
        >
          CEI · Carbon Efficiency Intelligence
        </div>

        <h1
          style={{
            fontSize: "2.1rem",
            lineHeight: 1.15,
            marginBottom: "1rem",
          }}
        >
          Cut 5–15% of your plant’s energy spend{" "}
          <span style={{ color: "var(--cei-text-accent)" }}>
            without installing a single new sensor.
          </span>
        </h1>

        <p
          style={{
            fontSize: "0.98rem",
            color: "var(--cei-text-muted)",
            maxWidth: 480,
            lineHeight: 1.6,
          }}
        >
          CEI (Carbon Efficiency Intelligence) connects to the data you already
          have, uncovers hidden operational waste, and turns it into quantified
          savings in under 6 weeks.
        </p>

        <div
          style={{
            marginTop: "1.8rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.6rem",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          <span>• Works with historian, SCADA, and utility data</span>
          <span>• Highlights high-variance assets and waste patterns</span>
          <span>• Designed for plant managers and energy leads</span>
        </div>
      </div>

      {/* Right side: Auth card (sign in / sign up) */}
      <div className="auth-card">
        <div
          style={{
            marginBottom: "0.6rem",
          }}
        >
          <div className="auth-title">Access your CEI workspace</div>
          <div className="auth-subtitle">
            Sign in if you already have access, or create a new account to start
            piloting CEI.
          </div>
        </div>

        {showSessionExpired && (
          <div
            style={{
              marginBottom: "0.8rem",
              padding: "0.6rem 0.7rem",
              borderRadius: "0.55rem",
              border: "1px solid rgba(250, 204, 21, 0.4)",
              background: "rgba(250, 204, 21, 0.08)",
              fontSize: "0.8rem",
              color: "#facc15",
            }}
          >
            Your session expired. Please sign in again.
          </div>
        )}

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "0.9rem",
            background: "rgba(15, 23, 42, 0.9)",
            padding: "0.16rem",
            borderRadius: "999px",
          }}
        >
          <button
            type="button"
            className="cei-btn"
            style={{
              flex: 1,
              borderRadius: "999px",
              background:
                activeTab === "signin" ? "var(--cei-accent-soft)" : "transparent",
              borderColor:
                activeTab === "signin"
                  ? "rgba(34,197,94,0.8)"
                  : "transparent",
              color:
                activeTab === "signin"
                  ? "#bbf7d0"
                  : "var(--cei-text-muted)",
            }}
            onClick={() => switchTab("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className="cei-btn"
            style={{
              flex: 1,
              borderRadius: "999px",
              background:
                activeTab === "signup"
                  ? "rgba(56,189,248,0.18)"
                  : "transparent",
              borderColor:
                activeTab === "signup"
                  ? "rgba(56,189,248,0.8)"
                  : "transparent",
              color:
                activeTab === "signup"
                  ? "#bae6fd"
                  : "var(--cei-text-muted)",
            }}
            onClick={() => switchTab("signup")}
          >
            Create account
          </button>
        </div>

        {/* Sign-in form */}
        {activeTab === "signin" && (
          <form className="auth-form" onSubmit={handleSignIn}>
            <div>
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {signInError && (
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-danger)",
                }}
              >
                {signInError}
              </div>
            )}

            <button
              type="submit"
              className="cei-btn cei-btn-primary"
              disabled={signingIn}
            >
              {signingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {/* Sign-up form */}
        {activeTab === "signup" && (
          <form className="auth-form" onSubmit={handleSignup}>
            <div>
              <label htmlFor="signupEmail">Work email</label>
              <input
                id="signupEmail"
                type="email"
                value={signupEmail}
                autoComplete="email"
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="signupPassword">Password</label>
              <input
                id="signupPassword"
                type="password"
                value={signupPassword}
                autoComplete="new-password"
                onChange={(e) => setSignupPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>

            {signupError && (
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-danger)",
                }}
              >
                {signupError}
              </div>
            )}

            {signupSuccess && (
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-accent)",
                }}
              >
                {signupSuccess}
              </div>
            )}

            <button
              type="submit"
              className="cei-btn"
              style={{
                background:
                  "linear-gradient(135deg, rgba(56,189,248,0.1), rgba(34,197,94,0.2))",
                borderColor: "rgba(56,189,248,0.5)",
              }}
              disabled={signingUp}
            >
              {signingUp ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;
