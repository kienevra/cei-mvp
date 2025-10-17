import React from "react";

const ErrorBanner: React.FC<{ error: any }> = ({ error }) => (
  <div className="bg-red-100 text-red-700 rounded px-4 py-2 mb-2">
    {typeof error === "string"
      ? error
      : error?.message || "An error occurred."}
  </div>
);

export default ErrorBanner;