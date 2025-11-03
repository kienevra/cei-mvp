import React from "react";
import LoadingSpinner from "./LoadingSpinner";
import ErrorBanner from "./ErrorBanner";

export function HealthIndicator({
  status,
  loading,
  error,
}: {
  status?: string;
  loading?: boolean;
  error?: any;
}) {
  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner error={error} />;
  return (
    <div className="health-indicator">
      Backend status: <strong>{status === "ok" ? "Healthy" : "Unhealthy"}</strong>
    </div>
  );
}