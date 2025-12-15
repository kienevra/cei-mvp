import React, { useMemo, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { acceptInvite } from "../services/api";

function safeStringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function toUiMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  if (data?.detail != null) {
    return typeof data.detail === "string"
      ? data.detail
      : safeStringify(data.detail) || fallback;
  }
  if (data?.message != null) {
    return typeof data.message === "string"
      ? data.message
      : safeStringify(data.message) || fallback;
  }
  if (err?.message) return String(err.message);
  return fallback;
}

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

const Signup: React.FC = () => {
  const navigate = useNavigate();
  const query = useQuery();
  const inviteToken = (query.get("invite") || "").trim();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    inviteToken.length > 0 &&
    email.trim().length > 0 &&
    password.trim().length >= 6 &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inviteToken) {
      setError("Missing invite token. Please use the invite link you received.");
      return;
    }

    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm) {
      setError("Email is required.");
      return;
    }

    if (password.trim().length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const resp = await acceptInvite({
        token: inviteToken,
        email: emailNorm,
        password,
        full_name: fullName.trim() ? fullName.trim() : undefined, // never send null
      });

      // Reuse existing auth storage convention (cei_token)
      localStorage.setItem("cei_token", resp.access_token);

      // This ensures refresh-cookie flow continues to work via axios withCredentials.
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(toUiMessage(err, "Failed to accept invite."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ marginBottom: "0.75rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Join organization</h1>
          <p
            style={{
              marginTop: "0.35rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Enter your details to accept your invite.
          </p>
        </div>

        {!inviteToken && (
          <div className="cei-pill-danger" style={{ marginBottom: "0.75rem" }}>
            Missing invite token. Use the invite link your org owner sent you.
          </div>
        )}

        {error && (
          <div className="cei-pill-danger" style={{ marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.6rem" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
            Invite token:{" "}
            <span style={{ fontFamily: "monospace" }}>
              {inviteToken ? inviteToken.slice(0, 18) + "…" : "(none)"}
            </span>
          </div>

          <input
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
          />

          <input
            type="text"
            placeholder="Full name (optional)"
            value={fullName}
            autoComplete="name"
            onChange={(e) => setFullName(e.target.value)}
            disabled={submitting}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={submitting}
          />

          <button className="cei-btn" type="submit" disabled={!canSubmit}>
            {submitting ? "Joining..." : "Join organization"}
          </button>
        </form>

        <div
          style={{
            marginTop: "0.8rem",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
};

export default Signup;
