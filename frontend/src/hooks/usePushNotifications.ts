// frontend/src/hooks/usePushNotifications.ts
import { useState, useEffect, useCallback } from "react";
import {
  getVapidPublicKey,
  registerPushSubscription,
  unregisterPushSubscription,
  urlBase64ToUint8Array,
} from "../services/pushApi";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface UsePushNotificationsReturn {
  permission:   PushPermission;
  isSubscribed: boolean;
  isLoading:    boolean;
  error:        string | null;
  isSupported:  boolean;
  enable:       () => Promise<void>;
  disable:      () => Promise<void>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission,   setPermission]   = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [swReg,        setSwReg]        = useState<ServiceWorkerRegistration | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // ── Register service worker + check current state on mount ───────────────

  useEffect(() => {
    if (!isSupported) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission as PushPermission);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async (reg) => {
        setSwReg(reg);

        // Check if already subscribed
        const existing = await reg.pushManager.getSubscription();
        setIsSubscribed(!!existing);
      })
      .catch((err) => {
        console.warn("CEI: Service worker registration failed", err);
        setError("Service worker could not be registered.");
      });
  }, [isSupported]);

  // ── Enable: request permission + subscribe ────────────────────────────────

  const enable = useCallback(async () => {
    if (!isSupported || !swReg) {
      setError("Push notifications are not supported in this browser.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Request notification permission
      const result = await Notification.requestPermission();
      setPermission(result as PushPermission);

      if (result !== "granted") {
        setError(
          result === "denied"
            ? "Notifications blocked. Enable them in your browser settings and try again."
            : "Notification permission was not granted."
        );
        setIsLoading(false);
        return;
      }

      // 2. Fetch VAPID public key from backend
      const { public_key, enabled } = await getVapidPublicKey();

      if (!enabled || !public_key) {
        setError("Push notifications are not configured on this server yet.");
        setIsLoading(false);
        return;
      }

      // 3. Create browser push subscription
      const rawKey = urlBase64ToUint8Array(public_key);
      const applicationServerKey = rawKey.buffer.slice(
        rawKey.byteOffset,
        rawKey.byteOffset + rawKey.byteLength
      ) as ArrayBuffer;
      const subscription = await swReg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey,
      });

      // 4. Send subscription to CEI backend
      await registerPushSubscription(subscription);

      setIsSubscribed(true);
    } catch (err: any) {
      console.error("CEI push enable error:", err);
      setError(err?.message || "Failed to enable push notifications.");
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, swReg]);

  // ── Disable: unsubscribe ──────────────────────────────────────────────────

  const disable = useCallback(async () => {
    if (!isSupported || !swReg) return;

    setIsLoading(true);
    setError(null);

    try {
      const subscription = await swReg.pushManager.getSubscription();

      if (subscription) {
        // Remove from CEI backend first
        await unregisterPushSubscription(subscription.endpoint);
        // Then unsubscribe from browser
        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
    } catch (err: any) {
      console.error("CEI push disable error:", err);
      setError(err?.message || "Failed to disable push notifications.");
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, swReg]);

  return {
    permission,
    isSubscribed,
    isLoading,
    error,
    isSupported,
    enable,
    disable,
  };
}