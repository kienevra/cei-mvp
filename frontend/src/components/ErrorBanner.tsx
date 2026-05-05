// frontend/src/components/ErrorBanner.tsx
import React, { useMemo, useState } from "react";

interface ErrorBannerProps {
  message: string | any;
  onClose?: () => void;
}

function splitSupportCode(message: string | any): { main: string; supportCode: string | null } {
  const msg = typeof message === "string"
    ? message
    : (message?.message ?? JSON.stringify(message) ?? "");
  if (!msg) return { main: "", supportCode: null };
  const match = msg.match(/\(Support code:\s*([^)]+)\)\s*$/i);
  if (!match) return { main: msg, supportCode: null };
  const supportCode = match[1]?.trim() || null;
  const main = msg.replace(/\s*\(Support code:\s*([^)]+)\)\s*$/i, "").trim();
  return { main, supportCode };
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose }) => {
  const { main, supportCode } = useMemo(() => splitSupportCode(message), [message]);
  const [copied, setCopied] = useState(false);

  const canCopy =
    typeof navigator !== "undefined" &&
    !!(navigator as any)?.clipboard?.writeText &&
    !!supportCode;

  const handleCopy = async () => {
    if (!supportCode) return;
    try {
      await navigator.clipboard.writeText(supportCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="bg-red-100 text-red-700 p-2 rounded mb-2 flex justify-between items-center">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        <span>{main}</span>
        {supportCode && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.8rem", opacity: 0.9, flexWrap: "wrap" }}>
            <span>Support code: <code>{supportCode}</code></span>
            {canCopy && (
              <button type="button" onClick={handleCopy} className="ml-2 text-red-600"
                style={{ fontSize: "0.78rem", textDecoration: "underline", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                aria-label="Copy support code" title="Copy support code">
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        )}
      </div>
      {onClose && (
        <button className="ml-2 text-red-500" onClick={onClose} type="button">×</button>
      )}
    </div>
  );
};

export default ErrorBanner;