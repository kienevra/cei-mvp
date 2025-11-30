import axios, {
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import { SiteForecast } from "../types/api";

const rawEnv = (import.meta as any).env || {};
const envBase = rawEnv.VITE_API_URL || "";
const base = envBase.replace(/\/+$/, "");
export const baseURL = base
  ? base.endsWith("/api/v1")
    ? base
    : `${base}/api/v1`
  : "/api/v1";

const api = axios.create({
  baseURL,
  timeout: 10000,
  // Needed so the HttpOnly refresh cookie is sent/received for cross-origin calls
  withCredentials: true,
});

// Attach access token on every request
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cei_token");
  if (token) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

function isAuthPath(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/signup") ||
    url.includes("/auth/refresh")
  );
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const originalRequest = error.config as AxiosRequestConfig & {
      _retry?: boolean;
    };

    if (status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    const url = originalRequest.url || "";

    // Do NOT attempt refresh for login/signup/refresh – just fail clearly
    if (isAuthPath(url)) {
      return Promise.reject(error);
    }

    // Prevent infinite loops
    if (originalRequest._retry) {
      localStorage.removeItem("cei_token");
      window.location.href = "/login?reason=session_expired";
      return Promise.reject(error);
    }
    originalRequest._retry = true;

    const currentToken = localStorage.getItem("cei_token");
    if (!currentToken) {
      window.location.href = "/login?reason=session_expired";
      return Promise.reject(error);
    }

    // Single refresh pipeline
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = (async () => {
        try {
          const resp = await axios.post(
            `${baseURL}/auth/refresh`,
            {},
            {
              // Ensure HttpOnly refresh cookie is sent and new one is accepted
              withCredentials: true,
              // We still send the current access token; backend ignores it and
              // only trusts the cookie, but this keeps things backwards-safe.
              headers: { Authorization: `Bearer ${currentToken}` },
              timeout: 8000,
            }
          );
          const newToken = (resp.data as any)?.access_token as
            | string
            | undefined;
          if (!newToken) {
            throw new Error("No access_token in refresh response");
          }
          localStorage.setItem("cei_token", newToken);
          return newToken;
        } catch (e) {
          localStorage.removeItem("cei_token");
          window.location.href = "/login?reason=session_expired";
          throw e;
        } finally {
          isRefreshing = false;
        }
      })();
    }

    try {
      const newToken = await refreshPromise!;
      if (!newToken) {
        throw new Error("Refresh failed");
      }

      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch (e) {
      return Promise.reject(e);
    }
  }
);

/* ===== KPI type for /analytics/sites/{site_id}/kpi ===== */

export type SiteKpi = {
  site_id: string;
  now_utc: string;

  last_24h_kwh: number;
  baseline_24h_kwh: number | null;
  deviation_pct_24h: number | null;

  last_7d_kwh: number;
  prev_7d_kwh: number | null;
  deviation_pct_7d: number | null;
};

/* ===== Typed helper functions ===== */

export async function getSites() {
  try {
    const r = await api.get("/sites");
    return Array.isArray(r.data) ? r.data : [];
  } catch (e) {
    // If backend returns 404 for no sites, treat as empty list
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      return [];
    }
    throw e;
  }
}

export async function getSite(id: string | number) {
  const r = await api.get(`/sites/${id}`);
  return r.data;
}

export async function createSite(payload: {
  name: string;
  location?: string;
}) {
  const r = await api.post("/sites", payload);
  return r.data;
}

export async function deleteSite(id: string | number) {
  const r = await api.delete(`/sites/${id}`);
  return r.data;
}

export async function getTimeseriesSummary(params: {
  site_id?: string;
  meter_id?: string;
  window_hours?: number;
}) {
  const r = await api.get("/timeseries/summary", { params });
  return r.data;
}

export async function getTimeseriesSeries(params: {
  site_id?: string;
  meter_id?: string;
  window_hours?: number;
  resolution?: "hour" | "day";
}) {
  const r = await api.get("/timeseries/series", { params });
  return r.data;
}

