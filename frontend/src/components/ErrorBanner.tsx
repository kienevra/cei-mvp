import React from "react";

interface ErrorBannerProps {
  message: string;
  onClose?: () => void;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose }) => (
  <div className="bg-red-100 text-red-700 p-2 rounded mb-2 flex justify-between items-center">
    <span>{message}</span>
    {onClose && (
      <button className="ml-2 text-red-500" onClick={onClose}>
        ×
      </button>
    )}
  </div>
);

export default ErrorBanner;