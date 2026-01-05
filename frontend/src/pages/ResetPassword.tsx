// frontend/src/pages/ResetPassword.tsx
import React, { useMemo, useState, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { resetPassword } from "../services/api";
import ErrorBanner from "../components/ErrorBanner";

function pickToken(search: string): string | null {
  const params = new URLSearchParams(search);
  const v = params.get("token");
  return v && v.trim() ? v.trim() : null;
}

function extractResetError(err: any): string | null {
  // Axios-style: err.response.data.detail can be string or object
  const data = err?.response?.data;

  if (data?.detail) {
    if (typeof data.detail === "string") return data.detail;
    if (typeof data.detail === "object") {
      const msg = data.detail.message || data.detail.detail || data.detail.error;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
      try {
        return JSON.stringify(data.detail);
      } catch {
        // ignore
      }
    }
  }

  if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof err?.message === "string" && err.message.trim()) return err.message.trim();

  return null;
}

const ResetPassword: React.FC = () => {
  const { t } = useTranslation();
  const loc = useLocation();
  const nav = useNavigate();

  const token = useMemo(() => pickToken(loc.search), [loc.search]);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);

    const tokenStr = (token || "").trim();
    if (!tokenStr) {
      setError(
        t("auth.passwordReset.reset.missingToken", {
          defaultValue: "Missing reset token.",
        })
      );
      return;
    }

    if (pw.length < 8) {
      setError(
        t("auth.errors.passwordMinLength", {
          defaultValue: "Password must be at least 8 characters.",
        })
      );
      return;
    }

    if (pw !== pw2) {
      setError(
        t("auth.errors.passwordsNoMatch", {
          defaultValue: "Passwords do not match.",
        })
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await resetPassword(tokenStr, pw);

      setDone(
        res?.detail ||
          t("auth.passwordReset.reset.done", {
            defaultValue: "Password updated. You can now sign in.",
          })
      );

      // Give the user a moment to read the success message.
      setTimeout(() => nav("/login", { replace: true }), 1000);
    } catch (err: any) {
      const msg =
        extractResetError(err) ||
        t("auth.passwordReset.reset.error", {
          defaultValue: "Failed to reset password.",
        });

      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && !done;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-title">
          {t("auth.passwordReset.reset.title", { defaultValue: "Set a new password" })}
        </div>
        <div className="auth-subtitle">
          {t("auth.passwordReset.reset.subtitle", {
            defaultValue: "Choose a strong password (min 8 characters).",
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
          </div>
        )}

        <form className="auth-form" onSubmit={onSubmit} style={{ marginTop: "1rem" }}>
          <div>
            <label htmlFor="pw">
              {t("auth.fields.password.createLabel", { defaultValue: "Create a password" })}
            </label>
            <input
              id="pw"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              disabled={!!done}
            />
          </div>

          <div>
            <label htmlFor="pw2">
              {t("auth.fields.passwordConfirm.label", { defaultValue: "Confirm password" })}
            </label>
            <input
              id="pw2"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
              disabled={!!done}
            />
          </div>

          <button
            type="submit"
            className="cei-btn cei-btn-primary"
            disabled={!canSubmit}
            style={{ width: "100%", marginTop: "0.5rem" }}
          >
            {submitting
              ? t("auth.passwordReset.reset.saving", { defaultValue: "Saving…" })
              : t("auth.passwordReset.reset.save", { defaultValue: "Update password" })}
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

export default ResetPassword;
