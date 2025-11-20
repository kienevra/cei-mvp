// frontend/src/pages/Login.tsx
import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Login() {
  const { login } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  // One-shot banner for expired sessions
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const reason = params.get("reason");
    if (reason === "session_expired") {
      setSessionMessage("Your session expired. Please sign in again.");
      // Clean the URL so the banner doesn't stick forever
      const cleanUrl = location.pathname; // usually "/login"
      window.history.replaceState({}, "", cleanUrl);
    } else {
      setSessionMessage(null);
    }
  }, [location.pathname, location.search]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSessionMessage(null);
    setLoading(true);

    try {
      await login({ username: email, password });
      // on success, useAuth.login navigates to "/"
    } catch (err: any) {
      setError(err?.message || "Login failed. Please try again.");
    } finally {
      // this MUST run even on errors so the button never stays stuck
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div style={{ marginBottom: "1rem" }}>
          <div className="auth-title">Sign in to CEI</div>
          <div className="auth-subtitle">
            Enter your credentials to access your carbon &amp; energy intelligence dashboard.
          </div>
        </div>

        {sessionMessage && (
          <div
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.8rem",
              color: "#fbbf24",
              background: "rgba(250, 204, 21, 0.08)",
              border: "1px solid rgba(250, 204, 21, 0.5)",
              borderRadius: "0.75rem",
              padding: "0.5rem 0.7rem",
            }}
          >
            {sessionMessage}
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-danger)",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.5)",
              borderRadius: "0.75rem",
              padding: "0.5rem 0.7rem",
            }}
          >
            {error}
          </div>
        )}

        <form className="auth-form" onSubmit={submit}>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="cei-btn cei-btn-primary"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
