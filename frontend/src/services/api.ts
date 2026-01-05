// frontend/src/services/api.ts
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { SiteForecast } from "../types/api";
import type { AccountMe, OrgSettingsUpdateRequest } from "../types/auth";

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
  timeout: 30000,
  withCredentials: true,
});

/* ===== Request-id (observability) helpers ===== */

function getRequestIdFromAxiosError(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;

  // axios normalizes headers keys to lowercase in browsers
  const headers: any = err.response?.headers || {};
  const fromHeader =
    (typeof headers["x-request-id"] === "string" && headers["x-request-id"]) ||
    (typeof headers["X-Request-ID"] === "string" && headers["X-Request-ID"]) ||
    (typeof headers["x-requestid"] === "string" && headers["x-requestid"]) ||
    null;

  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();

  const data: any = err.response?.data;
  const fromBody =
    typeof data?.request_id === "string"
      ? data.request_id
      : typeof data?.requestId === "string"
      ? data.requestId
      : null;

  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();

  return null;
}

function attachRequestId(err: unknown): void {
  const rid = getRequestIdFromAxiosError(err);
  if (!rid) return;

  // Attach in a stable, UI-friendly place
  try {
    (err as any).cei_request_id = rid;
  } catch {
    // ignore
  }
}

function appendSupportCode(msg: string, rid: string | null): string {
  if (!rid) return msg;
  // avoid duplicating
  if (msg && msg.toLowerCase().includes("support code:")) return msg;
  return `${msg} (Support code: ${rid})`;
}
/* ===== Request-id generation + propagation (end-to-end tracing) ===== */

