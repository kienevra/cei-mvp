import React from "react";

export default function ErrorBanner({ error }: { error: any }) {
  return (
    <div className="error-banner" role="alert">
      {typeof error === "string" ? error : error?.message || "An error occurred"}
    </div>
  );
}