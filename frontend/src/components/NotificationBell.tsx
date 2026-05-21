// frontend/src/components/NotificationBell.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllRead,
  markOneRead,
  dismissNotification,
  type Notification,
} from "../services/notificationApi";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

// ── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { icon: string; color: string }> = {
  link_request_received:  { icon: "🔗", color: "#f59e0b" },
  link_request_accepted:  { icon: "✅", color: "#22c55e" },
  link_request_rejected:  { icon: "❌", color: "#ef4444" },
  link_request_cancelled: { icon: "↩️", color: "#94a3b8" },
  link_request_sent:      { icon: "📤", color: "#38bdf8" },
  org_linked:             { icon: "🤝", color: "#22c55e" },
  org_unlinked:           { icon: "🔓", color: "#f59e0b" },
  alert_critical:         { icon: "🚨", color: "#ef4444" },
  alert_warning:          { icon: "⚠️",  color: "#f59e0b" },
  invite_received:        { icon: "✉️",  color: "#38bdf8" },
  team_member_joined:     { icon: "👤", color: "#22c55e" },
  ingest_health_degraded: { icon: "📡", color: "#f59e0b" },
  token_first_use:        { icon: "🔑", color: "#22c55e" },
};

const DEFAULT_META = { icon: "🔔", color: "#94a3b8" };

function getMeta(type: string) {
  return TYPE_META[type] ?? DEFAULT_META;
}

// ── Time formatting ───────────────────────────────────────────────────────────

function useTimeAgo() {
  const { t, i18n } = useTranslation();
  return (iso: string): string => {
    const diff  = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins  <  1) return t("notifications.ui.justNow");
    if (mins  < 60) return t("notifications.ui.minutesAgo", { n: mins });
    if (hours < 24) return t("notifications.ui.hoursAgo",   { n: hours });
    return t("notifications.ui.daysAgo", { n: days });
  };
}

// ── Bell SVG icon ─────────────────────────────────────────────────────────────

function BellIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // poll every 30 seconds

