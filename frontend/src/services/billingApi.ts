// frontend/src/services/billingApi.ts
/**
 * CEI Billing API service layer.
 * Wraps all /api/v1/billing/* endpoints.
 */

import api from "./api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BillingPlan {
  key: string;
  name: string;
  description: string | null;
  is_default: boolean;
  price_monthly_eur: number;
  per_site_monthly_eur: number;
  max_sites: number | null;
  features: string[];
}

export interface BillingOverview {
  org_id: number | null;
  org_name: string | null;
  current_plan: BillingPlan | null;
  billing_status: string;           // "active" | "past_due" | "canceled" | "unknown"
  stripe_enabled: boolean;
  stripe_api_key_present: boolean;
  stripe_webhook_secret_present: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_status: string | null;
}

export interface CheckoutSessionResult {
  provider: "stripe";
  checkout_url: string | null;
}

export interface PortalSessionResult {
  provider: "stripe";
  portal_url: string | null;
}

export interface HybridCheckoutResult {
  checkout_url: string | null;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Fetch the current org's billing overview.
 * Safe to call for all org types — returns current plan + Stripe state.
 */
export async function fetchBillingOverview(): Promise<BillingOverview> {
  const resp = await api.get("/billing/overview");
  return resp.data as BillingOverview;
}

/**
 * Start a Stripe Checkout session for a plan change or initial subscription.
 * Owner-only. Returns a checkout URL to redirect to, or null if Stripe is
 * not configured.
 */
export async function createCheckoutSession(
  planKey: string,
  successUrl: string,
  cancelUrl: string
): Promise<CheckoutSessionResult> {
  const resp = await api.post("/billing/checkout-session", {
    plan_key: planKey,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return resp.data as CheckoutSessionResult;
}

/**
 * Open the Stripe Billing Portal for the current org.
 * Owner-only. Returns a portal URL to redirect to, or null if not configured.
 */
export async function createPortalSession(
  returnUrl: string
): Promise<PortalSessionResult> {
  const resp = await api.post("/billing/portal-session", {
    return_url: returnUrl,
  });
  return resp.data as PortalSessionResult;
}

/**
 * Create a hybrid checkout session (base fee + per-site fee).
 * Owner-only. Used for the CEI standard subscription flow.
 */
export async function createHybridCheckout(
  successUrl: string,
  cancelUrl: string
): Promise<HybridCheckoutResult> {
  const resp = await api.post("/billing/hybrid-checkout-session", {
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return resp.data as HybridCheckoutResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable label for a billing status string.
 */
export function billingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active:    "Active",
    past_due:  "Past Due",
    canceled:  "Canceled",
    trialing:  "Trial",
    unpaid:    "Unpaid",
    unknown:   "—",
  };
  return labels[status] ?? status;
}

/**
 * Returns a Tailwind color class for a billing status.
 */
export function billingStatusColor(status: string): string {
  switch (status) {
    case "active":   return "text-green-600";
    case "trialing": return "text-blue-600";
    case "past_due":
    case "unpaid":   return "text-yellow-600";
    case "canceled": return "text-red-600";
    default:         return "text-gray-500";
  }
}

/**
 * Returns true if the org is in a soft-locked state
 * (read-only, no ingestion or new documents).
 */
export function isSoftLocked(overview: BillingOverview): boolean {
  return (
    overview.billing_status === "past_due" ||
    overview.billing_status === "unpaid" ||
    overview.billing_status === "canceled"
  );
}