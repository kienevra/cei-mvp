// frontend/src/hooks/useSocketEvent.ts
/**
 * Minimal global event bus for cross-component WebSocket signals.
 * Components call emitSocketEvent("data_updated") when a WS event arrives.
 * Subscribers call useSocketEvent("data_updated", callback) to react.
 */

type SocketEventName = "data_updated";

const listeners = new Map<SocketEventName, Set<() => void>>();

export function emitSocketEvent(event: SocketEventName): void {
  listeners.get(event)?.forEach(fn => fn());
}

export function useSocketEvent(
  event: SocketEventName,
  callback: () => void
): void {
  // We use a module-level map so this works across component trees
  // without needing a Provider.
  const { useEffect, useRef } = require("react");
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const stable = () => cbRef.current();
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(stable);
    return () => {
      listeners.get(event)?.delete(stable);
    };
  }, [event]);
}