function generateRequestId(): string {
  // Prefer crypto if available (modern browsers)
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return String(c.randomUUID());
  } catch {
    // ignore
  }

  // Fallback: reasonably unique, URL-safe
  return `cei_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

api.interceptors.request.use((cfg) => {
  cfg.headers = cfg.headers || {};

  // Don’t clobber an upstream proxy/client request id if someone set it.
  const hasExisting =
    typeof (cfg.headers as any)["X-Request-ID"] === "string" ||
    typeof (cfg.headers as any)["x-request-id"] === "string";

  if (!hasExisting) {
    (cfg.headers as any)["X-Request-ID"] = generateRequestId();
  }

  return cfg;
});

// Attach access token on every request except auth login/signup/refresh/invite-accept
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cei_token");
  if (!token) return cfg;

  const url = cfg.url || "";

  // Do NOT send stale tokens to login/signup/refresh/invite-accept.
  // All other /auth/* endpoints (like /auth/integration-tokens) stay authenticated.
  if (isAuthPath(url)) return cfg;

  cfg.headers = cfg.headers || {};
  cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

function isAuthPath(url: string | undefined): boolean {
  if (!url) return false;

  // NOTE:
  // - /org/invites/accept-and-signup is PUBLIC
  // - /auth/password/* should NOT trigger refresh pipeline; treat as auth path
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/signup") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/password/") ||
    url.includes("/org/invites/accept-and-signup")
  );
}

/* ===== Fix #3: stop hard-redirecting inside the API client ===== */

class SessionExpiredError extends Error {
  code = "SESSION_EXPIRED" as const;
  constructor(message: string = "Session expired. Please log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

function sessionExpired(): SessionExpiredError {
  try {
    localStorage.removeItem("cei_token");
  } catch {
    // ignore
  }
  return new SessionExpiredError();
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    // Observability: stamp request_id onto the error early
    attachRequestId(error);

    const status = error.response?.status;
    const originalRequest = error.config as AxiosRequestConfig & {
      _retry?: boolean;
    };

    if (status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    const url = originalRequest.url || "";

    // Do NOT attempt refresh for login/signup/refresh/invite-accept/password-reset – just fail clearly
    if (isAuthPath(url)) {
      return Promise.reject(error);
    }

    // Prevent infinite loops
    if (originalRequest._retry) {
      return Promise.reject(sessionExpired());
    }
    originalRequest._retry = true;

    const currentToken = localStorage.getItem("cei_token");
    if (!currentToken) {
      return Promise.reject(sessionExpired());
    }

    // Single refresh pipeline
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = (async () => {
        try {
          // Fix #1: refresh must NOT depend on (possibly expired) Authorization header.
          // Refresh cookie (HttpOnly) is the source of truth.
          const resp = await axios.post(
            `${baseURL}/auth/refresh`,
            {},
            {
              withCredentials: true,
              timeout: 8000,
            }
          );

          const newToken = (resp.data as any)?.access_token as string | undefined;
          if (!newToken) {
            throw new Error("No access_token in refresh response");
          }
          localStorage.setItem("cei_token", newToken);
          return newToken;
        } catch (e) {
          // Attach request_id if refresh failed
          attachRequestId(e);
          throw sessionExpired();
        } finally {
          // Fix #2: reset the pipeline completely
          isRefreshing = false;
          refreshPromise = null;
        }
      })();
    }

    try {
      const newToken = await refreshPromise!;
      if (!newToken) throw new Error("Refresh failed");

      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch (e) {
      attachRequestId(e);
      return Promise.reject(e);
    }
  }
);

/* ===== Small error helper (keeps UI messaging consistent) ===== */

function safeStringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function getApiErrorMessage(err: unknown, fallback: string): string {
  const rid = (err as any)?.cei_request_id || getRequestIdFromAxiosError(err) || null;

  if (axios.isAxiosError(err)) {
    const data: any = err.response?.data;

    if (data?.detail != null) {
      const detail =
        typeof data.detail === "string" ? data.detail : safeStringify(data.detail);
      return appendSupportCode(detail || fallback, rid);
    }

    if (data?.message != null) {
      const msg =
        typeof data.message === "string" ? data.message : safeStringify(data.message);
      return appendSupportCode(msg || fallback, rid);
    }

    const axMsg = typeof (err as any)?.message === "string" ? (err as any).message : "";
    return appendSupportCode(axMsg || fallback, rid);
  }

  if (err instanceof Error) return appendSupportCode(err.message || fallback, rid);
  return appendSupportCode(fallback, rid);
}

/* ===== Normalization helpers (UI contract hardening) ===== */

// Decimal/string-safe numeric parsing
const asNumber = (v: any): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

// Normalize AccountMe so pages don’t have to guess whether Decimals came back as strings
function normalizeAccountMe(data: any): AccountMe {
  const out: any = data ? { ...data } : {};

  const orgLike: any = out.org ?? out.organization ?? null;

  // Root-level (defensive)
  if ("electricity_price_per_kwh" in out) {
    const n = asNumber(out.electricity_price_per_kwh);
    if (n !== null) out.electricity_price_per_kwh = n;
  }
  if ("gas_price_per_kwh" in out) {
    const n = asNumber(out.gas_price_per_kwh);
    if (n !== null) out.gas_price_per_kwh = n;
  }

  // Org-level (canonical)
  if (orgLike && typeof orgLike === "object") {
    const orgOut: any = { ...orgLike };

    if ("electricity_price_per_kwh" in orgOut) {
      const n = asNumber(orgOut.electricity_price_per_kwh);
      if (n !== null) orgOut.electricity_price_per_kwh = n;
    }
    if ("gas_price_per_kwh" in orgOut) {
      const n = asNumber(orgOut.gas_price_per_kwh);
      if (n !== null) orgOut.gas_price_per_kwh = n;
    }

    // Keep whichever field name backend uses
    if (out.org) out.org = orgOut;
    if (out.organization) out.organization = orgOut;
  }

  return out as AccountMe;
}

// Normalize site ids for endpoints that are numeric-path-param based (e.g., /sites/{id}/...)
function normalizeNumericSiteId(siteId: string | number): string {
  const s = String(siteId).trim();
  if (s.toLowerCase().startsWith("site-")) return s.slice(5);
  return s;
}

/* ===== Auth helpers (login + signup) ===== */

export interface LoginPayload {
  username: string;
  password: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  full_name?: string;
  organization_name?: string;
  organization_id?: number;
}

export async function login(payload: LoginPayload) {
  const form = new URLSearchParams();
  form.set("username", payload.username);
  form.set("password", payload.password);

  const resp = await api.post("/auth/login", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return resp.data as { access_token: string; token_type: string };
}

export async function signup(payload: SignupPayload) {
  const resp = await api.post("/auth/signup", payload);
  return resp.data as { access_token: string; token_type: string };
}

/* ===== Password recovery ===== */

export async function requestPasswordReset(
  email: string
): Promise<{ detail: string; debug_reset_link?: string | null }> {
  try {
    const resp = await api.post("/auth/password/forgot", { email });
    return resp.data as any;
  } catch (err: any) {
    attachRequestId(err);
    throw new Error(getApiErrorMessage(err, "Failed to request password reset."));
  }
}

export async function resetPassword(
  token: string,
  new_password: string
): Promise<{ detail: string }> {
  try {
    const resp = await api.post("/auth/password/reset", { token, new_password });
    return resp.data as any;
  } catch (err: any) {
    attachRequestId(err);
    throw new Error(getApiErrorMessage(err, "Failed to reset password."));
  }
}

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

  currency_code?: string | null;

  last_24h_cost?: number | null;
  baseline_24h_cost?: number | null;
  delta_24h_cost?: number | null;

  cost_7d_actual?: number | null;
  cost_7d_baseline?: number | null;
  cost_7d_delta?: number | null;

  cost_24h_actual?: number | null;
  cost_24h_baseline?: number | null;
  cost_24h_delta?: number | null;
};

/* ===== Typed helper functions ===== */

export async function getSites() {
  try {
    const r = await api.get("/sites");
    return Array.isArray(r.data) ? r.data : [];
  } catch (e) {
    attachRequestId(e);
    if (axios.isAxiosError(e) && e.response?.status === 404) return [];
    throw e;
  }
}

export async function getSite(id: string | number) {
  const r = await api.get(`/sites/${id}`);
  return r.data;
}

export async function createSite(payload: { name: string; location?: string }) {
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

export async function uploadCsv(formData: FormData, opts?: { siteId?: string }) {
  const params: Record<string, string> = {};
  if (opts?.siteId) params.site_id = opts.siteId;

  const r = await api.post("/upload-csv", formData, {
    params,
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

export async function deleteAccount() {
  const r = await api.delete("/account/me");
  return r.data;
}

export async function getSiteInsights(siteKey: string, windowHours?: number) {
  const params: Record<string, number> = {};
  if (typeof windowHours === "number") params.window_hours = windowHours;

  const resp = await api.get(`/analytics/sites/${siteKey}/insights`, { params });
  return resp.data;
}

export async function getSiteKpi(siteKey: string): Promise<SiteKpi> {
  const resp = await api.get<SiteKpi>(`/analytics/sites/${siteKey}/kpi`);
  return resp.data;
}

// ===== Site opportunities (per-site measures) =====

export interface OpportunityMeasure {
  id: number;
  name: string;
  description: string;
  est_annual_kwh_saved: number;
  est_capex_eur: number;
  simple_roi_years: number;
  est_co2_tons_saved_per_year: number;
}

export async function getSiteOpportunities(
  siteId: string | number
): Promise<OpportunityMeasure[]> {
  // ✅ Accept "site-<id>" OR numeric id, normalize for numeric path params
  const idStr = normalizeNumericSiteId(siteId);

  const resp = await api.get<{ opportunities: OpportunityMeasure[] }>(
    `/sites/${idStr}/opportunities`
  );
  const list = (resp.data as any)?.opportunities;
  return Array.isArray(list) ? list : [];
}

/* ===== Ingest health types ===== */

export interface IngestHealthMeter {
  site_id: string;
  meter_id: string;
  window_hours: number;
  expected_points: number;
  actual_points: number;
  completeness_pct: number;
  last_seen: string;
}

export interface IngestHealthResponse {
  window_hours: number;
  meters: IngestHealthMeter[];
}

export async function getIngestHealth(
  windowHours: number = 24
): Promise<IngestHealthResponse> {
  const res = await api.get<IngestHealthResponse>("/timeseries/ingest_health", {
    params: { window_hours: windowHours },
  });
  return res.data;
}

export async function getSiteForecast(
  siteKey: string,
  params: {
    horizon_hours?: number;
    lookback_days?: number;
    resolution?: "hour" | "day";
    history_window_hours?: number;
  } = {}
): Promise<SiteForecast> {
  const {
    horizon_hours = 24,
    lookback_days = 30,
    resolution = "hour",
    history_window_hours = 24,
  } = params;

  const resp = await api.get(`/analytics/sites/${siteKey}/forecast`, {
    params: { horizon_hours, lookback_days, resolution, history_window_hours },
  });

  return resp.data as SiteForecast;
}

export async function getAlerts(params: { window_hours?: number } = {}) {
  const resp = await api.get("/alerts", { params });
  return resp.data;
}

/* ===== Alerts history + workflow ===== */

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

  const res = await api.get<AlertEvent[]>("/alerts/history", { params: query });
  return res.data;
}

export async function updateAlertEvent(
  id: number,
  payload: AlertEventUpdatePayload
): Promise<AlertEvent> {
  const res = await api.patch<AlertEvent>(`/alerts/${id}`, payload);
  return res.data;
}

/* ===== Account / org settings ===== */

export async function getAccountMe(): Promise<AccountMe> {
  const resp = await api.get<AccountMe>("/account/me");
  // ✅ Normalize decimals/strings into numbers once, centrally
  return normalizeAccountMe(resp.data);
}

export async function updateOrgSettings(
  payload: OrgSettingsUpdateRequest
): Promise<AccountMe> {
  try {
    const response = await api.patch<AccountMe>("/account/org-settings", payload);
    return normalizeAccountMe(response.data);
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new Error("Only the org owner can update tariff settings.");
    }
    throw new Error(getApiErrorMessage(err, "Failed to save organization settings."));
  }
}

/* ===== Billing ===== */

export async function startCheckout(planKey: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const success_url = `${origin}/account?billing=success`;
  const cancel_url = `${origin}/account?billing=cancel`;

  const resp = await api.post("/billing/checkout-session", {
    plan_key: planKey,
    success_url,
    cancel_url,
  });

  const data = resp.data as { provider?: string; checkout_url?: string; url?: string };
  const url = data.checkout_url || data.url;
  return { url };
}

export async function openBillingPortal() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const return_url = `${origin}/account`;

  const resp = await api.post("/billing/portal-session", { return_url });

  const data = resp.data as { provider?: string; portal_url?: string; url?: string };
  const url = data.portal_url || data.url;
  return { url };
}

/* ===== Integration tokens (owner-only) ===== */

export interface IntegrationTokenOut {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used_at?: string | null;
}

export interface IntegrationTokenWithSecret extends IntegrationTokenOut {
  token: string;
}

export async function listIntegrationTokens(): Promise<IntegrationTokenOut[]> {
  try {
    const resp = await api.get<IntegrationTokenOut[]>("/auth/integration-tokens");
    return Array.isArray(resp.data) ? resp.data : [];
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) return [];
    throw new Error(getApiErrorMessage(err, "Failed to load integration tokens."));
  }
}

export async function createIntegrationToken(
  name: string
): Promise<IntegrationTokenWithSecret> {
  try {
    const resp = await api.post<IntegrationTokenWithSecret>("/auth/integration-tokens", {
      name,
    });
    return resp.data;
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new Error("Only the org owner can manage integration tokens.");
    }
    throw new Error(getApiErrorMessage(err, "Failed to create integration token."));
  }
}

export async function revokeIntegrationToken(tokenId: number): Promise<void> {
  try {
    await api.delete(`/auth/integration-tokens/${tokenId}`);
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new Error("Only the org owner can manage integration tokens.");
    }
    throw new Error(getApiErrorMessage(err, "Failed to revoke integration token."));
  }
}

/* ===== Org invites (canonical) ===== */

export interface OrgInviteOut {
  id: number;

  organization_id?: number;
  org_id?: number;

  email?: string | null;
  role?: "owner" | "member" | string;
  is_active?: boolean;

  expires_at?: string | null;
  created_at?: string | null;

  accepted_at?: string | null;
  accepted_user_id?: number | null;

  revoked_at?: string | null;

  created_by_user_id?: number | null;

  status?: string;
  is_accepted?: boolean;
  is_expired?: boolean;
  can_accept?: boolean;
  can_revoke?: boolean;
  can_extend?: boolean;

  used_at?: string | null;
  used_by_user_id?: number | null;
}

export interface OrgInviteWithSecret extends OrgInviteOut {
  token: string | null;
  invite_link?: string | null;
}

export interface OrgInviteCreateRequest {
  email: string;
  role?: "owner" | "member";
  expires_in_days?: number;
}

export interface OrgInviteExtendRequest {
  expires_in_days?: number;
  role?: "owner" | "member";
}

export interface OrgInviteExtendedOut extends OrgInviteOut {
  token?: string | null;
}

export async function listOrgInvites(): Promise<OrgInviteOut[]> {
  try {
    const resp = await api.get<OrgInviteOut[]>("/org/invites");
    return Array.isArray(resp.data) ? resp.data : [];
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) return [];
    throw new Error(getApiErrorMessage(err, "Failed to load invites."));
  }
}

export async function createOrgInvite(
  payload: OrgInviteCreateRequest
): Promise<OrgInviteWithSecret> {
  try {
    const resp = await api.post<OrgInviteWithSecret>("/org/invites", payload);
    return resp.data;
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new Error("Owner-only. Only an org owner can generate invites.");
    }
    throw new Error(getApiErrorMessage(err, "Failed to create invite."));
  }
}

export async function revokeOrgInvite(inviteId: number): Promise<void> {
  try {
    await api.delete(`/org/invites/${inviteId}`);
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new Error("Owner-only. Only an org owner can revoke invites.");
    }
    throw new Error(getApiErrorMessage(err, "Failed to revoke invite."));
  }
}

export async function extendOrgInvite(
  inviteId: number,
  payload: OrgInviteExtendRequest
): Promise<OrgInviteExtendedOut> {
  try {
    const resp = await api.post<OrgInviteExtendedOut>(
      `/org/invites/${inviteId}/extend`,
      payload
    );
    return resp.data;
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new Error("Owner-only. Only an org owner can extend invites.");
    }
    throw new Error(getApiErrorMessage(err, "Failed to extend invite."));
  }
}

export async function acceptInvite(payload: {
  token: string;
  email: string;
  password: string;
  full_name?: string;
}) {
  const resp = await api.post("/org/invites/accept-and-signup", payload);
  return resp.data as { access_token: string; token_type: string };
}

/* ===== Org lifecycle (Leave + Offboard) ===== */

export type OffboardMode = "soft" | "nuke";

export async function leaveOrg(): Promise<{
  detached: boolean;
  user_id?: number;
  email?: string;
  previous_org_id?: number;
}> {
  try {
    const resp = await api.post("/org/leave");
    return resp.data as any;
  } catch (err: any) {
    attachRequestId(err);
    throw new Error(getApiErrorMessage(err, "Failed to leave organization."));
  }
}

export async function offboardOrg(params: {
  mode: OffboardMode;
  org_id?: number;
}): Promise<any> {
  const { mode, org_id } = params || ({} as any);

  const query: Record<string, string | number> = { mode };
  if (typeof org_id === "number" && Number.isFinite(org_id)) query["org_id"] = org_id;

  try {
    const resp = await api.delete("/org/offboard", { params: query });
    return resp.data;
  } catch (err: any) {
    attachRequestId(err);
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new Error("Owner-only. Only an org owner can offboard the organization.");
    }
    throw new Error(getApiErrorMessage(err, "Failed to offboard organization."));
  }
}

/* ===== Site events (timeline + operator notes) ===== */

export interface SiteEvent {
  id: number;
  site_id: string | null;
  site_name: string | null;

  type: string;
  title: string | null;
  body: string | null;

  created_at: string;
  created_by_user_id: number | null;
}

export async function getSiteEvents(
  siteId: string,
  windowHours: number = 168,
  limit: number = 100,
  page: number = 1
): Promise<SiteEvent[]> {
  const params: Record<string, string | number> = {
    site_id: siteId,
    window_hours: windowHours,
    limit,
    page,
  };

  const resp = await api.get<SiteEvent[]>("/site-events", { params });
  return resp.data;
}

export async function createSiteEvent(
  siteId: string,
  payload: { type?: string; title?: string; body?: string }
): Promise<SiteEvent> {
  const resp = await api.post<SiteEvent>(
    `/site-events/sites/${encodeURIComponent(siteId)}/events`,
    payload
  );
  return resp.data;
}

/* ===== Manual opportunities (DB-backed, per site) ===== */

export interface ManualOpportunity {
  id: number;
  site_id: number;
  name: string;
  description: string | null;
}

export async function getManualOpportunities(
  siteId: number | string
): Promise<ManualOpportunity[]> {
  const idStr = normalizeNumericSiteId(siteId);
  const resp = await api.get<ManualOpportunity[]>(`/sites/${idStr}/opportunities/manual`);
  return resp.data;
}

export async function createManualOpportunity(
  siteId: number | string,
  payload: { name: string; description?: string }
): Promise<ManualOpportunity> {
  const idStr = normalizeNumericSiteId(siteId);
  const resp = await api.post<ManualOpportunity>(
    `/sites/${idStr}/opportunities/manual`,
    payload
  );
  return resp.data;
}

export default api;
