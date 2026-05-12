// frontend/public/sw.js
// CEI Service Worker — handles background push notifications
// Served at /sw.js (Vite copies public/ to dist/ as-is)

const APP_URL = self.location.origin;

// ── Push event — fires when backend sends a notification ──────────────────────

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CEI Alert", body: event.data ? event.data.text() : "" };
  }

  const title    = data.title    || "CEI Alert";
  const body     = data.body     || "";
  const url      = data.url      || "/alerts";
  const tag      = data.tag      || "cei-alert";
  const severity = data.severity || "warning";

  // Badge colour via icon choice
  const icon  = `${APP_URL}/favicon.ico`;
  const badge = `${APP_URL}/favicon.ico`;

  // Vibration pattern: short-long-short for warning, long for critical
  const vibrate = severity === "critical"
    ? [300, 100, 300, 100, 300]
    : [200, 100, 200];

  const options = {
    body,
    icon,
    badge,
    tag,             // groups notifications — same tag = update not stack
    renotify: true,  // vibrate/sound even if same tag already showing
    vibrate,
    requireInteraction: severity === "critical", // critical stays until dismissed
    data: { url: `${APP_URL}${url}` },
    actions: [
      { action: "view",    title: "View alerts" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});


// ── Notification click — open or focus the app ────────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || `${APP_URL}/alerts`;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // If app tab is already open, focus it and navigate
        for (const client of windowClients) {
          if (client.url.startsWith(APP_URL) && "focus" in client) {
            client.focus();
            client.navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new tab
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});


// ── Notification close — no-op (for analytics hooks later) ───────────────────

self.addEventListener("notificationclose", (_event) => {
  // Future: log dismissal for engagement analytics
});


// ── Activate — take control immediately on install ───────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});