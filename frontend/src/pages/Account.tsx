// frontend/src/pages/Account.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getAccountMe,
  deleteAccount,
  startCheckout,
  openBillingPortal,
  listOrgInvites,
  createOrgInvite,
  revokeOrgInvite,
  extendOrgInvite,
  // ✅ Offboard + Leave UI wiring
  offboardOrg,
  leaveOrg,
} from "../services/api";

import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import type { AccountMe, OrganizationSummary } from "../types/auth";

// Read environment once from Vite
const rawEnv = (import.meta as any).env || {};
const appEnvironment: string =
  (rawEnv.VITE_ENVIRONMENT as string | undefined) || "dev";

function getEnvironmentLabel(env: string, t: (k: string, o?: any) => string): string {
  const key = env.toLowerCase();
  if (key === "prod" || key === "production") return t("account.environment.labels.production");
  if (key === "pilot" || key === "staging") return t("account.environment.labels.pilot");
  return t("account.environment.labels.development");
}

function getEnvironmentBlurb(env: string, t: (k: string, o?: any) => string): string {
  const key = env.toLowerCase();
  if (key === "prod" || key === "production") {
    return t("account.environment.blurbs.production");
  }
  if (key === "pilot" || key === "staging") {
    return t("account.environment.blurbs.pilot");
  }
  return t("account.environment.blurbs.development");
}

function normalizeRole(raw: any): "owner" | "member" | null {
  const v = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (v === "owner") return "owner";
  if (v === "member") return "member";
  return null;
}

function roleLabel(
  t: (k: string, o?: any) => string,
  role: string | null | undefined
): string {
  const r = normalizeRole(role);
  if (r === "owner") return t("account.roles.owner");
  if (r === "member") return t("account.roles.member");
  return "—";
}

