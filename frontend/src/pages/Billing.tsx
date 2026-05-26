// frontend/src/pages/Billing.tsx
/**
 * CEI Billing page.
 *
 * Shows:
 *  - Current plan summary
 *  - Billing status (active / past_due / canceled)
 *  - Stripe Checkout button (to subscribe or change plan)
 *  - Stripe Portal button (to manage payment method, invoices, cancel)
 *  - Soft-lock notice if applicable
 *
 * Owner-only actions: checkout + portal.
 * Members see a read-only view with a prompt to contact their owner.
 */

import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FiCreditCard,
  FiCheckCircle,
  FiAlertTriangle,
  FiExternalLink,
  FiRefreshCw,
  FiZap,
} from "react-icons/fi";
import {
  fetchBillingOverview,
  createHybridCheckout,
  createPortalSession,
  billingStatusLabel,
  billingStatusColor,
  isSoftLocked,
  type BillingOverview,
} from "../services/billingApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

function PlanFeature({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2 text-sm text-gray-700">
      <FiCheckCircle className="w-4 h-4 text-green-500 shrink-0" />
      {text}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

import { useAuth } from "../hooks/useAuth";

const Billing: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOwner = (user as any)?.role === "owner";

  const [overview, setOverview]   = useState<BillingOverview | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ── Load overview ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBillingOverview();
      setOverview(data);
    } catch {
      setError(t("billing.loadError", "Could not load billing information. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleSubscribe = async () => {
    if (!isOwner) return;
    setActionLoading(true);
    try {
      const origin = window.location.origin;
      const result = await createHybridCheckout(
        `${origin}/settings?billing=success`,
        `${origin}/settings?billing=canceled`,
      );
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
      } else {
        setError(t("billing.notConfiguredCheckout", "Billing is not fully configured for this environment. No live checkout page is available."));
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
    try {
      const result = await createPortalSession(window.location.href);
      if (result.portal_url) {
        window.location.href = result.portal_url;
      } else {
        setError(t("billing.portalNotAvailable", "The billing portal is not available in this environment. Stripe is not fully configured."));
      }
    } catch {
      setError(t("billing.portalFailed", "Could not open the billing portal. Please retry or contact your CEI admin."));
    } finally {
      setActionLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <FiRefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700 text-sm">
        <FiAlertTriangle className="w-5 h-5 inline mr-2" />
        {error}
      </div>
    );
  }

  const status      = overview?.billing_status ?? "unknown";
  const softLocked  = overview ? isSoftLocked(overview) : false;
  const hasStripe   = overview?.stripe_subscription_id != null;
  const plan        = overview?.current_plan;

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Soft lock warning ── */}
      {softLocked && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3">
          <FiAlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {t("softLockBanner.titleCritical", "Account suspended — billing {{status}}", {
                status: billingStatusLabel(status),
              })}
            </p>
            <p className="text-sm text-red-700 mt-1">
              {isOwner
                ? t("softLockBanner.bodyOwnerCritical", "Your account is in read-only mode. Update your payment to restore full access.")
                : t("softLockBanner.bodyMember", "Contact your account owner to resolve this.")}
            </p>
          </div>
        </div>
      )}

      {/* ── Plan card ── */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-50">
                <FiZap className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {plan?.display_name ?? t("billing.currentPlan", "Current Plan")}
                </h3>
                <p className="text-sm text-gray-500">
                  {plan
                    ? `€${plan.price_monthly_eur}/mo + €${plan.per_site_monthly_eur}/site`
                    : t("billing.noPlan", "No active plan")}
                </p>
              </div>
            </div>

            {/* Status badge */}
            <span className={`text-sm font-medium ${billingStatusColor(status)}`}>
              {billingStatusLabel(status)}
            </span>
          </div>
        </div>

        {/* Plan features */}
        {plan?.features && plan.features.length > 0 && (
          <div className="p-6 border-b border-gray-100">
            <ul className="space-y-2">
              {plan.features.map((f, i) => (
                <PlanFeature key={i} text={f} />
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="p-6 flex flex-col sm:flex-row gap-3">
          {isOwner ? (
            <>
              {/* Subscribe / Upgrade */}
              {!hasStripe && (
                <button
                  onClick={handleSubscribe}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <FiCreditCard className="w-4 h-4" />
                  {actionLoading
                    ? t("billing.processing", "Processing…")
                    : t("billing.subscribe", "Subscribe")}
                </button>
              )}

              {/* Manage via Stripe Portal */}
              {hasStripe && (
                <button
                  onClick={handlePortal}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <FiExternalLink className="w-4 h-4" />
                  {actionLoading
                    ? t("billing.processing", "Processing…")
                    : t("billing.managePortal", "Manage billing & invoices")}
                </button>
              )}

              {/* Resubscribe if canceled */}
              {status === "canceled" && (
                <button
                  onClick={handleSubscribe}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <FiCreditCard className="w-4 h-4" />
                  {t("billing.resubscribe", "Resubscribe")}
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">
              {t("billing.ownerOnlyBlurb", "Ask your org owner to upgrade or manage billing.")}
            </p>
          )}
        </div>
      </div>

      {/* ── Error toast ── */}
      {error && overview && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <FiAlertTriangle className="w-4 h-4 inline mr-2" />
          {error}
        </div>
      )}

      {/* ── Stripe not configured notice (dev/staging) ── */}
      {overview && !overview.stripe_enabled && (
        <p className="text-xs text-gray-400 text-center">
          {t("billing.stripeNotConfigured", "Stripe is not configured in this environment. Billing actions are unavailable.")}
        </p>
      )}
    </div>
  );
};

export default Billing;
