import React, { useEffect, useState } from "react";
import {
  getAccountMe,
  deleteAccount,
  startCheckout,
  openBillingPortal,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type OrgInfo = {
  id?: number | string;
  name?: string;
  plan_key?: string | null;
  subscription_plan_key?: string | null;
  subscription_status?: string | null;
  enable_alerts?: boolean | null;
  enable_reports?: boolean | null;
  [key: string]: any;
};

type AccountMe = {
  email?: string;
  full_name?: string | null;
  role?: string | null;
  org?: OrgInfo | null;
  organization?: OrgInfo | null;
  subscription_plan_key?: string | null;
  enable_alerts?: boolean | null;
  enable_reports?: boolean | null;
  subscription_status?: string | null;
  [key: string]: any;
};

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

const Account: React.FC = () => {
  const [account, setAccount] = useState<AccountMe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      try {
        const data = await getAccountMe();
        if (!isMounted) return;

        const org =
          (data?.org as OrgInfo | null | undefined) ??
          (data?.organization as OrgInfo | null | undefined) ??
          null;

        setAccount({
          email: data?.email,
          full_name: data?.full_name ?? (data as any)?.name ?? null,
          role: data?.role ?? (data as any)?.user_role ?? null,
          org,
          ...data,
        });
      } catch (e: any) {
        if (!isMounted) return;
        setError(
          e?.response?.data?.detail ||
            e?.message ||
            "Failed to load account details."
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

  const org =
    account?.org ||
    (account?.organization as OrgInfo | null | undefined) ||
    null;

  const planKey =
    org?.subscription_plan_key ||
    org?.plan_key ||
    account?.subscription_plan_key ||
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
    org?.subscription_status ||
    account?.subscription_status ||
    "Not connected";

  // Respect explicit false; only default to true when we truly have no signal.
  const alertsEnabled =
    typeof account?.enable_alerts === "boolean"
      ? account.enable_alerts
      : typeof org?.enable_alerts === "boolean"
      ? (org.enable_alerts as boolean)
      : true;

  const reportsEnabled =
    typeof account?.enable_reports === "boolean"
      ? account.enable_reports
      : typeof org?.enable_reports === "boolean"
      ? (org.enable_reports as boolean)
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
    } catch (e: any) {
      setError(
        e?.response?.data?.detail ||
          e?.message ||
          "Failed to delete account."
      );
    } finally {
      setDeleting(false);
    }
  };

  const envLabel = getEnvironmentLabel(appEnvironment);
  const envBlurb = getEnvironmentBlurb(appEnvironment);

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
          {account?.role && (
            <div>
              Role: <strong>{account.role}</strong>
            </div>
          )}
          <div style={{ marginTop: "0.2rem" }}>
            <span>
              Plan: <strong>{planLabel}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* Error banner */}
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
