// frontend/src/pages/Account.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  getAccountMe,
  deleteAccount,
  startCheckout,
  openBillingPortal,
  listOrgInvites,
  createOrgInvite,
  revokeOrgInvite,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import type { AccountMe, OrganizationSummary } from "../types/auth";

// Read environment once from Vite
const rawEnv = (import.meta as any).env || {};
const appEnvironment: string =
  (rawEnv.VITE_ENVIRONMENT as string | undefined) || "dev";

function getEnvironmentLabel(env: string): string {
  const key = env.toLowerCase();
  if (key === "prod" || key === "production") return "Production";
  if (key === "pilot" || key === "staging") return "Pilot / Staging";
  return "Development";
}

function getEnvironmentBlurb(env: string): string {
  const key = env.toLowerCase();
  if (key === "prod" || key === "production") {
    return "Production data. Treat this as customer-facing and audit-ready.";
  }
  if (key === "pilot" || key === "staging") {
    return "Pilot / staging data. Suitable for demos and friendly pilots, not for financial sign-off.";
  }
  return "Local / dev data. Safe to experiment, break things, and iterate quickly.";
}

function normalizeRole(raw: any): "owner" | "member" | null {
  const v = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (v === "owner") return "owner";
  if (v === "member") return "member";
  return null;
}

function roleLabel(role: string | null | undefined): string {
  const r = normalizeRole(role);
  if (r === "owner") return "Owner";
  if (r === "member") return "Member";
  return "—";
}

