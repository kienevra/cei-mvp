import React, { useState, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const Login: React.FC = () => {
  const { login } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionMessage = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const reason = params.get("reason");
    if (reason === "session_expired") {
      return "Your session has expired. Please sign in again to continue.";
    }
    return null;
  }, [location.search]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      await login({ username: email.trim(), password });
      // on success, useAuth will navigate to "/"
    } catch (err: any) {
      setError("Login failed. Check your credentials.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div
          style={{
            fontSize: "0.8rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--cei-text-muted)",
            marginBottom: "0.4rem",
          }}
        >
          Carbon Efficiency Intelligence
        </div>

        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">
          Access your CEI workspace to monitor energy and carbon performance
          across sites.
        </p>

        {sessionMessage && (
          <div
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.8rem",
              padding: "0.55rem 0.7rem",
              borderRadius: "0.75rem",
              border: "1px solid rgba(148, 163, 184, 0.6)",
              background: "rgba(15, 23, 42, 0.9)",
              color: "var(--cei-text-muted)",
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
              padding: "0.55rem 0.7rem",
              borderRadius: "0.75rem",
              border: "1px solid rgba(239, 68, 68, 0.6)",
              background: "rgba(127, 29, 29, 0.4)",
              color: "#fecaca",
            }}
          >
            {error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
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
            />
          </div>

          <button
            type="submit"
            className="cei-btn cei-btn-primary"
            disabled={submitting}
            style={{ marginTop: "0.3rem", width: "100%" }}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