const NotificationBell: React.FC = () => {
  const timeAgo = useTimeAgo();
  const [unread,        setUnread]        = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open,          setOpen]          = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [markingAll,    setMarkingAll]    = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const getNavTarget = (n: Notification): string | null => {
    // If the notification carries an explicit URL, use it directly
    if (n.extra?.url) return n.extra.url as string;

    const rawSiteId = n.extra?.site_id;
    const numericSiteId = rawSiteId
      ? rawSiteId.toString().replace("site-", "")
      : null;
    const siteId = numericSiteId || n.extra?.client_org_id;
    switch (n.type) {
      case "link_request_received":
      case "link_request_cancelled":
      case "org_unlinked":
      case "invite_received":
      case "link_request_sent":
        return "/account";
      case "link_request_accepted":
      case "link_request_rejected":
      case "team_member_joined":
        return "/manage";
      case "org_linked":
        return "/";
      case "alert_critical":
      case "alert_warning":
        return numericSiteId ? `/sites/${numericSiteId}` : "/alerts";
      case "ingest_health_degraded":
        return numericSiteId ? `/sites/${numericSiteId}` : "/sites";
      case "token_first_use":
        return "/settings";
      default:
        return null;
    }
  };

  const getNotifText = (n: Notification): { title: string; body: string | null } => {
    const name =
      n.extra?.managing_org_name ||
      n.extra?.client_org_name ||
      n.extra?.site_id ||
      "";
    const isIt = i18n.language?.toLowerCase().startsWith("it");
    const titleKey = `notifications.${n.type}.title`;
    const bodyKey  = `notifications.${n.type}.body`;
    // Use Italian fields from extra if available and UI is in Italian
    const defaultTitle = isIt && n.extra?.title_it ? n.extra.title_it as string : n.title;
    const defaultBody  = isIt && n.extra?.body_it  ? n.extra.body_it  as string : (n.body ?? "");
    const title = t(titleKey, { name, defaultValue: defaultTitle });
    const body  = t(bodyKey,  { name, defaultValue: defaultBody }) || null;
    return { title, body };
  };

  // ── Poll unread count ───────────────────────────────────────────────────

  const pollCount = useCallback(async () => {
    try {
      const count = await fetchUnreadCount();
      setUnread(count);
    } catch {
      // silently ignore — don't break the header
    }
  }, []);

  useEffect(() => {
    pollCount();
    const id = setInterval(pollCount, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollCount]);

  // ── Load full list when panel opens ────────────────────────────────────

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchNotifications();
      setNotifications(list);
      // Sync unread count from loaded list
      setUnread(list.filter(n => !n.is_read).length);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadNotifications();
  }, [open, loadNotifications]);

  // ── Close on outside click ──────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleMarkOne = async (id: number) => {
    try {
      await markOneRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: true } : n)
      );
      setUnread(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const handleDismiss = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      await dismissNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      const wasDismissedUnread = notifications.find(n => n.id === id && !n.is_read);
      if (wasDismissedUnread) setUnread(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const handleMarkAll = async () => {
    setMarkingAll(true);
    try {
      await markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
    } catch {}
    finally { setMarkingAll(false); }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} style={{ position: "relative", display: "inline-flex" }}>

      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2rem",
          height: "2rem",
          borderRadius: "50%",
          border: "1px solid rgba(148,163,184,0.2)",
          background: open ? "rgba(148,163,184,0.12)" : "transparent",
          color: unread > 0 ? "#f59e0b" : "var(--cei-text-muted, #94a3b8)",
          cursor: "pointer",
          transition: "background 0.15s, color 0.15s",
          padding: 0,
        }}
      >
        <BellIcon size={18} />

        {/* Unread badge */}
        {unread > 0 && (
          <span style={{
            position: "absolute",
            top: "-4px",
            right: "-4px",
            minWidth: "16px",
            height: "16px",
            borderRadius: "999px",
            background: "#ef4444",
            color: "#fff",
            fontSize: "0.65rem",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 3px",
            lineHeight: 1,
            border: "1.5px solid var(--cei-bg, #020617)",
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 0.5rem)",
          right: 0,
          width: "360px",
          maxHeight: "480px",
          overflowY: "auto",
          borderRadius: "0.75rem",
          border: "1px solid rgba(148,163,184,0.16)",
          background: "linear-gradient(135deg, #0f172a 0%, #020617 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          zIndex: 200,
        }}>

          {/* Panel header */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid rgba(148,163,184,0.1)",
            position: "sticky",
            top: 0,
            background: "#0f172a",
            zIndex: 1,
          }}>
            <div style={{ fontWeight: 600, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <BellIcon size={15} />
              {t("notifications.ui.title")}
              {unread > 0 && (
                <span style={{
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem",
                  borderRadius: 999,
                  background: "rgba(239,68,68,0.15)",
                  color: "#ef4444",
                  fontWeight: 700,
                }}>
                  {t("notifications.ui.unread", { count: unread })}
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={markingAll}
                style={{
                  fontSize: "0.75rem",
                  color: "#38bdf8",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "0.2rem 0.4rem",
                  opacity: markingAll ? 0.6 : 1,
                }}
              >
                {markingAll ? "..." : t("notifications.ui.markAllRead")}
              </button>
            )}
          </div>

          {/* List */}
          {loading ? (
            <div style={{ padding: "1.5rem", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
              {t("notifications.ui.loading")}
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: "2rem 1rem", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🔔</div>
              {t("notifications.ui.empty")}
            </div>
          ) : (
            <div>
              {notifications.map(n => {
                const meta = getMeta(n.type);
                return (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (!n.is_read) handleMarkOne(n.id);
                      const target = getNavTarget(n);
                      if (target) {
                        setOpen(false);
                        navigate(target);
                      }
                    }}
                    style={{
                      display: "flex",
                      gap: "0.65rem",
                      padding: "0.7rem 1rem",
                      borderBottom: "1px solid rgba(148,163,184,0.07)",
                      cursor: getNavTarget(n) ? "pointer" : "default",
                      background: n.is_read ? "transparent" : "rgba(148,163,184,0.04)",
                      transition: "background 0.1s",
                    }}
                  >
                    {/* Icon */}
                    <div style={{
                      flexShrink: 0,
                      width: "2rem",
                      height: "2rem",
                      borderRadius: "50%",
                      background: `${meta.color}18`,
                      border: `1px solid ${meta.color}30`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.85rem",
                    }}>
                      {meta.icon}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {(() => {
                        const { title, body } = getNotifText(n);
                        return (
                          <>
                            <div style={{
                              fontSize: "0.83rem",
                              fontWeight: n.is_read ? 400 : 600,
                              color: n.is_read ? "#94a3b8" : "#e5e7eb",
                              marginBottom: "0.15rem",
                              lineHeight: 1.3,
                            }}>
                              {title}
                            </div>
                            {body && (
                              <div style={{
                                fontSize: "0.75rem",
                                color: "#64748b",
                                marginBottom: "0.25rem",
                                lineHeight: 1.4,
                                overflow: "hidden",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical" as any,
                              }}>
                                {body}
                              </div>
                            )}
                          </>
                        );
                      })()}
                      <div style={{ fontSize: "0.7rem", color: "#475569" }}>
                        {timeAgo(n.created_at)}
                      </div>
                    </div>

                    {/* Unread dot + dismiss */}
                    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem" }}>
                      {!n.is_read && (
                        <span style={{
                          width: "7px", height: "7px",
                          borderRadius: "50%",
                          background: meta.color,
                          marginTop: "0.25rem",
                        }} />
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDismiss(e, n.id)}
                        title={t("notifications.ui.dismiss")}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#475569",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                          padding: "0.1rem 0.2rem",
                          lineHeight: 1,
                          opacity: 0.6,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