function parsePrimarySources(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((x) => String(x).trim())
      .filter((x) => x.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

type UiAccount = AccountMe & {
  role?: string | null;
  org: OrganizationSummary | null;

  subscription_plan_key?: string | null;
  subscription_status?: string | null;
  enable_alerts?: boolean | null;
  enable_reports?: boolean | null;

  currency_code?: string | null;
  electricity_price_per_kwh?: number | null;
  gas_price_per_kwh?: number | null;
  primary_energy_sources?: string[] | null;
};

// ---- Invites (owner-only) ----
// Backend contract is intentionally flexible: we parse whatever fields exist.
type OrgInvite = {
  id: number;

  // canonical or legacy org id fields (we don't rely on these for UI)
  organization_id?: number | null;
  org_id?: number | null;

  email?: string | null;
  role?: string | null;

  is_active?: boolean | null;

  // canonical acceptance markers
  accepted_at?: string | null;
  accepted_user_id?: number | null;

  // legacy acceptance markers (older schema)
  used_at?: string | null;
  used_by_user_id?: number | null;

  revoked_at?: string | null;
  created_at?: string | null;
  created_by_user_id?: number | null;

  expires_at?: string | null;
};

function safeString(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim().length ? s : null;
}

function parseMaybeDate(v?: string | null): Date | null {
  const s = safeString(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatMaybeIso(ts?: string | null): string {
  const v = safeString(ts);
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function buildInviteLink(token: string): string {
  // Keep existing frontend behavior to avoid regressions:
  // user lands on /login?invite=...
  const origin = window.location.origin;
  return `${origin}/login?invite=${encodeURIComponent(token)}`;
}

function inviteStatus(inv: OrgInvite): "Accepted" | "Expired" | "Revoked" | "Active" | "Inactive" {
  const isActive = typeof inv.is_active === "boolean" ? inv.is_active : true;

  const acceptedAt = safeString(inv.accepted_at) || safeString(inv.used_at);
  const acceptedUserId =
    typeof inv.accepted_user_id === "number"
      ? inv.accepted_user_id
      : typeof inv.used_by_user_id === "number"
      ? inv.used_by_user_id
      : null;

  if (acceptedAt || acceptedUserId != null) return "Accepted";

  const revokedAt = safeString(inv.revoked_at);
  if (revokedAt) return "Revoked";

  const expiresAtDate = parseMaybeDate(inv.expires_at);
  if (expiresAtDate && expiresAtDate.getTime() < Date.now()) return "Expired";

  if (isActive) return "Active";
  return "Inactive";
}

function statusPillClass(status: string): string {
  if (status === "Active") return "cei-pill cei-pill-good";
  if (status === "Accepted") return "cei-pill cei-pill-neutral";
  if (status === "Expired") return "cei-pill cei-pill-warn";
  return "cei-pill cei-pill-muted";
}

const Account: React.FC = () => {
  const [account, setAccount] = useState<UiAccount | null>(null);
  const [loading, setLoading] = useState(false);

  // Hard error (used for destructive actions, billing flows, etc.)
  const [error, setError] = useState<string | null>(null);

  // Non-blocking warning: /account/me failed, but we still render core UI
  const [accountWarning, setAccountWarning] = useState<string | null>(null);

  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  // Invites UI state
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "owner">("member");
  const [inviteDays, setInviteDays] = useState<number>(7);

  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null);
  const [createdInviteNote, setCreatedInviteNote] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadAccount() {
      setLoading(true);
      setError(null);
      setAccountWarning(null);

      try {
        const data = await getAccountMe();
        if (!isMounted) return;

        const org: OrganizationSummary | null =
          (data as any)?.org ?? (data as any)?.organization ?? null;

        const roleRaw = (data as any)?.role ?? (data as any)?.user_role ?? null;

        setAccount({
          ...(data as UiAccount),
          org,
          role: normalizeRole(roleRaw) ?? roleRaw,
        });
      } catch (e: any) {
        if (!isMounted) return;

        setAccount(null);
        setAccountWarning(
          e?.response?.data?.detail ||
            e?.message ||
            "Pricing and plan details are temporarily unavailable. Core kWh analytics will still work."
        );
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    loadAccount();

    return () => {
      isMounted = false;
    };
  }, []);

  const envLabel = getEnvironmentLabel(appEnvironment);
  const envBlurb = getEnvironmentBlurb(appEnvironment);

  // Canonical org object for UI + flags
  const org: OrganizationSummary | null = account?.org ?? null;

  // Flexible view over account/org for plan + tariffs (handles org vs root fields)
  const accountAny: any = account || {};
  const orgLike: any = accountAny.org ?? accountAny.organization ?? null;

  const planKey =
    orgLike?.subscription_plan_key ||
    orgLike?.plan_key ||
    accountAny.subscription_plan_key ||
    "cei-starter";

  const planLabel = (() => {
    switch (planKey) {
      case "cei-starter":
        return "CEI Starter";
      case "cei-growth":
        return "CEI Growth";
      default:
        return "Custom / Unspecified";
    }
  })();

  const subscriptionStatus =
    orgLike?.subscription_status || accountAny.subscription_status || "Not connected";

  // Respect explicit false; only default to true when we truly have no signal.
  const alertsEnabled =
    typeof accountAny.enable_alerts === "boolean"
      ? accountAny.enable_alerts
      : typeof orgLike?.enable_alerts === "boolean"
      ? (orgLike.enable_alerts as boolean)
      : true;

  const reportsEnabled =
    typeof accountAny.enable_reports === "boolean"
      ? accountAny.enable_reports
      : typeof orgLike?.enable_reports === "boolean"
      ? (orgLike.enable_reports as boolean)
      : true;

  const isOwner = useMemo(() => normalizeRole(account?.role) === "owner", [account?.role]);

  const handleStartStarterCheckout = async () => {
    setBillingMessage(null);
    setStartingCheckout(true);
    try {
      const { url } = await startCheckout("cei-starter");

      if (url) {
        window.location.href = url;
        return;
      }

      setBillingMessage(
        "Billing is not fully configured for this environment. No live checkout page is available."
      );
    } catch (err) {
      console.error("Failed to start checkout:", err);
      setBillingMessage("Could not start checkout. Please retry or contact your CEI admin.");
    } finally {
      setStartingCheckout(false);
    }
  };

  const handleOpenPortal = async () => {
    setBillingMessage(null);
    setOpeningPortal(true);
    try {
      const { url } = await openBillingPortal();

      if (url) {
        window.location.href = url;
        return;
      }

      setBillingMessage(
        "The billing portal is not available in this environment. Stripe is not fully configured."
      );
    } catch (err) {
      console.error("Failed to open billing portal:", err);
      setBillingMessage("Could not open the billing portal. Please retry or contact your CEI admin.");
    } finally {
      setOpeningPortal(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("Really delete your account? This cannot be undone.")) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      setDeleteSuccess(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to delete account.");
    } finally {
      setDeleting(false);
    }
  };

  // Pricing context (tariffs & energy mix) – unified org/root view
  const currencyCode: string =
    typeof orgLike?.currency_code === "string"
      ? orgLike.currency_code
      : typeof accountAny.currency_code === "string"
      ? accountAny.currency_code
      : "—";

  const electricityPrice: number | null =
    typeof orgLike?.electricity_price_per_kwh === "number"
      ? orgLike.electricity_price_per_kwh
      : typeof accountAny.electricity_price_per_kwh === "number"
      ? accountAny.electricity_price_per_kwh
      : null;

  const gasPrice: number | null =
    typeof orgLike?.gas_price_per_kwh === "number"
      ? orgLike.gas_price_per_kwh
      : typeof accountAny.gas_price_per_kwh === "number"
      ? accountAny.gas_price_per_kwh
      : null;

  const primarySources: string[] = parsePrimarySources(
    orgLike?.primary_energy_sources ?? accountAny.primary_energy_sources
  );

  const hasTariffConfig =
    typeof electricityPrice === "number" ||
    typeof gasPrice === "number" ||
    (currencyCode && currencyCode !== "—") ||
    (primarySources && primarySources.length > 0);

  const formatPrice = (value: number | null) =>
    typeof value === "number" ? value.toFixed(4) : "Not configured";

  // ---- Invites actions (owner-only) ----
  const loadInvites = async () => {
    setInvitesError(null);
    setInvitesLoading(true);
    try {
      const list = await listOrgInvites();
      setInvites(list as any as OrgInvite[]);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : e?.response?.data?.detail || e?.message || "Failed to load invites.";
      setInvitesError(msg);
      setInvites([]);
    } finally {
      setInvitesLoading(false);
    }
  };

  const handleCreateInvite = async () => {
    setInvitesError(null);
    setCreatedInviteLink(null);
    setCreatedInviteNote(null);

    if (!isOwner) {
      setInvitesError("Owner-only. Only an org owner can generate invite links.");
      return;
    }

    const email = inviteEmail.trim();
    if (email.length > 0 && !email.includes("@")) {
      setInvitesError("Invite email looks invalid. Either leave it blank or enter a real email.");
      return;
    }

    // Backend enforces 1..30 today; UI allows up to 90 but we clamp to 30 to avoid server errors.
    const daysRaw = Number.isFinite(inviteDays) ? inviteDays : 7;
    const days = Math.max(1, Math.min(30, Math.floor(daysRaw)));

    setCreatingInvite(true);
    try {
      const res = await createOrgInvite({
        email: email.length ? email : undefined,
        role: inviteRole,
        expires_in_days: days,
      });

      const token = safeString((res as any)?.token);
      if (!token) {
        setCreatedInviteNote(
          "Invite created, but backend did not return a token. Ensure the create endpoint returns the one-time token."
        );
      } else {
        const link = buildInviteLink(token);
        setCreatedInviteLink(link);
        setCreatedInviteNote("Invite link generated. Copy it and send it to the user.");
      }

      await loadInvites();
      setInviteEmail("");
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : e?.response?.data?.detail || e?.message || "Failed to create invite.";
      setInvitesError(msg);
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    setInvitesError(null);
    if (!isOwner) {
      setInvitesError("Owner-only. Only an org owner can revoke invites.");
      return;
    }

    if (!window.confirm("Revoke this invite? Anyone holding the link will be blocked.")) return;

    try {
      await revokeOrgInvite(inviteId);
      await loadInvites();
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : e?.response?.data?.detail || e?.message || "Failed to revoke invite.";
      setInvitesError(msg);
    }
  };

  const handleCopy = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCreatedInviteNote("Copied to clipboard.");
      setTimeout(
        () => setCreatedInviteNote("Invite link generated. Copy it and send it to the user."),
        1500
      );
    } catch {
      // fallback: no-op (user can manually copy)
      setCreatedInviteNote("Copy failed in this browser. Select the link and copy manually.");
    }
  };

  // Load invites when account is loaded and user is owner
  useEffect(() => {
    if (!account) return;
    if (!isOwner) return;
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, isOwner]);

  return (
    <div className="dashboard-page">
      {/* Header */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "1rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Account & Billing
          </h1>
          <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
            Manage your CEI profile, organization, and subscription. This is the control panel for
            turning a single deployment into a real SaaS footprint.
          </p>
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", textAlign: "right" }}>
          {org?.name && (
            <div>
              Org: <strong>{org.name}</strong>
            </div>
          )}
          <div>
            Role: <strong>{roleLabel(account?.role)}</strong>
          </div>
          <div style={{ marginTop: "0.2rem" }}>
            <span>
              Plan: <strong>{planLabel}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* Non-blocking warning when /account/me fails */}
      {accountWarning && (
        <section style={{ marginTop: "0.75rem" }}>
          <div className="cei-pill-muted" style={{ padding: "0.55rem 0.75rem", fontSize: "0.8rem" }}>
            {accountWarning}
          </div>
        </section>
      )}

      {/* Error banner (hard errors like delete/billing actions) */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      {/* Top row: Profile + Subscription */}
      <section className="dashboard-row">
        {/* Profile card */}
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            Profile
          </div>
          {loading ? (
            <div style={{ padding: "0.8rem 0.2rem", display: "flex", justifyContent: "center" }}>
              <LoadingSpinner />
            </div>
          ) : deleteSuccess ? (
            <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
              Your account has been deleted on this environment. You may need to log out manually
              or clear your token in local storage.
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
                <div>
                  <strong>Email:</strong> {account?.email || <span>—</span>}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>Name:</strong> {account?.full_name || <span>—</span>}
                </div>
              </div>

              <div
                style={{
                  marginTop: "0.8rem",
                  borderTop: "1px solid var(--cei-border-subtle)",
                  paddingTop: "0.7rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                  For now this is read-only. In a production deployment, this is where you’d manage
                  passwords, SSO, and org membership.
                </div>
                <button
                  type="button"
                  className="cei-pill-danger"
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteSuccess}
                >
                  {deleting ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Subscription card */}
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            Subscription
          </div>

          <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
            <div>
              <strong>Current plan:</strong> {planLabel}
            </div>
            <div style={{ marginTop: "0.2rem" }}>
              <strong>Status:</strong> {subscriptionStatus}
            </div>
          </div>

          {/* Feature flags summary */}
          <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            <div>
              <strong>Alerts:</strong> {alertsEnabled ? "Enabled" : "Disabled"}
            </div>
            <div style={{ marginTop: "0.1rem" }}>
              <strong>Reports:</strong> {reportsEnabled ? "Enabled" : "Disabled"}
            </div>
          </div>

          <div style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.6 }}>
              <li>Starter includes alerts, reports, and multi-site analytics.</li>
              <li>Growth (later) adds more orgs, longer history, and SLA-backed support.</li>
            </ul>
          </div>

          <div style={{ marginTop: "0.9rem", display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
            <button
              type="button"
              className="cei-btn cei-btn-primary"
              onClick={handleStartStarterCheckout}
              disabled={startingCheckout}
            >
              {startingCheckout ? "Redirecting…" : "Upgrade to CEI Starter"}
            </button>
            <button
              type="button"
              className="cei-btn cei-btn-ghost"
              onClick={handleOpenPortal}
              disabled={openingPortal}
            >
              {openingPortal ? "Opening…" : "Manage subscription"}
            </button>
          </div>

          {billingMessage && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.5rem",
                border: "1px solid rgba(250,204,21,0.7)",
                background: "rgba(30,64,175,0.35)",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              {billingMessage}
            </div>
          )}
        </div>
      </section>

      {/* Owner-only: Invites */}
      <section>
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.4rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <span>Organization invites</span>
            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              Owner-only. Generates join links for this org.
            </span>
          </div>

          {!isOwner ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              You are not an org owner. Invite generation is restricted.
            </div>
          ) : (
            <>
              {invitesError && (
                <div style={{ marginBottom: "0.6rem" }}>
                  <ErrorBanner message={invitesError} onClose={() => setInvitesError(null)} />
                </div>
              )}

              {/* Create invite */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.3fr 0.7fr 0.5fr auto",
                  gap: "0.6rem",
                  alignItems: "end",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                    Invite email (optional)
                  </label>
                  <input
                    type="email"
                    placeholder="optional: user@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    style={{ width: "100%" }}
                  />
                  <div style={{ marginTop: "0.25rem", fontSize: "0.74rem", color: "var(--cei-text-muted)" }}>
                    Leave blank for a generic link. Add email to bind the invite to a recipient.
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                    Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole((e.target.value as any) || "member")}
                    style={{ width: "100%" }}
                  >
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                    Expires (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={inviteDays}
                    onChange={(e) => setInviteDays(parseInt(e.target.value || "7", 10))}
                    style={{ width: "100%" }}
                  />
                </div>

                <button
                  type="button"
                  className="cei-btn cei-btn-primary"
                  onClick={handleCreateInvite}
                  disabled={creatingInvite}
                  style={{ height: "2.35rem" }}
                >
                  {creatingInvite ? "Creating…" : "Generate invite link"}
                </button>
              </div>

              {/* Created link */}
              {(createdInviteLink || createdInviteNote) && (
                <div
                  style={{
                    marginTop: "0.75rem",
                    padding: "0.6rem 0.75rem",
                    borderRadius: "0.6rem",
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    background: "rgba(15, 23, 42, 0.55)",
                  }}
                >
                  {createdInviteLink && (
                    <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                        <strong style={{ color: "var(--cei-text)" }}>Invite link:</strong>{" "}
                        <span style={{ wordBreak: "break-all" }}>{createdInviteLink}</span>
                      </div>
                      <button
                        type="button"
                        className="cei-btn cei-btn-ghost"
                        onClick={() => handleCopy(createdInviteLink)}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  {createdInviteNote && (
                    <div
                      style={{
                        marginTop: createdInviteLink ? "0.35rem" : 0,
                        fontSize: "0.78rem",
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      {createdInviteNote}
                    </div>
                  )}
                </div>
              )}

              {/* Invite list */}
              <div style={{ marginTop: "0.9rem", display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                <div style={{ fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                  Active links should be short-lived. Revoke after onboarding is complete.
                </div>
                <button
                  type="button"
                  className="cei-btn cei-btn-ghost"
                  onClick={loadInvites}
                  disabled={invitesLoading}
                >
                  {invitesLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <div style={{ marginTop: "0.6rem" }}>
                {invitesLoading ? (
                  <div style={{ padding: "0.5rem 0.2rem", display: "flex", justifyContent: "center" }}>
                    <LoadingSpinner />
                  </div>
                ) : invites.length === 0 ? (
                  <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                    No invites yet.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="cei-table" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Expires</th>
                          <th>Created</th>
                          <th>Accepted</th>
                          <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((inv) => {
                          const status = inviteStatus(inv);
                          const isActionable = status === "Active";

                          const acceptedTs =
                            safeString(inv.accepted_at) ||
                            safeString(inv.used_at) ||
                            null;

                          return (
                            <tr key={inv.id}>
                              <td>{inv.id}</td>
                              <td>{safeString(inv.email) || <span style={{ color: "var(--cei-text-muted)" }}>—</span>}</td>
                              <td>{safeString(inv.role) || "member"}</td>
                              <td>
                                <span className={statusPillClass(status)}>
                                  {status}
                                </span>
                              </td>
                              <td>{formatMaybeIso(inv.expires_at)}</td>
                              <td>{formatMaybeIso(inv.created_at)}</td>
                              <td>{formatMaybeIso(acceptedTs)}</td>
                              <td style={{ textAlign: "right" }}>
                                <button
                                  type="button"
                                  className="cei-btn cei-btn-ghost"
                                  onClick={() => handleRevokeInvite(inv.id)}
                                  disabled={!isActionable}
                                  title={
                                    status !== "Active"
                                      ? "Invite is not active"
                                      : "Revoke invite"
                                  }
                                >
                                  Revoke
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Tariffs & energy mix */}
      <section>
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.4rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <span>Tariffs & energy mix</span>
            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              Read-only. Used for cost analytics and savings estimates.
            </span>
          </div>

          {!account && !hasTariffConfig ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              Account details are not available right now. Tariff and energy mix data will appear here
              once your account context loads successfully.
            </div>
          ) : !org && !hasTariffConfig ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              No organization is associated with this account yet. Tariff and energy mix data will
              appear here once your org is configured.
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.6 }}>
                <div>
                  <strong>Currency:</strong> {currencyCode}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>Electricity price (per kWh):</strong> {formatPrice(electricityPrice)}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>Gas price (per kWh):</strong> {formatPrice(gasPrice)}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>Primary energy sources:</strong>{" "}
                  {primarySources && primarySources.length > 0 ? (
                    primarySources.join(", ")
                  ) : (
                    <span>Not specified</span>
                  )}
                </div>
              </div>

              {!hasTariffConfig && (
                <div style={{ marginTop: "0.7rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                  Tariffs and energy mix are not configured yet. CEI will use kWh-only analytics until
                  these values are set.
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Environment & safety card */}
      <section>
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.4rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <span>Environment & safety</span>
            <span className="cei-pill cei-pill-neutral">
              {envLabel} ({appEnvironment})
            </span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.7 }}>
            {envBlurb}
          </div>
          <div style={{ marginTop: "0.6rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              <li>
                <strong>DEV:</strong> point CSV uploads and tests here; break things safely before
                promoting changes.
              </li>
              <li>
                <strong>PILOT/STAGING:</strong> use for demos and early customer pilots; data should be
                realistic but not yet contract-critical.
              </li>
              <li>
                <strong>PROD:</strong> treat as the system of record; align alerts, reports, and exports
                with contractual expectations.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Feature gating explainer */}
      <section>
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            What your plan controls
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.7 }}>
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              <li>
                <strong>Core (always on):</strong> CSV ingestion, per-site dashboards, basic trend charts.
              </li>
              <li>
                <strong>Starter and above:</strong> Alerts, 7-day reports, and per-site insight cards.
              </li>
              <li>
                <strong>Future tiers:</strong> organization-level baselines, ML-based forecasting, and custom
                export pipelines.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Account;
