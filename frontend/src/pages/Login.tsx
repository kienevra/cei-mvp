import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login({ username: email, password });
    } catch (err) {
      alert("Login failed. Check your credentials.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div style={{ marginBottom: "1.4rem" }}>
          <div className="auth-title">Sign in to CEI</div>
          <div className="auth-subtitle">
            Carbon Efficiency Intelligence for industrial energy and emissions.
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="cei-btn cei-btn-primary"
            disabled={submitting}
            style={{ width: "100%", marginTop: "0.3rem" }}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          <p
            style={{
              marginTop: "0.8rem",
              fontSize: "0.75rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Access is currently restricted to invited organizations. Contact your
            CEI admin if you need an account.
          </p>
        </form>
      </div>
    </div>
  );
}
