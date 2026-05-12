// frontend/src/services/pushApi.ts
import api from "./api";

export interface PushSubscriptionOut {
  id: number;
  endpoint: string;
  device_label: string | null;
  is_active: boolean;
  created_at: string;
}

export interface VapidPublicKeyOut {
  public_key: string;
  enabled: boolean;
}

export async function getVapidPublicKey(): Promise<VapidPublicKeyOut> {
  const res = await api.get<VapidPublicKeyOut>("/push/vapid-public-key");
  return res.data;
}

export async function registerPushSubscription(
  subscription: PushSubscription,
  deviceLabel?: string
): Promise<PushSubscriptionOut> {
  const keys = subscription.getKey ? {
    p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!))),
    auth:   btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!))),
  } : (subscription.toJSON() as any).keys;

  const res = await api.post<PushSubscriptionOut>("/push/subscribe", {
    endpoint:     subscription.endpoint,
    p256dh:       keys.p256dh,
    auth:         keys.auth,
    device_label: deviceLabel || getDeviceLabel(),
  });
  return res.data;
}

export async function unregisterPushSubscription(endpoint: string): Promise<void> {
  await api.delete("/push/unsubscribe", { params: { endpoint } });
}

export async function listPushSubscriptions(): Promise<PushSubscriptionOut[]> {
  const res = await api.get<PushSubscriptionOut[]>("/push/subscriptions");
  return res.data;
}

function getDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iOS Safari";
  if (/Android/.test(ua)) return "Android";
  if (/Chrome/.test(ua)) return "Chrome";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/Safari/.test(ua)) return "Safari";
  return "Browser";
}

// ── Base64url → Uint8Array (needed for applicationServerKey) ─────────────────

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}