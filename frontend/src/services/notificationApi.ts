// frontend/src/services/notificationApi.ts
import api from "./api";

export interface Notification {
  id:         number;
  type:       string;
  title:      string;
  body:       string | null;
  is_read:    boolean;
  extra:      Record<string, any>;
  created_at: string;
}

export interface UnreadCount {
  unread: number;
}

export async function fetchNotifications(unreadOnly = false): Promise<Notification[]> {
  const res = await api.get<Notification[]>("/notifications", {
    params: { unread_only: unreadOnly, limit: 50 },
  });
  return res.data;
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await api.get<UnreadCount>("/notifications/count");
  return res.data.unread;
}

export async function markOneRead(id: number): Promise<Notification> {
  const res = await api.post<Notification>(`/notifications/${id}/read`);
  return res.data;
}

export async function markAllRead(): Promise<void> {
  await api.post("/notifications/read-all");
}

export async function dismissNotification(id: number): Promise<void> {
  await api.delete(`/notifications/${id}`);
}