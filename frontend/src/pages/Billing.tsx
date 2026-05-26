// frontend/src/pages/Billing.tsx
import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FiCreditCard, FiAlertTriangle, FiRefreshCw, FiExternalLink, FiCheckCircle } from "react-icons/fi";
import {
  fetchBillingOverview,
  createHybridCheckout,
  createPortalSession,
  billingStatusLabel,
  isSoftLocked,
  type BillingOverview,
} from "../services/billingApi";
import { useAuth } from "../hooks/useAuth";

// ── Usage examples ────────────────────────────────────────────────────────────

const STANDALONE_EXAMPLES = [
  { sites: 1, monthly: 148 },
  { sites: 2, monthly: 207 },
  { sites: 3, monthly: 266 },
  { sites: 5, monthly: 384 },
];

const MANAGER_EXAMPLES = [
  { sites: 5,  monthly: 344  },
  { sites: 10, monthly: 539  },
  { sites: 20, monthly: 929  },
  { sites: 30, monthly: 1319 },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function FeatureItem({ text }: { text: string }) {
  return (
    <li style={{ fontSize: "0.75rem", color: "var(--cei-text-muted, #94a3b8)", display: "flex", gap: "6px", alignItems: "flex-start", lineHeight: 1.4 }}>
      <FiCheckCircle style={{ color: "var(--cei-green, #22c55e)", flexShrink: 0, marginTop: "2px" }} />
      {text}
    </li>
  );
}

function UsageTable({ examples }: { examples: { sites: number; monthly: number }[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem", marginTop: "0.5rem" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
          <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", color: "var(--cei-text-muted, #94a3b8)", fontWeight: 500 }}>Sites</th>
          <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: "var(--cei-text-muted, #94a3b8)", fontWeight: 500 }}>Monthly</th>
          <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: "var(--cei-text-muted, #94a3b8)", fontWeight: 500 }}>Annual</th>
        </tr>
      </thead>
      <tbody>
        {examples.map(({ sites, monthly }) => (
          <tr key={sites} style={{ borderBottom: "1px solid rgba(148,163,184,0.07)" }}>
            <td style={{ padding: "0.35rem 0.5rem", color: "var(--cei-text-main, #e2e8f0)" }}>{sites}</td>
            <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: "var(--cei-green, #22c55e)", fontWeight: 600 }}>€{monthly}</td>
            <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: "var(--cei-text-muted, #94a3b8)" }}>€{monthly * 12}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const Billing: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOwner = (user as any)?.role === "owner";
  const orgType = (user as any)?.org?.org_type || (user as any)?.organization?.org_type || "standalone";
  const isManager = orgType === "managing";

  const [overview, setOverview]         = useState<BillingOverview | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBillingOverview();
      setOverview(data);
    } catch {
      setError("Could not load billing information. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSubscribe = async () => {
    if (!isOwner) return;
    setActionLoading(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await createHybridCheckout(
        `${origin}/billing?billing=success`,
        `${origin}/billing?billing=canceled`,
      );
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
      } else {
        setError(t("billing.notConfiguredCheckout", "Billing is not fully configured for this environment."));
      }
    } catch {
      setError(t("billing.checkoutFailed", "Could not start checkout. Please retry or contact your CEI admin."));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePortal = async () => {
    if (!isOwner) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await createPortalSession(window.location.href);
      if (result.portal_url) {
        window.location.href = result.portal_url;
      } else {
        setError(t("billing.portalNotAvailable", "The billing portal is not available in this environment."));
      }
    } catch {
      setError(t("billing.portalFailed", "Could not open the billing portal."));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4rem" }}>
        <FiRefreshCw style={{ width: 24, height: 24, color: "#94a3b8", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  const status     = overview?.billing_status ?? "unknown";
  const softLocked = overview ? isSoftLocked(overview) : false;
  const hasStripe  = !!overview?.stripe_subscription_id;
  const plan       = overview?.current_plan;
  const examples   = isManager ? MANAGER_EXAMPLES : STANDALONE_EXAMPLES;

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: "900px" }}>
      {/* ── Page header ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--cei-text-main, #e2e8f0)", margin: 0 }}>
          {t("billing.title", "Billing & Subscription")}
        </h1>
        <p style={{ fontSize: "0.85rem", color: "var(--cei-text-muted, #94a3b8)", marginTop: "0.3rem" }}>
          {isManager
            ? t("billing.subtitleManager", "Manage your CEI Energy Manager subscription. Your rate covers your entire client portfolio.")
            : t("billing.subtitleStandalone", "Manage your CEI subscription. Pay a base fee plus a per-site rate for each connected facility.")}
        </p>
      </div>

      {/* ── Soft lock warning ── */}
      {softLocked && (
        <div style={{ border: "1px solid rgba(239,68,68,0.4)", borderRadius: "0.65rem", padding: "1rem", background: "rgba(239,68,68,0.08)", display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <FiAlertTriangle style={{ color: "#ef4444", flexShrink: 0, marginTop: "2px" }} />
          <div>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#fca5a5", margin: 0 }}>
              Account suspended — {billingStatusLabel(status)}
            </p>
            <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.25rem 0 0" }}>
              {isOwner
                ? "Your account is in read-only mode. Update your payment to restore full access."
                : "Contact your account owner to resolve this."}
            </p>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>

        {/* ── Current plan card ── */}
        <div style={{ border: "2px solid rgba(34,197,94,0.4)", borderRadius: "0.65rem", padding: "1.25rem", background: "rgba(15,23,42,0.5)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--cei-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("billing.currentPlan", "Current Plan")}
            </span>
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: status === "active" ? "#22c55e" : "#f59e0b", background: status === "active" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)", padding: "2px 8px", borderRadius: "999px" }}>
              {billingStatusLabel(status)}
            </span>
          </div>

          <div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--cei-green, #22c55e)" }}>
              {plan?.name ?? (isManager ? "CEI Energy Manager" : "CEI Starter")}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted, #94a3b8)", marginTop: "0.2rem" }}>
              {isManager ? "€149/mo base + €39/site/mo" : "€89/mo base + €59/site/mo"}
            </div>
          </div>

          {/* Features */}
          {plan?.features && plan.features.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.3rem", borderTop: "1px solid rgba(148,163,184,0.15)", paddingTop: "0.75rem" }}>
              {plan.features.map((f, i) => <FeatureItem key={i} text={f} />)}
            </ul>
          )}

          {/* Actions */}
          <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid rgba(148,163,184,0.1)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {isOwner ? (
              <>
                {!hasStripe && (
                  <button
                    onClick={handleSubscribe}
                    disabled={actionLoading || !overview?.stripe_enabled}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "0.55rem 1rem", borderRadius: "0.5rem", background: "var(--cei-green, #22c55e)", color: "#0f172a", fontSize: "0.82rem", fontWeight: 600, border: "none", cursor: actionLoading || !overview?.stripe_enabled ? "not-allowed" : "pointer", opacity: actionLoading || !overview?.stripe_enabled ? 0.6 : 1, transition: "opacity 0.15s" }}
                  >
                    <FiCreditCard />
                    {actionLoading ? t("billing.processing", "Processing…") : t("billing.subscribe", "Subscribe now")}
                  </button>
                )}
                {hasStripe && (
                  <button
                    onClick={handlePortal}
                    disabled={actionLoading}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "0.55rem 1rem", borderRadius: "0.5rem", background: "transparent", color: "var(--cei-text-main, #e2e8f0)", fontSize: "0.82rem", fontWeight: 500, border: "1px solid rgba(148,163,184,0.3)", cursor: actionLoading ? "not-allowed" : "pointer", opacity: actionLoading ? 0.6 : 1 }}
                  >
                    <FiExternalLink />
                    {actionLoading ? t("billing.processing", "Processing…") : t("billing.managePortal", "Manage billing & invoices")}
                  </button>
                )}
                {status === "canceled" && (
                  <button
                    onClick={handleSubscribe}
                    disabled={actionLoading}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "0.55rem 1rem", borderRadius: "0.5rem", background: "var(--cei-green, #22c55e)", color: "#0f172a", fontSize: "0.82rem", fontWeight: 600, border: "none", cursor: "pointer" }}
                  >
                    <FiCreditCard />
                    {t("billing.resubscribe", "Resubscribe")}
                  </button>
                )}
              </>
            ) : (
              <p style={{ fontSize: "0.75rem", color: "var(--cei-text-muted, #94a3b8)", margin: 0 }}>
                {t("billing.ownerOnlyBlurb", "Ask your org owner to upgrade or manage billing.")}
              </p>
            )}

            {overview && !overview.stripe_enabled && (
              <p style={{ fontSize: "0.7rem", color: "var(--cei-text-muted, #94a3b8)", margin: 0, textAlign: "center" }}>
                {t("billing.stripeNotConfigured", "Stripe not configured — billing actions unavailable.")}
              </p>
            )}
          </div>
        </div>

        {/* ── Pricing examples card ── */}
        <div style={{ border: "1px solid var(--cei-border-subtle, rgba(148,163,184,0.2))", borderRadius: "0.65rem", padding: "1.25rem", background: "rgba(15,23,42,0.5)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--cei-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("billing.pricingExamples", "Pricing Examples")}
            </span>
            <p style={{ fontSize: "0.75rem", color: "var(--cei-text-muted, #94a3b8)", margin: "0.3rem 0 0" }}>
              {isManager
                ? "€149/month base + €39 per site across your full portfolio"
                : "€89/month base + €59 per connected site"}
            </p>
          </div>
          <UsageTable examples={examples} />
          <p style={{ fontSize: "0.68rem", color: "var(--cei-text-muted, #94a3b8)", margin: 0, borderTop: "1px solid rgba(148,163,184,0.1)", paddingTop: "0.5rem" }}>
            {t("billing.noAnnualDiscount", "No annual prepayment discount at launch. Billed monthly. Cancel anytime.")}
          </p>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ marginTop: "1rem", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.5rem", padding: "0.75rem 1rem", background: "rgba(239,68,68,0.08)", fontSize: "0.8rem", color: "#fca5a5", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <FiAlertTriangle />
          {error}
        </div>
      )}
    </div>
  );
};

export default Billing;
