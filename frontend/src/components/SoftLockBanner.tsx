// frontend/src/components/SoftLockBanner.tsx
/**
 * Persistent banner shown at the top of the app when the org's billing
 * is past due, unpaid, or canceled (soft-locked state).
 *
 * Soft-locked orgs are read-only: no data ingestion, no new documents.
 * This banner directs the owner to resolve billing, and shows a read-only
 * notice to non-owners.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCreditCard, FiX } from "react-icons/fi";
import { BillingOverview, billingStatusLabel } from "../services/billingApi";

interface SoftLockBannerProps {
  overview: BillingOverview;
  isOwner: boolean;
  onDismiss?: () => void;
  onManageBilling?: () => void;
}

const SoftLockBanner: React.FC<SoftLockBannerProps> = ({
  overview,
  isOwner,
  onDismiss,
  onManageBilling,
}) => {
  const { t } = useTranslation();

  const status = overview.billing_status;

  // Determine severity
  const isCritical = status === "canceled" || status === "unpaid";
  const isPastDue  = status === "past_due";

  if (!isCritical && !isPastDue) return null;

  const bgColor    = isCritical ? "bg-red-50 border-red-300"    : "bg-yellow-50 border-yellow-300";
  const iconColor  = isCritical ? "text-red-500"                : "text-yellow-500";
  const textColor  = isCritical ? "text-red-800"                : "text-yellow-800";
  const btnColor   = isCritical
    ? "bg-red-600 hover:bg-red-700 text-white"
    : "bg-yellow-500 hover:bg-yellow-600 text-white";

  return (
    <div className={`w-full border-b ${bgColor} px-4 py-3`}>
      <div className="max-w-7xl mx-auto flex items-start gap-3">
        {/* Icon */}
        <FiAlertTriangle className={`mt-0.5 shrink-0 w-5 h-5 ${iconColor}`} />

        {/* Message */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${textColor}`}>
            {isCritical
              ? t("softLockBanner.titleCritical", "Account suspended — billing {{status}}", {
                  status: billingStatusLabel(status),
                })
              : t("softLockBanner.titlePastDue", "Payment overdue — account at risk")}
          </p>
          <p className={`text-sm mt-0.5 ${textColor} opacity-80`}>
            {isOwner
              ? isCritical
                ? t(
                    "softLockBanner.bodyOwnerCritical",
                    "Your account is in read-only mode. Data ingestion and new documents are paused. Update your payment to restore full access."
                  )
                : t(
                    "softLockBanner.bodyOwnerPastDue",
                    "A payment is overdue. Please update your billing details to avoid service interruption."
                  )
              : t(
                  "softLockBanner.bodyMember",
                  "Your organization's billing needs attention. Contact your account owner to resolve this."
                )}
          </p>
        </div>

        {/* CTA — owners only */}
        {isOwner && onManageBilling && (
          <button
            onClick={onManageBilling}
            className={`shrink-0 flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md ${btnColor} transition-colors`}
          >
            <FiCreditCard className="w-4 h-4" />
            {t("softLockBanner.cta", "Manage billing")}
          </button>
        )}

        {/* Dismiss — only for past_due (not critical) */}
        {isPastDue && onDismiss && (
          <button
            onClick={onDismiss}
            className={`shrink-0 p-1 rounded hover:bg-yellow-100 ${textColor} transition-colors`}
            aria-label={t("common.dismiss", "Dismiss")}
          >
            <FiX className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default SoftLockBanner;
