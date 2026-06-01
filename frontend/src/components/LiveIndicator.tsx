// frontend/src/components/LiveIndicator.tsx
import React, { useEffect, useState } from "react";
import type { SiteSocketStatus } from "../hooks/useSiteSocket";

interface Props {
  status: SiteSocketStatus;
  lastUpdate: Date | null;
  rowsIngested: number | null;
}

/**
 * LiveIndicator
 *
 * Shows a pulsing dot + human-readable last-updated timestamp.
 * Mounts cleanly into the SiteView header.
 */
export default function LiveIndicator({ status, lastUpdate, rowsIngested }: Props) {
  const [, setTick] = useState(0);

  // Re-render every 30 seconds so "X minutes ago" stays fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const dotColor =
    status === "connected"
      ? "#22c55e"
      : status === "connecting" || status === "reconnecting"
      ? "#f59e0b"
      : "#64748b";

  const label =
    status === "connected"
      ? "Live"
      : status === "connecting"
      ? "Connecting…"
      : status === "reconnecting"
      ? "Reconnecting…"
      : "Offline";

  const timeAgo = lastUpdate ? formatTimeAgo(lastUpdate) : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        fontSize: "0.75rem",
        color: "var(--cei-text-muted)",
      }}
    >
      {/* Pulsing dot */}
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
          animation: status === "connected" ? "cei-live-pulse 2s ease-in-out infinite" : undefined,
        }}
      />

      <span style={{ color: dotColor, fontWeight: 500 }}>{label}</span>

      {timeAgo && (
        <span style={{ color: "var(--cei-text-muted)" }}>
          — updated {timeAgo}
          {rowsIngested !== null && rowsIngested > 0 && (
            <span style={{ color: "#22c55e", marginLeft: "0.25rem" }}>
              (+{rowsIngested} rows)
            </span>
          )}
        </span>
      )}

      <style>{`
        @keyframes cei-live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.25); }
        }
      `}</style>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
