// frontend/src/hooks/useSocketEvent.ts
/**
 * Minimal global event bus for cross-component WebSocket signals.
 * Components call emitSocketEvent("data_updated") when a WS event arrives.
 * Subscribers call useSocketEvent("data_updated", callback) to react.
 */
import { useEffect, useRef } from "react";

type SocketEventName = "data_updated";

const listeners = new Map<SocketEventName, Set<() => void>>();

export function emitSocketEvent(event: SocketEventName): void {
  listeners.get(event)?.forEach(fn => fn());
}

export function useSocketEvent(
  event: SocketEventName,
  callback: () => void
): void {

  useEffect(() => {
    const stable = () => cbRef.current();
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(stable);
    return () => {
      listeners.get(event)?.delete(stable);
    };
  }, [event]);
}