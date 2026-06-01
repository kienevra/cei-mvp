// frontend/src/hooks/useSiteSocket.ts
import { useEffect, useRef, useState, useCallback } from "react";

const WS_BASE =
  (import.meta.env.VITE_API_URL || "https://api.carbonefficiencyintel.com")
    .replace(/^https/, "wss")
    .replace(/^http/, "ws");

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

export type SiteSocketStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

export interface SiteSocketState {
  status: SiteSocketStatus;
  lastUpdate: Date | null;
  rowsIngested: number | null;
}

interface UseSiteSocketOptions {
  /** Called every time a data_updated event arrives. Re-fetch your data here. */
  onDataUpdated: () => void;
  /** Set to false to disable the socket entirely (e.g. site not yet loaded). */
  enabled?: boolean;
}

/**
 * useSiteSocket
 *
 * Opens a WebSocket to /api/v1/ws/sites/{siteId} and calls onDataUpdated
 * whenever the backend broadcasts a data_updated event for this site.
 *
 * Handles:
 *  - Automatic reconnection with exponential backoff (Render sleep recovery)
 *  - Ping/pong heartbeat passthrough
 *  - Clean teardown on unmount or siteId change
 */
export function useSiteSocket(
  siteId: string | number | null | undefined,
  { onDataUpdated, enabled = true }: UseSiteSocketOptions
): SiteSocketState {
  const [status, setStatus] = useState<SiteSocketStatus>("disconnected");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [rowsIngested, setRowsIngested] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const mountedRef = useRef(true);
  // Stable ref to onDataUpdated so the socket handler never captures a stale closure
  const onDataUpdatedRef = useRef(onDataUpdated);
  onDataUpdatedRef.current = onDataUpdated;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || !siteId || !enabled) return;

    // Resolve numeric site ids to "site-N" to match the backend key
    const resolvedSiteId =
      typeof siteId === "number"
        ? `site-${siteId}`
        : String(siteId).startsWith("site-")
        ? String(siteId)
        : `site-${siteId}`;

    const url = `${WS_BASE}/api/v1/ws/sites/${resolvedSiteId}`;

    setStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS; // reset backoff
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.event === "ping") {
          // Server heartbeat — nothing to do, browser handles pong automatically
          return;
        }

        if (msg.event === "data_updated") {
          setLastUpdate(new Date());
          setRowsIngested(typeof msg.rows_ingested === "number" ? msg.rows_ingested : null);
          onDataUpdatedRef.current();
        }
      } catch {
        // Non-JSON message — ignore
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — handle reconnect there
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      setStatus("reconnecting");

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(
        delay * BACKOFF_MULTIPLIER,
        MAX_RECONNECT_DELAY_MS
      );

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };
  }, [siteId, enabled, clearReconnectTimer]);

  useEffect(() => {
    mountedRef.current = true;

    if (siteId && enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      if (wsRef.current) {
        // Suppress onclose-triggered reconnect on intentional unmount
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("disconnected");
    };
  }, [siteId, enabled, connect, clearReconnectTimer]);

  return { status, lastUpdate, rowsIngested };
}