function parsePrimarySources(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter((x) => x.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

// Decimal/string-safe numeric parsing (align with Reports.tsx behavior)
const asNumber = (v: any): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

type UiAccount = AccountMe & {
  role?: string | null;
  org: OrganizationSummary | null;

  subscription_plan_key?: string | null;
  subscription_status?: string | null;
  enable_alerts?: boolean | null;
  enable_reports?: boolean | null;

  currency_code?: string | null;
  electricity_price_per_kwh?: number | string | null;
  gas_price_per_kwh?: number | string | null;
  primary_energy_sources?: string[] | string | null;
};

// ---- Invites (owner-only) ----
type OrgInvite = {
  id: number;

  organization_id?: number | null;
  org_id?: number | null;

  email?: string | null;
  role?: string | null;

  is_active?: boolean | null;

  accepted_at?: string | null;
  accepted_user_id?: number | null;

  used_at?: string | null;
  used_by_user_id?: number | null;

  revoked_at?: string | null;
  created_at?: string | null;
  created_by_user_id?: number | null;

  expires_at?: string | null;

  // backend convenience flags (optional)
  status?: string | null;
  is_accepted?: boolean | null;
  is_expired?: boolean | null;
  can_accept?: boolean | null;
  can_revoke?: boolean | null;
  can_extend?: boolean | null;
};

function safeString(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim().length ? s : null;
}

function formatMaybeIso(ts?: string | null): string {
  const v = safeString(ts);
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function buildInviteLink(token: string): string {
  // Your login page already expects invite=... and handles the accept/signup flow.
  const origin = window.location.origin;
  return `${origin}/login?invite=${encodeURIComponent(token)}`;
}

/**
 * Status column requirement:
 * - Show ONLY "Active" (green) or "Revoked" (red)
 *
 * Action requirement (mutually exclusive):
 * - If Active: show ONLY Revoke (red)
 * - If Revoked: show ONLY Extend (green)
 */
type InviteUiStatus = "Active" | "Revoked";

/**
 * Stop using is_active as the “active vs revoked” source of truth.
 * Server is canonical: use status + can_revoke when present.
 */
function inviteUiStatus(inv: OrgInvite): InviteUiStatus {
  const status = safeString(inv.status)?.toLowerCase();

  // UI requirement remains ONLY Active/Revoked.
  // Treat "active" and "accepted" as "Active", and only "revoked" as "Revoked".
  if (status === "revoked") return "Revoked";
  if (status === "active" || status === "accepted") return "Active";

  // Fallback: if status missing, infer from can_revoke (server actionability),
  // not from is_active (which is no longer canonical for UI state).
  if (inv.can_revoke === true) return "Active";
  return "Revoked";
}

function statusPillClass(status: InviteUiStatus): string {
  // Preserve your existing class names
  if (status === "Active") return "cei-pill cei-pill-good"; // green
  return "cei-pill cei-pill-danger"; // red
}

function normalizeInviteRole(v: any): "owner" | "member" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "owner" ? "owner" : "member";
}

// --------- Small refactor helpers (keep behavior identical) ----------
function getOrgFromAccount(data: any): OrganizationSummary | null {
  return (data as any)?.org ?? (data as any)?.organization ?? null;
}

function getRoleFromAccount(data: any): any {
  return (data as any)?.role ?? (data as any)?.user_role ?? null;
}

function toUiError(e: any, fallback: string): string {
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }
  if (typeof e?.message === "string" && e.message.trim()) return e.message;
  return fallback;
}

const Account: React.FC = () => {
  const { t } = useTranslation();

  const [account, setAccount] = useState<UiAccount | null>(null);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [accountWarning, setAccountWarning] = useState<string | null>(null);

  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  // Org actions state (Offboard + Leave)
  const [orgActionMessage, setOrgActionMessage] = useState<string | null>(null);
  const [offboardingSoft, setOffboardingSoft] = useState(false);
  const [offboardingNuke, setOffboardingNuke] = useState(false);
  const [leavingOrg, setLeavingOrg] = useState(false);

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

  // Track Extend per-row
  const [extendingInviteId, setExtendingInviteId] = useState<number | null>(null);

  const envLabel = getEnvironmentLabel(appEnvironment, t);
  const envBlurb = getEnvironmentBlurb(appEnvironment, t);

  const refreshAccount = async () => {
    setLoading(true);
    setError(null);
    setAccountWarning(null);
    try {
      const data = await getAccountMe();

      const org = getOrgFromAccount(data);
      const roleRaw = getRoleFromAccount(data);

      setAccount({
        ...(data as UiAccount),
        org,
        role: normalizeRole(roleRaw) ?? roleRaw,
      });
    } catch (e: any) {
      setAccount(null);
      setAccountWarning(
        toUiError(
          e,
          t("account.warnings.accountUnavailable")
        )
      );
    } finally {
      setLoading(false);
    }
  };

  // Hard reset owner-only org UI state (invites + messages)
  const resetOrgScopedUi = () => {
    setInvites([]);
    setInvitesError(null);
    setInvitesLoading(false);

    setCreatedInviteLink(null);
    setCreatedInviteNote(null);
    setExtendingInviteId(null);

    setInviteEmail("");
    setInviteRole("member");
    setInviteDays(7);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadAccount() {
      setLoading(true);
      setError(null);
      setAccountWarning(null);

      try {
        const data = await getAccountMe();
        if (!isMounted) return;

        const org = getOrgFromAccount(data);
        const roleRaw = getRoleFromAccount(data);

        setAccount({
          ...(data as UiAccount),
          org,
          role: normalizeRole(roleRaw) ?? roleRaw,
        });
      } catch (e: any) {
        if (!isMounted) return;

        setAccount(null);
        setAccountWarning(
          toUiError(
            e,
            t("account.warnings.accountUnavailable")
          )
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const org: OrganizationSummary | null = account?.org ?? null;

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
        return t("account.plan.labels.starter");
      case "cei-growth":
        return t("account.plan.labels.growth");
      default:
        return t("account.plan.labels.custom");
    }
  })();

  const subscriptionStatus =
    orgLike?.subscription_status ||
    accountAny.subscription_status ||
    t("account.subscription.status.notConnected");

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

  const isOwner = useMemo(
    () => normalizeRole(account?.role) === "owner",
    [account?.role]
  );

  // Owner-only: subscription management
  const handleStartStarterCheckout = async () => {
    setBillingMessage(null);

    if (!isOwner) {
      setBillingMessage(t("account.errors.ownerOnlyBilling"));
      return;
    }

    setStartingCheckout(true);
    try {
      const { url } = await startCheckout("cei-starter");

      if (url) {
        window.location.href = url;
        return;
      }

      setBillingMessage(t("account.billing.notConfiguredCheckout"));
    } catch (err) {
      console.error("Failed to start checkout:", err);
      setBillingMessage(t("account.billing.checkoutFailed"));
    } finally {
      setStartingCheckout(false);
    }
  };

  // Owner-only: subscription management
  const handleOpenPortal = async () => {
    setBillingMessage(null);

    if (!isOwner) {
      setBillingMessage(t("account.errors.ownerOnlyBilling"));
      return;
    }

    setOpeningPortal(true);
    try {
      const { url } = await openBillingPortal();

      if (url) {
        window.location.href = url;
        return;
      }

      setBillingMessage(t("account.billing.portalNotAvailable"));
    } catch (err) {
      console.error("Failed to open billing portal:", err);
      setBillingMessage(t("account.billing.portalFailed"));
    } finally {
      setOpeningPortal(false);
    }
  };

  // Owner-only: delete account
  const handleDeleteAccount = async () => {
    if (!isOwner) {
      setError(t("account.errors.ownerOnlyDelete"));
      return;
    }

    if (!window.confirm(t("account.confirm.deleteAccount"))) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      setDeleteSuccess(true);
    } catch (e: any) {
      setError(toUiError(e, t("account.errors.deleteFailed")));
    } finally {
      setDeleting(false);
    }
  };

  // Leave org (detaches only YOU)
  const handleLeaveOrg = async () => {
    setOrgActionMessage(null);
    setError(null);

    if (!orgLike?.id) {
      setOrgActionMessage(t("account.org.noOrgAttached"));
      return;
    }

    const ok = window.confirm(t("account.confirm.leaveOrg"));
    if (!ok) return;

    setLeavingOrg(true);
    try {
      await leaveOrg();

      // Keep UI consistent: refresh account + clear owner-only panels state
      resetOrgScopedUi();
      await refreshAccount();

      setOrgActionMessage(t("account.org.leftOrg"));
    } catch (e: any) {
      setOrgActionMessage(toUiError(e, t("account.errors.leaveOrgFailed")));
    } finally {
      setLeavingOrg(false);
    }
  };

  // Soft offboard (company wants out, keep org record)
  const handleSoftOffboard = async () => {
    setOrgActionMessage(null);
    setError(null);

    if (!isOwner) {
      setOrgActionMessage(t("account.errors.ownerOnlyOffboard"));
      return;
    }
    if (!orgLike?.id) {
      setOrgActionMessage(t("account.org.noOrgAttached"));
      return;
    }

    const ok = window.confirm(t("account.confirm.softOffboard"));
    if (!ok) return;

    setOffboardingSoft(true);
    try {
      await offboardOrg({ mode: "soft" });

      resetOrgScopedUi();
      await refreshAccount();

      setOrgActionMessage(t("account.org.softOffboardComplete"));

      // Clean break: you are likely detached; avoid zombie UI
      localStorage.removeItem("cei_token");
      window.location.href = "/login?reason=org_offboarded";
    } catch (e: any) {
      setOrgActionMessage(toUiError(e, t("account.errors.softOffboardFailed")));
    } finally {
      setOffboardingSoft(false);
    }
  };

  // Nuke offboard (delete org + org-scoped data)
  const handleNukeOffboard = async () => {
    setOrgActionMessage(null);
    setError(null);

    if (!isOwner) {
      setOrgActionMessage(t("account.errors.ownerOnlyOffboard"));
      return;
    }

    const orgId = orgLike?.id;
    const orgName = safeString(orgLike?.name) || t("account.org.thisOrg");
    if (!orgId) {
      setOrgActionMessage(t("account.org.noOrgAttached"));
      return;
    }

    const typed = window.prompt(
      t("account.confirm.nukePrompt", { orgName })
    );
    if ((typed || "").trim() !== orgName) {
      setOrgActionMessage(t("account.org.nukeCancelled"));
      return;
    }

    setOffboardingNuke(true);
    try {
      await offboardOrg({ mode: "nuke", org_id: Number(orgId) });

      resetOrgScopedUi();
      await refreshAccount();

      setOrgActionMessage(t("account.org.nukeComplete"));

      // Clean break: token is not meaningful after destructive delete
      localStorage.removeItem("cei_token");
      window.location.href = "/login?reason=org_offboarded";
    } catch (e: any) {
      setOrgActionMessage(toUiError(e, t("account.errors.nukeFailed")));
    } finally {
      setOffboardingNuke(false);
    }
  };

  // Pricing context (tariffs & energy mix) – unified org/root view
  const currencyCode: string =
    typeof orgLike?.currency_code === "string"
      ? orgLike.currency_code
      : typeof accountAny.currency_code === "string"
      ? accountAny.currency_code
      : "—";

  // Decimal-safe: accept number OR string from backend
  const electricityPrice: number | null =
    asNumber(orgLike?.electricity_price_per_kwh) ??
    asNumber(accountAny.electricity_price_per_kwh) ??
    null;

  const gasPrice: number | null =
    asNumber(orgLike?.gas_price_per_kwh) ??
    asNumber(accountAny.gas_price_per_kwh) ??
    null;

  const primarySources: string[] = parsePrimarySources(
    orgLike?.primary_energy_sources ?? accountAny.primary_energy_sources
  );

  // Make tariff config detection reliable (avoid false negatives)
  const hasTariffConfig =
    (electricityPrice !== null && Number.isFinite(electricityPrice)) ||
    (gasPrice !== null && Number.isFinite(gasPrice)) ||
    (currencyCode && currencyCode !== "—") ||
    (primarySources && primarySources.length > 0);

  const formatPrice = (value: number | null) =>
    typeof value === "number" ? value.toFixed(4) : t("account.tariffs.notConfigured");

  // ---- Invites actions (owner-only) ----
  const loadInvites = async () => {
    setInvitesError(null);
    setInvitesLoading(true);
    try {
      const res = await listOrgInvites();

      // Make list parsing resilient:
      // - backend returns array
      // - backend returns { value: [...], Count: n }
      const list = Array.isArray(res) ? res : (res as any)?.value;

      setInvites(Array.isArray(list) ? ((list as any) as OrgInvite[]) : []);
    } catch (e: any) {
      setInvitesError(toUiError(e, t("account.invites.errors.loadFailed")));
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
      setInvitesError(t("account.invites.errors.ownerOnly"));
      return;
    }

    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      setInvitesError(t("account.invites.errors.invalidEmail"));
      return;
    }

    const daysRaw = Number.isFinite(inviteDays) ? inviteDays : 7;
    const days = Math.max(1, Math.min(30, Math.floor(daysRaw)));

    setCreatingInvite(true);
    try {
      const res = await createOrgInvite({
        email,
        role: inviteRole,
        expires_in_days: days,
      });

      const token = safeString((res as any)?.token);
      if (!token) {
        setCreatedInviteNote(t("account.invites.notes.createdNoToken"));
      } else {
        const link = buildInviteLink(token);
        setCreatedInviteLink(link);
        setCreatedInviteNote(t("account.invites.notes.linkGenerated"));
      }

      await loadInvites();
      setInviteEmail("");
    } catch (e: any) {
      setInvitesError(toUiError(e, t("account.invites.errors.createFailed")));
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    setInvitesError(null);
    if (!isOwner) {
      setInvitesError(t("account.invites.errors.ownerOnly"));
      return;
    }

    const ok = window.confirm(t("account.confirm.revokeInvite"));
    if (!ok) return;

    try {
      await revokeOrgInvite(inviteId);
      await loadInvites();
    } catch (e: any) {
      setInvitesError(toUiError(e, t("account.invites.errors.revokeFailed")));
    }
  };

  /**
   * Extend = POST /org/invites/{id}/extend
   * - If invite is unaccepted: backend returns fresh one-time token (show link)
   * - If invite is already accepted: backend returns no token (just re-enable access)
   */
  const handleExtendInvite = async (inv: OrgInvite) => {
    setInvitesError(null);
    setCreatedInviteLink(null);
    setCreatedInviteNote(null);

    if (!isOwner) {
      setInvitesError(t("account.invites.errors.ownerOnly"));
      return;
    }

    const daysRaw = Number.isFinite(inviteDays) ? inviteDays : 7;
    const days = Math.max(1, Math.min(30, Math.floor(daysRaw)));

    // Optional role update on extend: keep whatever role the row currently has
    const role = normalizeInviteRole(inv.role);

    setExtendingInviteId(inv.id);
    try {
      const res = await extendOrgInvite(inv.id, { expires_in_days: days, role });

      const token = safeString((res as any)?.token);
      if (token) {
        const link = buildInviteLink(token);
        setCreatedInviteLink(link);
        setCreatedInviteNote(t("account.invites.notes.extendedNewLink"));
      } else {
        setCreatedInviteNote(t("account.invites.notes.extendedNoLink"));
      }

      await loadInvites();
    } catch (e: any) {
      setInvitesError(toUiError(e, t("account.invites.errors.extendFailed")));
    } finally {
      setExtendingInviteId(null);
    }
  };

  const handleCopy = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCreatedInviteNote(t("account.invites.notes.copied"));
      setTimeout(() => setCreatedInviteNote(t("account.invites.notes.linkGenerated")), 1500);
    } catch {
      setCreatedInviteNote(t("account.invites.notes.copyFailed"));
    }
  };

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
            {t("account.header.title")}
          </h1>
          <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
            {t("account.header.subtitle")}
          </p>
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", textAlign: "right" }}>
          {org?.name && (
            <div>
              {t("account.header.orgLabel")} <strong>{org.name}</strong>
            </div>
          )}
          <div>
            {t("account.header.roleLabel")} <strong>{roleLabel(t, account?.role)}</strong>
          </div>
          <div style={{ marginTop: "0.2rem" }}>
            <span>
              {t("account.header.planLabel")} <strong>{planLabel}</strong>
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

      {/* Error banner */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      {/* Org actions message */}
      {orgActionMessage && (
        <section style={{ marginTop: "0.75rem" }}>
          <div
            style={{
              padding: "0.55rem 0.75rem",
              borderRadius: "0.6rem",
              border: "1px solid rgba(148, 163, 184, 0.25)",
              background: "rgba(15, 23, 42, 0.55)",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {orgActionMessage}
          </div>
        </section>
      )}

      {/* Top row: Profile + Subscription */}
      <section className="dashboard-row">
        {/* Profile card */}
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            {t("account.profile.title")}
          </div>
          {loading ? (
            <div style={{ padding: "0.8rem 0.2rem", display: "flex", justifyContent: "center" }}>
              <LoadingSpinner />
            </div>
          ) : deleteSuccess ? (
            <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
              {t("account.profile.deletedMessage")}
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
                <div>
                  <strong>{t("account.profile.emailLabel")}</strong> {account?.email || <span>—</span>}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>{t("account.profile.nameLabel")}</strong>{" "}
                  {account?.full_name || <span>—</span>}
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
                  {t("account.profile.readOnlyNote")}
                </div>

                {/* Owner-only delete */}
                {isOwner ? (
                  <button
                    type="button"
                    className="cei-pill-danger"
                    onClick={handleDeleteAccount}
                    disabled={deleting || deleteSuccess}
                    title={t("account.labels.ownerOnly")}
                  >
                    {deleting ? t("account.profile.deleting") : t("account.profile.deleteButton")}
                  </button>
                ) : (
                  <span className="cei-pill cei-pill-neutral" title={t("account.labels.ownerOnly")}>
                    {t("account.labels.ownerOnly")}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Subscription card */}
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            {t("account.subscription.title")}
          </div>

          <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
            <div>
              <strong>{t("account.subscription.currentPlan")}</strong> {planLabel}
            </div>
            <div style={{ marginTop: "0.2rem" }}>
              <strong>{t("account.subscription.status")}</strong> {subscriptionStatus}
            </div>
          </div>

          <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            <div>
              <strong>{t("account.subscription.alerts")}</strong>{" "}
              {alertsEnabled ? t("account.labels.enabled") : t("account.labels.disabled")}
            </div>
            <div style={{ marginTop: "0.1rem" }}>
              <strong>{t("account.subscription.reports")}</strong>{" "}
              {reportsEnabled ? t("account.labels.enabled") : t("account.labels.disabled")}
            </div>
          </div>

          <div style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.6 }}>
              <li>{t("account.subscription.bullets.starter")}</li>
              <li>{t("account.subscription.bullets.growth")}</li>
            </ul>
          </div>

          {/* Owner-only subscription management */}
          {!isOwner && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.6rem",
                border: "1px solid rgba(148, 163, 184, 0.25)",
                background: "rgba(15, 23, 42, 0.55)",
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
              }}
            >
              <strong style={{ color: "var(--cei-text-main)" }}>
                {t("account.labels.ownerOnly")}:
              </strong>{" "}
              {t("account.subscription.ownerOnlyBlurb")}
            </div>
          )}

          <div style={{ marginTop: "0.9rem", display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
            <button
              type="button"
              className="cei-btn cei-btn-primary"
              onClick={handleStartStarterCheckout}
              disabled={!isOwner || startingCheckout}
              title={!isOwner ? t("account.labels.ownerOnly") : undefined}
              style={{
                cursor: !isOwner ? "not-allowed" : "pointer",
                opacity: !isOwner ? 0.55 : 1,
              }}
            >
              {startingCheckout ? t("account.subscription.redirecting") : t("account.subscription.upgrade")}
            </button>
            <button
              type="button"
              className="cei-btn cei-btn-ghost"
              onClick={handleOpenPortal}
              disabled={!isOwner || openingPortal}
              title={!isOwner ? t("account.labels.ownerOnly") : undefined}
              style={{
                cursor: !isOwner ? "not-allowed" : "pointer",
                opacity: !isOwner ? 0.55 : 1,
              }}
            >
              {openingPortal ? t("account.subscription.opening") : t("account.subscription.manage")}
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

      {/* Organization controls (Offboard + Leave) */}
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
            <span>{t("account.orgControls.title")}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              {t("account.orgControls.subtitle")}
            </span>
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.6 }}>
            <div>
              <strong>{t("account.orgControls.currentOrg")}</strong>{" "}
              {safeString(orgLike?.name) ? (
                <span>
                  {String(orgLike.name)} (id={String(orgLike.id)})
                </span>
              ) : (
                <span>—</span>
              )}
            </div>
            <div style={{ marginTop: "0.2rem" }}>
              <strong>{t("account.orgControls.role")}</strong> {roleLabel(t, account?.role)}
            </div>
          </div>

          <div style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
            <button
              type="button"
              className="cei-btn cei-btn-ghost"
              onClick={handleLeaveOrg}
              disabled={leavingOrg || !orgLike?.id}
              title={!orgLike?.id ? t("account.orgControls.noOrgAttachedTitle") : undefined}
              style={{
                cursor: leavingOrg || !orgLike?.id ? "not-allowed" : "pointer",
                opacity: leavingOrg || !orgLike?.id ? 0.55 : 1,
              }}
            >
              {leavingOrg ? t("account.orgControls.leaving") : t("account.orgControls.leave")}
            </button>

            <button
              type="button"
              className="cei-pill-danger"
              onClick={handleSoftOffboard}
              disabled={!isOwner || offboardingSoft || !orgLike?.id}
              title={!isOwner ? t("account.labels.ownerOnly") : undefined}
              style={{
                cursor: !isOwner || offboardingSoft || !orgLike?.id ? "not-allowed" : "pointer",
                opacity: !isOwner || offboardingSoft || !orgLike?.id ? 0.55 : 1,
              }}
            >
              {offboardingSoft ? t("account.orgControls.offboarding") : t("account.orgControls.offboard")}
            </button>

            <button
              type="button"
              className="cei-pill-danger"
              onClick={handleNukeOffboard}
              disabled={!isOwner || offboardingNuke || !orgLike?.id}
              title={!isOwner ? t("account.labels.ownerOnly") : t("account.orgControls.permanentDeleteTitle")}
              style={{
                cursor: !isOwner || offboardingNuke || !orgLike?.id ? "not-allowed" : "pointer",
                opacity: !isOwner || offboardingNuke || !orgLike?.id ? 0.55 : 1,
              }}
            >
              {offboardingNuke ? t("account.orgControls.nuking") : t("account.orgControls.permanentDelete")}
            </button>
          </div>

          <div style={{ marginTop: "0.65rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
            {t("account.orgControls.footer")}
          </div>
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
            <span>{t("account.invites.title")}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              {t("account.invites.subtitle")}
            </span>
          </div>

          {!isOwner ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("account.invites.notOwnerBlurb")}
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
                  alignItems: "start",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                    {t("account.invites.form.emailLabel")}
                  </label>
                  <input
                    type="email"
                    placeholder={t("account.invites.form.emailPlaceholder")}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                    {t("account.invites.form.roleLabel")}
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(((e.target.value as any) || "member") as any)}
                    style={{ width: "100%" }}
                  >
                    <option value="member">{t("account.roles.member")}</option>
                    <option value="owner">{t("account.roles.owner")}</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                    {t("account.invites.form.expiresLabel")}
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

                <div style={{ paddingTop: "1.35rem" }}>
                  <button
                    type="button"
                    className="cei-btn cei-btn-primary"
                    onClick={handleCreateInvite}
                    disabled={creatingInvite}
                    style={{ height: "2.35rem" }}
                  >
                    {creatingInvite ? t("account.invites.form.creating") : t("account.invites.form.generate")}
                  </button>
                </div>

                <div
                  style={{
                    gridColumn: "1 / -1",
                    marginTop: "0.25rem",
                    fontSize: "0.74rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  {t("account.invites.form.emailBoundNote")}
                </div>
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
                        <strong style={{ color: "var(--cei-text-main)" }}>
                          {t("account.invites.created.linkLabel")}
                        </strong>{" "}
                        <span style={{ wordBreak: "break-all" }}>{createdInviteLink}</span>
                      </div>
                      <button
                        type="button"
                        className="cei-btn cei-btn-ghost"
                        onClick={() => handleCopy(createdInviteLink)}
                      >
                        {t("account.invites.created.copy")}
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
                  {t("account.invites.list.helper")}
                </div>
                <button
                  type="button"
                  className="cei-btn cei-btn-ghost"
                  onClick={loadInvites}
                  disabled={invitesLoading}
                >
                  {invitesLoading ? t("account.invites.list.refreshing") : t("account.invites.list.refresh")}
                </button>
              </div>

              <div style={{ marginTop: "0.6rem" }}>
                {invitesLoading ? (
                  <div style={{ padding: "0.5rem 0.2rem", display: "flex", justifyContent: "center" }}>
                    <LoadingSpinner />
                  </div>
                ) : invites.length === 0 ? (
                  <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                    {t("account.invites.list.empty")}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="cei-table" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>{t("account.invites.table.id")}</th>
                          <th>{t("account.invites.table.email")}</th>
                          <th>{t("account.invites.table.role")}</th>
                          <th>{t("account.invites.table.status")}</th>
                          <th>{t("account.invites.table.expires")}</th>
                          <th>{t("account.invites.table.created")}</th>
                          <th>{t("account.invites.table.accepted")}</th>
                          <th style={{ textAlign: "right" }}>{t("account.invites.table.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((inv) => {
                          const status = inviteUiStatus(inv);

                          // Actions are strictly driven by Active vs Revoked.
                          const canRevoke = status === "Active";

                          const acceptedTs =
                            safeString(inv.accepted_at) ||
                            safeString(inv.used_at) ||
                            null;

                          return (
                            <tr key={inv.id}>
                              <td>{inv.id}</td>
                              <td>
                                {safeString(inv.email) || (
                                  <span style={{ color: "var(--cei-text-muted)" }}>—</span>
                                )}
                              </td>
                              <td>{safeString(inv.role) || "member"}</td>

                              {/* Status: ONLY Active/Revoked */}
                              <td>
                                <span className={statusPillClass(status)} style={{ cursor: "default" }}>
                                  {status === "Active"
                                    ? t("account.invites.status.active")
                                    : t("account.invites.status.revoked")}
                                </span>
                              </td>

                              <td>{formatMaybeIso(inv.expires_at)}</td>
                              <td>{formatMaybeIso(inv.created_at)}</td>
                              <td>{formatMaybeIso(acceptedTs)}</td>

                              {/* Actions: STRICTLY MUTUALLY EXCLUSIVE */}
                              <td style={{ textAlign: "right" }}>
                                <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
                                  {canRevoke ? (
                                    <button
                                      type="button"
                                      className="cei-pill-danger"
                                      onClick={() => handleRevokeInvite(inv.id)}
                                      title={t("account.invites.actions.revokeTitle")}
                                      style={{ minWidth: 92 }}
                                    >
                                      {t("account.invites.actions.revoke")}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="cei-pill cei-pill-good"
                                      onClick={() => handleExtendInvite(inv)}
                                      disabled={extendingInviteId === inv.id}
                                      title={t("account.invites.actions.extendTitle")}
                                      style={{
                                        minWidth: 92,
                                        cursor: extendingInviteId === inv.id ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      {extendingInviteId === inv.id
                                        ? t("account.invites.actions.extending")
                                        : t("account.invites.actions.extend")}
                                    </button>
                                  )}
                                </div>
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
            <span>{t("account.tariffs.title")}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              {t("account.tariffs.subtitle")}
            </span>
          </div>

          {!account && !hasTariffConfig ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("account.tariffs.accountUnavailable")}
            </div>
          ) : !org && !hasTariffConfig ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("account.tariffs.noOrg")}
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.6 }}>
                <div>
                  <strong>{t("account.tariffs.currency")}</strong> {currencyCode}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>{t("account.tariffs.electricity")}</strong> {formatPrice(electricityPrice)}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>{t("account.tariffs.gas")}</strong> {formatPrice(gasPrice)}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>{t("account.tariffs.primarySources")}</strong>{" "}
                  {primarySources && primarySources.length > 0 ? (
                    primarySources.join(", ")
                  ) : (
                    <span>{t("account.tariffs.notSpecified")}</span>
                  )}
                </div>
              </div>

              {!hasTariffConfig && (
                <div style={{ marginTop: "0.7rem", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
                  {t("account.tariffs.notConfiguredNote")}
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
            <span>{t("account.environment.title")}</span>
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
                <strong>{t("account.environment.bullets.dev.label")}</strong>{" "}
                {t("account.environment.bullets.dev.text")}
              </li>
              <li>
                <strong>{t("account.environment.bullets.pilot.label")}</strong>{" "}
                {t("account.environment.bullets.pilot.text")}
              </li>
              <li>
                <strong>{t("account.environment.bullets.prod.label")}</strong>{" "}
                {t("account.environment.bullets.prod.text")}
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Feature gating explainer */}
      <section>
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            {t("account.planControls.title")}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", lineHeight: 1.7 }}>
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              <li>
                <strong>{t("account.planControls.core.label")}</strong>{" "}
                {t("account.planControls.core.text")}
              </li>
              <li>
                <strong>{t("account.planControls.starter.label")}</strong>{" "}
                {t("account.planControls.starter.text")}
              </li>
              <li>
                <strong>{t("account.planControls.future.label")}</strong>{" "}
                {t("account.planControls.future.text")}
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Account;
