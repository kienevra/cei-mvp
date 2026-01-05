// frontend/src/pages/ForgotPassword.tsx
import React, { useState, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { requestPasswordReset } from "../services/api";
import ErrorBanner from "../components/ErrorBanner";

const ForgotPassword: React.FC = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [debugLink, setDebugLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDone(null);
    setDebugLink(null);

    try {
      const normalized = (email || "").trim().toLowerCase();
      const res = await requestPasswordReset(normalized);

      setDone(
        res?.detail ||
          t("auth.passwordReset.forgot.done", {
            defaultValue: "If the email exists, a password reset link has been sent.",
          })
      );

      if (res?.debug_reset_link) setDebugLink(String(res.debug_reset_link));
    } catch (err: any) {
      const msg =
        typeof err?.message === "string" && err.message.trim()
          ? err.message
          : t("auth.passwordReset.forgot.error", {
              defaultValue: "Failed to request password reset.",
            });

      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && (email || "").trim().length > 0;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-title">
          {t("auth.passwordReset.forgot.title", { defaultValue: "Reset password" })}
        </div>

        <div className="auth-subtitle">
          {t("auth.passwordReset.forgot.subtitle", {
            defaultValue: "Enter your email and we’ll send you a reset link.",
          })}
        </div>

        {error && (
          <div style={{ marginTop: "0.75rem" }}>
            <ErrorBanner message={error} onClose={() => setError(null)} />
          </div>
        )}

        {done && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.6rem 0.75rem",
              borderRadius: "0.6rem",
              border: "1px solid rgba(56, 189, 248, 0.35)",
              background: "rgba(15, 23, 42, 0.7)",
              color: "var(--cei-text-muted)",
              fontSize: "0.9rem",
            }}
          >
            {done}

            {debugLink && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                  {t("auth.passwordReset.forgot.devLink", { defaultValue: "Dev reset link:" })}
                </div>
                <a href={debugLink} style={{ wordBreak: "break-all" }}>
                  {debugLink}
                </a>
              </div>
            )}
          </div>
        )}

        <form className="auth-form" onSubmit={onSubmit} style={{ marginTop: "1rem" }}>
          <div>
            <label htmlFor="email">
              {t("auth.fields.email.label", { defaultValue: "Work email" })}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder={t("auth.fields.email.placeholder", { defaultValue: "you@factory.com" })}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="cei-btn cei-btn-primary"
            disabled={!canSubmit}
            style={{ width: "100%", marginTop: "0.5rem" }}
          >
            {submitting
              ? t("auth.passwordReset.forgot.sending", { defaultValue: "Sending…" })
              : t("auth.passwordReset.forgot.send", { defaultValue: "Send reset link" })}
          </button>

          <a
            href="/login"
            style={{
              display: "block",
              marginTop: "0.75rem",
              fontSize: "0.9rem",
              color: "var(--cei-text-muted)",
              textAlign: "center",
            }}
          >
            {t("auth.passwordReset.backToLogin", { defaultValue: "Back to sign in" })}
          </a>
        </form>
      </div>
    </div>
  );
};

export default ForgotPassword;
