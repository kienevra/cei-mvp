// frontend/src/pages/Login.tsx
import React, { useEffect, useMemo, useState, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import ErrorBanner from "../components/ErrorBanner";
import api, { acceptInvite } from "../services/api";
import LanguageToggle from "../components/LanguageToggle";

type AuthMode = "login" | "signup";

const INVITE_PARAM_KEYS = ["invite", "invite_token", "token"];

function pickInviteToken(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const k of INVITE_PARAM_KEYS) {
    const v = params.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/* ===== Support code (request_id) helpers ===== */

function getRequestIdFromError(err: any): string | null {
  if (!err) return null;

  // Preferred: stamped by api.ts interceptor
  const stamped =
    typeof err?.cei_request_id === "string" ? err.cei_request_id : null;
  if (stamped && stamped.trim()) return stamped.trim();

  // Axios response headers (browser normalizes to lowercase)
  const headers: any = err?.response?.headers || {};
  const fromHeader =
    (typeof headers["x-request-id"] === "string" && headers["x-request-id"]) ||
    (typeof headers["X-Request-ID"] === "string" && headers["X-Request-ID"]) ||
    (typeof headers["x-requestid"] === "string" && headers["x-requestid"]) ||
    null;

  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();

  // Axios response body
  const data: any = err?.response?.data;
  const fromBody =
    typeof data?.request_id === "string"
      ? data.request_id
      : typeof data?.requestId === "string"
      ? data.requestId
      : null;

  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();

  return null;
}

function appendSupportCode(msg: string, rid: string | null): string {
  if (!msg) msg = "Authentication failed. Please try again.";
  if (!rid) return msg;

  // avoid duplicating if it already exists
  if (msg.toLowerCase().includes("support code:")) return msg;
  return `${msg} (Support code: ${rid})`;
}

const Login: React.FC = () => {
  const { t } = useTranslation();
  const { login, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const inviteToken = useMemo(
    () => pickInviteToken(location.search),
    [location.search]
  );

  const [mode, setMode] = useState<AuthMode>("login");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState(""); // invite onboarding (optional)
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

  // Notice logic (invite + session expired + auth required)
  useEffect(() => {
    // Priority:
    // 1) Invite token present -> invite notice
    // 2) ?reason=session_expired -> session expired notice (do not regress)
    // 3) router state reason=auth_required -> gentle sign-in required notice
    // 4) otherwise none

    if (inviteToken) {
      setMode("signup");
      setOrganizationName(""); // invite flow joins an existing org
      setNotice(
        t("auth.invite.notice", {
          defaultValue:
            "You’re joining an organization via invite. Create your account to continue.",
        })
      );
      return;
    }

    const params = new URLSearchParams(location.search);
    const reason = params.get("reason");
    if (reason === "session_expired") {
      setNotice(
        t("auth.sessionExpired", {
          defaultValue: "Your session expired. Please sign in again.",
        })
      );
      return;
    }

    const stateReason =
      (location.state as any)?.reason && String((location.state as any).reason);
    if (stateReason === "auth_required") {
      setNotice(
        t("auth.authRequired", {
          defaultValue: "Please sign in to continue.",
        })
      );
      return;
    }

    setNotice(null);
  }, [inviteToken, location.search, location.state, t]);

  function toErrorString(err: any): string {
    const rid = getRequestIdFromError(err);

    const backendDetail =
      err?.response?.data?.detail ??
      err?.response?.data?.message ??
      err?.response?.data;

    if (typeof backendDetail === "string") {
      return appendSupportCode(backendDetail, rid);
    }

    if (backendDetail && typeof backendDetail === "object") {
      // Support your structured errors: { code, message }
      if (
        typeof (backendDetail as any).code === "string" ||
        typeof (backendDetail as any).message === "string"
      ) {
        const code = (backendDetail as any).code
          ? String((backendDetail as any).code)
          : "";
        const msg = (backendDetail as any).message
          ? String((backendDetail as any).message)
          : "";
        const base =
          code && msg
            ? `${code}: ${msg}`
            : msg ||
              code ||
              t("auth.errors.generic", {
                defaultValue: "Authentication failed. Please try again.",
              });
        return appendSupportCode(base, rid);
      }

      const msg =
        ((backendDetail as any).message &&
          String((backendDetail as any).message)) ||
        ((backendDetail as any).detail && String((backendDetail as any).detail));
      if (msg) return appendSupportCode(msg, rid);

      try {
        return appendSupportCode(JSON.stringify(backendDetail), rid);
      } catch {
        return appendSupportCode(
          t("auth.errors.generic", {
            defaultValue: "Authentication failed. Please try again.",
          }),
          rid
        );
      }
    }

    const fallback =
      err?.message ||
      t("auth.errors.generic", {
        defaultValue: "Authentication failed. Please try again.",
      });
    return appendSupportCode(fallback, rid);
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
          throw new Error(
            t("auth.errors.emailPasswordRequired", {
              defaultValue: "Email and password are required.",
            })
          );
        }

        if (password.length < 8) {
          throw new Error(
            t("auth.errors.passwordMinLength", {
              defaultValue: "Password must be at least 8 characters.",
            })
          );
        }

        if (password !== passwordConfirm) {
          throw new Error(
            t("auth.errors.passwordsNoMatch", {
              defaultValue: "Passwords do not match.",
            })
          );
        }

        if (inviteToken) {
          // ---------- INVITE JOIN FLOW ----------
          // POST /api/v1/org/invites/accept-and-signup  { token, email, password, full_name? }
          let res: { access_token: string; token_type: string };

          try {
            res = await acceptInvite({
              token: inviteToken,
              email,
              password,
              full_name: fullName.trim() || undefined,
            });
          } catch (err: any) {
            const status = err?.response?.status;
            if (status === 404) {
              throw new Error(
                t("auth.errors.inviteJoinNotLive", {
                  defaultValue:
                    "Invite join isn’t live on this backend yet (missing /org/invites/accept-and-signup). Deploy the invites router, then retry.",
                })
              );
            }
            throw err;
          }

          const accessToken = (res as any)?.access_token;
          if (!accessToken) {
            throw new Error(
              t("auth.errors.inviteMissingAccessToken", {
                defaultValue:
                  "Invite signup succeeded but response missing access_token.",
              })
            );
          }

          // Store token and hard-reload so AuthProvider boots from localStorage cleanly.
          localStorage.setItem("cei_token", accessToken);
          window.location.href = "/";
          return;
        } else {
          // ---------- SELF-SERVE ORG CREATION FLOW (preserve existing behavior) ----------
          await api.post("/auth/signup", {
            email,
            password,
            organization_name: organizationName.trim() || undefined,
          });

          // Login normally to wire Auth context (token storage, redirects)
          await login({ username: email, password });
        }
      }
    } catch (err: any) {
      setError(toErrorString(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = (nextMode: AuthMode) => {
    // When an invite is present, we don't let the user switch to "login"
    // because they likely don't have an account yet.
    if (inviteToken && nextMode === "login") return;

    if (nextMode === mode) return;
    setMode(nextMode);
    setError(null);

    // Preserve invite notice if invite exists; otherwise clear.
    if (!inviteToken) setNotice(null);

    setPassword("");
    setPasswordConfirm("");
    setOrganizationName("");
    // Keep full name if user typed it; but clear when switching to login
    if (nextMode === "login") setFullName("");
  };

  const isSignup = mode === "signup";

  return (
    <div className="auth-page">
      <div style={{ position: "relative" }}>
        <div
          style={{ position: "absolute", top: "1rem", right: "1rem", zIndex: 5 }}
        >
          <LanguageToggle variant="pill" />
        </div>

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
              alt={t("brand.full", {
                defaultValue: "CEI – Carbon Efficiency Intelligence",
              })}
              style={{
                height: "320px",
                width: "auto",
                display: "block",
                marginBottom: "0.05rem",
              }}
            />

            <div className="auth-title">
              {t("auth.hero.title", {
                defaultValue: "We use A.I to reduce your factorys carbon footprint.",
              })}
            </div>

            <div className="auth-subtitle">
              {t("auth.hero.subtitle", {
                defaultValue:
                  "CEI ingests your meter and SCADA data, builds statistical baselines for each site, and turns night, weekend, and process inefficiencies into actionable alerts and reports – without installing new hardware.",
              })}
            </div>
          </div>

          {/* Invite badge */}
          {inviteToken && (
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
              <strong style={{ color: "var(--cei-text)" }}>
                {t("auth.invite.badgeTitle", { defaultValue: "Invite detected." })}
              </strong>{" "}
              {t("auth.invite.badgeBody", {
                defaultValue:
                  "You’ll join an existing organization after account creation.",
              })}
            </div>
          )}

          {/* Mode toggle */}
          <div
            style={{
              display: "flex",
              marginBottom: "0.9rem",
              borderRadius: "999px",
              background: "rgba(15, 23, 42, 0.7)",
              padding: "0.15rem",
              opacity: inviteToken ? 0.9 : 1,
            }}
          >
            <button
              type="button"
              onClick={() => toggleMode("login")}
              className="cei-btn"
              disabled={!!inviteToken}
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
                cursor: inviteToken ? "not-allowed" : "pointer",
              }}
              title={
                inviteToken
                  ? t("auth.invite.requiresSignup", {
                      defaultValue: "Invite flow requires account creation.",
                    })
                  : undefined
              }
            >
              {t("auth.actions.signIn", { defaultValue: "Sign in" })}
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
              {t("auth.actions.createAccount", { defaultValue: "Create account" })}
            </button>
          </div>

          {/* Session / invite notice */}
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

          {/* Auth form */}
          <form className="auth-form" onSubmit={handleSubmit}>
            {/* Invite onboarding: full name (optional) */}
            {isSignup && inviteToken && (
              <div>
                <label htmlFor="fullName">
                  {t("auth.fields.fullName.label", {
                    defaultValue: "Full name (optional)",
                  })}
                </label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder={t("auth.fields.fullName.placeholder", {
                    defaultValue: "e.g. Taylor Smith",
                  })}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--cei-text-muted)",
                    marginTop: "0.25rem",
                  }}
                >
                  {t("auth.fields.fullName.help", {
                    defaultValue:
                      "This is stored on your profile and used in audit logs.",
                  })}
                </div>
              </div>
            )}

            {isSignup && !inviteToken && (
              <div>
                <label htmlFor="organizationName">
                  {t("auth.fields.organizationName.label", {
                    defaultValue: "Organization name",
                  })}
                </label>
                <input
                  id="organizationName"
                  type="text"
                  autoComplete="organization"
                  placeholder={t("auth.fields.organizationName.placeholder", {
                    defaultValue: "e.g. Dev Manufacturing",
                  })}
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
                  {t("auth.fields.organizationName.help", {
                    defaultValue:
                      "This creates your org. Use an invite link to join an existing org.",
                  })}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="email">
                {t("auth.fields.email.label", { defaultValue: "Work email" })}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder={t("auth.fields.email.placeholder", {
                  defaultValue: "you@factory.com",
                })}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label htmlFor="password">
                {isSignup
                  ? t("auth.fields.password.createLabel", {
                      defaultValue: "Create a password",
                    })
                  : t("auth.fields.password.label", { defaultValue: "Password" })}
              </label>
              <input
                id="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder={t("auth.fields.password.placeholder", {
                  defaultValue: "••••••••",
                })}
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
                  {t("auth.fields.password.help", {
                    defaultValue: "Minimum 8 characters. Use a strong password.",
                  })}
                </div>
              )}
            </div>

            {isSignup && (
              <div>
                <label htmlFor="passwordConfirm">
                  {t("auth.fields.passwordConfirm.label", {
                    defaultValue: "Confirm password",
                  })}
                </label>
                <input
                  id="passwordConfirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t("auth.fields.passwordConfirm.placeholder", {
                    defaultValue: "••••••••",
                  })}
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
                  ? inviteToken
                    ? t("auth.actions.joiningViaInvite", {
                        defaultValue: "Joining via invite…",
                      })
                    : t("auth.actions.creatingAccountProgress", {
                        defaultValue: "Creating your account…",
                      })
                  : t("auth.actions.signingInProgress", {
                      defaultValue: "Signing you in…",
                    })
                : isSignup
                ? inviteToken
                  ? t("auth.actions.joinOrganization", {
                      defaultValue: "Join organization",
                    })
                  : t("auth.actions.createAccount", {
                      defaultValue: "Create account",
                    })
                : t("auth.actions.signIn", { defaultValue: "Sign in" })}
            </button>

            {/* Forgot password link (login only) */}
            {!isSignup && !inviteToken && (
              <a
                href="/forgot-password"
                style={{
                  display: "block",
                  marginTop: "0.75rem",
                  fontSize: "0.9rem",
                  color: "var(--cei-text-muted)",
                  textAlign: "center",
                }}
              >
                {t("auth.passwordReset.forgot.link", {
                  defaultValue: "Forgot password?",
                })}
              </a>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
