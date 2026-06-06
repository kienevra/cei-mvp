// frontend/src/hooks/useOrgSocket.ts
/**
 * Opens a persistent org-level WebSocket connection.
 * Emits "data_updated" to the global event bus whenever any site
 * in this org receives new data — keeping NotificationBell live
 * regardless of which page the user is on.
 */
import { useEffect, useRef, useCallback } from "react";
import { emitSocketEvent } from "./useSocketEvent";

const WS_BASE =
  (import.meta.env.VITE_WS_URL ||
   import.meta.env.VITE_API_URL ||
   "https://cei-mvp.onrender.com")
    .replace(/^https/, "wss")
    .replace(/^http/, "ws");

const INITIAL_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;

export function useOrgSocket(orgId: number | null | undefined): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current || !orgId) return;

    const url = `${WS_BASE}/api/v1/ws/org/${orgId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.event === "data_updated") {
          emitSocketEvent("data_updated");
        }
      } catch {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(
        delay * BACKOFF_MULTIPLIER,
        MAX_RECONNECT_DELAY_MS
      );
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      // always followed by onclose — handle reconnect there
    };
  }, [orgId]);

  useEffect(() => {
    mountedRef.current = true;
    if (orgId) connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [orgId, connect]);
}