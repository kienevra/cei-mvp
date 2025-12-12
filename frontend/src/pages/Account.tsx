// frontend/src/pages/Account.tsx
import React, { useEffect, useState } from "react";
import {
  getAccountMe,
  deleteAccount,
  startCheckout,
  openBillingPortal,
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
    // backend may return "electricity,gas"
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

  // Root-level plan flags that /account/me may expose
  subscription_plan_key?: string | null;
  subscription_status?: string | null;
  enable_alerts?: boolean | null;
  enable_reports?: boolean | null;

  // Optional pricing context at account level (forward-compatible)
  currency_code?: string | null;
  electricity_price_per_kwh?: number | null;
  gas_price_per_kwh?: number | null;
  primary_energy_sources?: string[] | null;
};

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

        const roleRaw =
          (data as any)?.role ?? (data as any)?.user_role ?? null;

        setAccount({
          ...(data as UiAccount),
          org,
          role: normalizeRole(roleRaw) ?? roleRaw,
        });
      } catch (e: any) {
        if (!isMounted) return;

        // Don’t brick the whole page if /account/me is flaky.
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

  const handleStartStarterCheckout = async () => {
    setBillingMessage(null);
    setStartingCheckout(true);
    try {
      const { url } = await startCheckout("cei-starter");

      if (url) {
        window.location.href = url;
        return;
      }

      // Stripe / billing not configured for this environment
      setBillingMessage(
        "Billing is not fully configured for this environment. No live checkout page is available."
      );
    } catch (err) {
      console.error("Failed to start checkout:", err);
      setBillingMessage(
        "Could not start checkout. Please retry or contact your CEI admin."
      );
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
      setBillingMessage(
        "Could not open the billing portal. Please retry or contact your CEI admin."
      );
    } finally {
      setOpeningPortal(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("Really delete your account? This cannot be undone.")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      setDeleteSuccess(true);
      // keep behavior consistent; don’t force redirect here
    } catch (e: any) {
      setError(
        e?.response?.data?.detail || e?.message || "Failed to delete account."
      );
    } finally {
      setDeleting(false);
    }
  };

  const envLabel = getEnvironmentLabel(appEnvironment);
  const envBlurb = getEnvironmentBlurb(appEnvironment);

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
          <h1
            style={{
              fontSize: "1.3rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Account & Billing
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Manage your CEI profile, organization, and subscription. This is the
            control panel for turning a single deployment into a real SaaS
            footprint.
          </p>
        </div>

        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            textAlign: "right",
          }}
        >
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
          <div
            className="cei-pill-muted"
            style={{
              padding: "0.55rem 0.75rem",
              fontSize: "0.8rem",
            }}
          >
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
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.4rem",
            }}
          >
            Profile
          </div>
          {loading ? (
            <div
              style={{
                padding: "0.8rem 0.2rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <LoadingSpinner />
            </div>
          ) : deleteSuccess ? (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Your account has been deleted on this environment. You may need to
              log out manually or clear your token in local storage.
            </div>
          ) : (
            <>
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                <div>
                  <strong>Email:</strong>{" "}
                  {account?.email || <span>—</span>}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>Name:</strong>{" "}
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
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  For now this is read-only. In a production deployment, this is
                  where you’d manage passwords, SSO, and org membership.
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
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.4rem",
            }}
          >
            Subscription
          </div>

          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <div>
              <strong>Current plan:</strong> {planLabel}
            </div>
            <div style={{ marginTop: "0.2rem" }}>
              <strong>Status:</strong> {subscriptionStatus}
            </div>
          </div>

          {/* Feature flags summary */}
          <div
            style={{
              marginTop: "0.4rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <div>
              <strong>Alerts:</strong> {alertsEnabled ? "Enabled" : "Disabled"}
            </div>
            <div style={{ marginTop: "0.1rem" }}>
              <strong>Reports:</strong>{" "}
              {reportsEnabled ? "Enabled" : "Disabled"}
            </div>
          </div>

          <div
            style={{
              marginTop: "0.8rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.1rem",
                lineHeight: 1.6,
              }}
            >
              <li>Starter includes alerts, reports, and multi-site analytics.</li>
              <li>
                Growth (later) adds more orgs, longer history, and SLA-backed
                support.
              </li>
            </ul>
          </div>

          <div
            style={{
              marginTop: "0.9rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.6rem",
            }}
          >
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
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Read-only. Used for cost analytics and savings estimates.
            </span>
          </div>

          {!account && !hasTariffConfig ? (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Account details are not available right now. Tariff and energy mix
              data will appear here once your account context loads successfully.
            </div>
          ) : !org && !hasTariffConfig ? (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No organization is associated with this account yet. Tariff and
              energy mix data will appear here once your org is configured.
            </div>
          ) : (
            <>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                  lineHeight: 1.6,
                }}
              >
                <div>
                  <strong>Currency:</strong> {currencyCode}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <strong>Electricity price (per kWh):</strong>{" "}
                  {formatPrice(electricityPrice)}
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
                <div
                  style={{
                    marginTop: "0.7rem",
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Tariffs and energy mix are not configured yet. CEI will use
                  kWh-only analytics until these values are set.
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
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              lineHeight: 1.7,
            }}
          >
            {envBlurb}
          </div>
          <div
            style={{
              marginTop: "0.6rem",
              fontSize: "0.78rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.1rem",
              }}
            >
              <li>
                <strong>DEV:</strong> point CSV uploads and tests here; break
                things safely before promoting changes.
              </li>
              <li>
                <strong>PILOT/STAGING:</strong> use for demos and early
                customer pilots; data should be realistic but not yet
                contract-critical.
              </li>
              <li>
                <strong>PROD:</strong> treat as the system of record; align
                alerts, reports, and exports with contractual expectations.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Feature gating explainer */}
      <section>
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.4rem",
            }}
          >
            What your plan controls
          </div>
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              lineHeight: 1.7,
            }}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.1rem",
              }}
            >
              <li>
                <strong>Core (always on):</strong> CSV ingestion, per-site
                dashboards, basic trend charts.
              </li>
              <li>
                <strong>Starter and above:</strong> Alerts, 7-day reports, and
                per-site insight cards.
              </li>
              <li>
                <strong>Future tiers:</strong> organization-level baselines,
                ML-based forecasting, and custom export pipelines.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Account;