export async function uploadCsv(formData: FormData) {
  const r = await api.post("/upload-csv", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

export async function deleteAccount() {
  const r = await api.delete("/account/me");
  return r.data;
}

/**
 * Analytics insights for a site.
 *
 * Second argument is interpreted as window_hours, matching
 * /analytics/sites/{site_id}/insights?window_hours=...
 */
export async function getSiteInsights(
  siteId: number | string,
  windowHours?: number
) {
  const idStr = String(siteId);
  const params: Record<string, number> = {};

  if (typeof windowHours === "number") {
    params.window_hours = windowHours;
  }

  const resp = await api.get(`/analytics/sites/${idStr}/insights`, {
    params,
  });
  return resp.data;
}

/**
 * Site KPI snapshot: hits /analytics/sites/{id}/kpi on the backend.
 * Used by SiteView for 24h vs baseline and 7d vs previous 7d.
 */
export async function getSiteKpi(
  siteId: number | string
): Promise<SiteKpi> {
  const idStr = String(siteId);
  const resp = await api.get<SiteKpi>(`/analytics/sites/${idStr}/kpi`);
  return resp.data;
}

/**
 * Stub predictive forecast: hits /analytics/sites/{id}/forecast on the backend.
 * Uses the same axios client and baseURL (/api/v1) as the rest of the API.
 */
export async function getSiteForecast(
  siteId: number | string,
  params: {
    horizon_hours?: number;
    lookback_days?: number;
    resolution?: "hour" | "day";
    history_window_hours?: number;
  } = {}
): Promise<SiteForecast> {
  const idStr = String(siteId);
  const {
    horizon_hours = 24,
    lookback_days = 30,
    resolution = "hour",
    history_window_hours = 24,
  } = params;

  const resp = await api.get(`/analytics/sites/${idStr}/forecast`, {
    params: {
      horizon_hours,
      lookback_days,
      resolution,
      history_window_hours,
    },
  });

  return resp.data as SiteForecast;
}

export async function getAlerts(params: { window_hours?: number } = {}) {
  const resp = await api.get("/alerts", { params });
  return resp.data;
}

/* ===== Alerts history + workflow (backend: /alerts/history, PATCH /alerts/{id}) ===== */

export type AlertStatus = "open" | "ack" | "resolved" | "muted";

export interface AlertEvent {
  id: number;
  site_id: string | null;
  site_name: string | null;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  metric: string | null;
  window_hours: number | null;

  status: AlertStatus;
  owner_user_id: number | null;
  note: string | null;

  triggered_at: string;
  created_at: string;
  updated_at: string | null;
}

export interface AlertEventUpdatePayload {
  status?: AlertStatus;
  note?: string;
}

/**
 * Fetch historical alert stream from /alerts/history.
 * Mirrors backend query params.
 */
export async function getAlertHistory(
  params: {
    siteId?: string;
    status?: AlertStatus;
    severity?: "critical" | "warning" | "info";
    limit?: number;
  } = {}
): Promise<AlertEvent[]> {
  const query: Record<string, string | number> = {};

  if (params.siteId) query["site_id"] = params.siteId;
  if (params.status) query["status"] = params.status;
  if (params.severity) query["severity"] = params.severity;
  if (params.limit) query["limit"] = params.limit;

  const res = await api.get<AlertEvent[]>("/alerts/history", {
    params: query,
  });
  return res.data;
}

/**
 * Update a single alert event (status / note).
 */
export async function updateAlertEvent(
  id: number,
  payload: AlertEventUpdatePayload
): Promise<AlertEvent> {
  const res = await api.patch<AlertEvent>(`/alerts/${id}`, payload);
  return res.data;
}

/**
 * Fetch current account/org info, if the backend exposes it.
 * This is best-effort; UI will degrade gracefully if it fails.
 */
export async function getAccountMe() {
  const resp = await api.get("/account/me");
  return resp.data;
}

/**
 * Start a Stripe Checkout session for a given plan.
 * Backend returns: { provider: "stripe", checkout_url: string }
 * We normalize to { url?: string } for existing callers.
 */
export async function startCheckout(planKey: string) {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const success_url = `${origin}/account?billing=success`;
  const cancel_url = `${origin}/account?billing=cancel`;

  const resp = await api.post("/billing/checkout-session", {
    plan_key: planKey,
    success_url,
    cancel_url,
  });

  const data = resp.data as {
    provider?: string;
    checkout_url?: string;
    url?: string;
  };

  // Prefer the explicit checkout_url, fall back to url if we ever change backend
  const url = data.checkout_url || data.url;
  return { url };
}

/**
 * Open the Stripe Billing Portal for the current org.
 * Backend returns: { provider: "stripe", portal_url: string }
 * We normalize to { url?: string } for existing callers.
 */
export async function openBillingPortal() {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const return_url = `${origin}/account`;

  const resp = await api.post("/billing/portal-session", {
    return_url,
  });

  const data = resp.data as {
    provider?: string;
    portal_url?: string;
    url?: string;
  };

  const url = data.portal_url || data.url;
  return { url };
}

export default api;
