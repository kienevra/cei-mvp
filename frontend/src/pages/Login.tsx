// frontend/src/pages/Login.tsx
import React, { useEffect, useState, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import ErrorBanner from "../components/ErrorBanner";

const Login: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      // Backend expects username + password
      await login({ username: email, password });
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Login failed. Check your credentials and try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

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
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "var(--cei-text-muted)",
            }}
          >
            CEI · Carbon Efficiency Intelligence
          </div>

          {/* >>> Your headline <<< */}
          <div className="auth-title">
            Cut 5–15% of your plant’s energy spend without installing a single
            new sensor.
          </div>

          {/* >>> Your subheadline <<< */}
          <div className="auth-subtitle">
            CEI (Carbon Efficiency Intelligence) connects to the data you
            already have, uncovers hidden operational waste, and turns it into
            quantified savings in under 6 weeks.
          </div>
        </div>

        {/* Session notice */}
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

        {/* Login form */}
        <form className="auth-form" onSubmit={handleSubmit}>
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
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

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
            {submitting ? "Signing you in…" : "Sign in"}
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
          After signing in you can:
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
