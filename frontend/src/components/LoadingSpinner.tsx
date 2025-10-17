import React from "react";

const LoadingSpinner: React.FC<{ small?: boolean }> = ({ small }) => (
  <div
    className={`animate-spin rounded-full border-2 border-t-green-600 border-gray-200 ${
      small ? "w-5 h-5" : "w-10 h-10"
    }`}
    role="status"
    aria-label="Loading"
  />
);

export default LoadingSpinner;