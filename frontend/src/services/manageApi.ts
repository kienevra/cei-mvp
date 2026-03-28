// frontend/src/services/manageApi.ts
import api from "./api";

// ---------------------------------------------------------------------------
// Types — Portfolio
// ---------------------------------------------------------------------------

export type ClientOrgIngestionStats = {
  org_id: number;
  org_name: string;
  total_records: number;
  active_sites: number;
  last_ingestion_at: string | null;
  records_last_24h: number;
  records_last_7d: number;
};

export type PortfolioSummary = {
  managing_org_id: number;
  managing_org_name: string;
  total_client_orgs: number;
  total_sites: number;
  total_timeseries_records: number;
  open_alerts_total: number;
  clients_with_recent_ingestion: number;
  clients_without_recent_ingestion: number;
  generated_at: string;
  clients: ClientOrgIngestionStats[];
};

export type ClientOrgKPI = {
  org_id: number;
  org_name: string;
  currency_code: string | null;
  primary_energy_sources: string | null;
  electricity_price_per_kwh: number | null;
  gas_price_per_kwh: number | null;
  total_records: number;
  records_last_24h: number;
  records_last_7d: number;
  last_ingestion_at: string | null;
  total_sites: number;
  active_sites: number;
  open_alerts: number;
  critical_alerts: number;
  active_tokens: number;
};

export type PortfolioAnalytics = {
  managing_org_id: number;
  managing_org_name: string;
  window_days: number;
  generated_at: string;
  total_records_in_window: number;
  total_open_alerts: number;
  total_critical_alerts: number;
  total_active_tokens: number;
  clients: ClientOrgKPI[];
};

export type OnboardingStep = {
  key: string;
  label: string;
  complete: boolean;
  detail: string | null;
};

export type OnboardingStatus = {
  managing_org_id: number;
  managing_org_name: string;
  all_complete: boolean;
  steps: OnboardingStep[];
  generated_at: string;
};

// ---------------------------------------------------------------------------
// Types — Client org detail
// ---------------------------------------------------------------------------

export type ClientOrg = {
  id: number;
  name: string;
  org_type: string;
  managed_by_org_id: number | null;
  client_limit: number | null;
  primary_energy_sources: string | null;
  electricity_price_per_kwh: number | null;
  gas_price_per_kwh: number | null;
  currency_code: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  created_at: string | null;
};

export type Site = {
  id: number;
  name: string;
  location: string | null;
  org_id: number | null;
  site_id: string | null;
  created_at: string | null;
};

export type IntegrationToken = {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

export type IntegrationTokenWithSecret = IntegrationToken & { token: string };

export type ClientOrgUser = {
  id: number;
  email: string;
  role: string | null;
  is_active: number | null;
  created_at: string | null;
};

export type AlertThresholds = {
  org_id: number;
  scope: string;
  site_id: string | null;
  has_custom_thresholds: boolean;
  night_warning_ratio: number;
  night_critical_ratio: number;
  spike_warning_ratio: number;
  portfolio_share_info_ratio: number;
  weekend_warning_ratio: number;
  weekend_critical_ratio: number;
  min_points: number;
  min_total_kwh: number;
  updated_at: string | null;
};

export type InviteUserOut = {
  invite_id: number;
  email: string;
  role: string;
  client_org_id: number;
  client_org_name: string;
  expires_at: string;
  token: string;
  accept_url_hint: string;
};

// ---------------------------------------------------------------------------
// Portfolio API
// ---------------------------------------------------------------------------

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const resp = await api.get("/manage/portfolio");
  return resp.data as PortfolioSummary;
}

export async function getPortfolioAnalytics(windowDays = 7): Promise<PortfolioAnalytics> {
  const resp = await api.get(`/manage/portfolio/analytics?window_days=${windowDays}`);
  return resp.data as PortfolioAnalytics;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const resp = await api.get("/manage/onboarding/status");
  return resp.data as OnboardingStatus;
}

export async function downloadClientReport(clientOrgId: number): Promise<void> {
  const resp = await api.get(`/manage/client-orgs/${clientOrgId}/report/pdf`, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(new Blob([resp.data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `cei_report_client_${clientOrgId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Client org CRUD
// ---------------------------------------------------------------------------

export async function getClientOrg(clientOrgId: number): Promise<ClientOrg> {
  const resp = await api.get(`/manage/client-orgs/${clientOrgId}`);
  return resp.data as ClientOrg;
}

export async function updateClientOrgPricing(
  clientOrgId: number,
  payload: {
    primary_energy_sources?: string;
    electricity_price_per_kwh?: number | null;
    gas_price_per_kwh?: number | null;
    currency_code?: string;
  }
): Promise<ClientOrg> {
  const resp = await api.patch(`/manage/client-orgs/${clientOrgId}/pricing`, payload);
  return resp.data as ClientOrg;
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export async function listClientOrgSites(clientOrgId: number): Promise<Site[]> {
  const resp = await api.get(`/manage/client-orgs/${clientOrgId}/sites`);
  return resp.data as Site[];
}

export async function createClientOrgSite(
  clientOrgId: number,
  payload: { name: string; location?: string }
): Promise<Site> {
  const resp = await api.post(`/manage/client-orgs/${clientOrgId}/sites`, payload);
  return resp.data as Site;
}

export async function deleteClientOrgSite(
  clientOrgId: number,
  siteId: number
): Promise<void> {
  await api.delete(`/manage/client-orgs/${clientOrgId}/sites/${siteId}`);
}

// ---------------------------------------------------------------------------
// Integration tokens
// ---------------------------------------------------------------------------

export async function listClientOrgTokens(clientOrgId: number): Promise<IntegrationToken[]> {
  const resp = await api.get(`/manage/client-orgs/${clientOrgId}/integration-tokens`);
  return resp.data as IntegrationToken[];
}

export async function createClientOrgToken(
  clientOrgId: number,
  name: string
): Promise<IntegrationTokenWithSecret> {
  const resp = await api.post(`/manage/client-orgs/${clientOrgId}/integration-tokens`, { name });
  return resp.data as IntegrationTokenWithSecret;
}

export async function revokeClientOrgToken(
  clientOrgId: number,
  tokenId: number
): Promise<void> {
  await api.delete(`/manage/client-orgs/${clientOrgId}/integration-tokens/${tokenId}`);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listClientOrgUsers(clientOrgId: number): Promise<ClientOrgUser[]> {
  const resp = await api.get(`/manage/client-orgs/${clientOrgId}/users`);
  return resp.data as ClientOrgUser[];
}

export async function inviteClientOrgUser(
  clientOrgId: number,
  payload: { email: string; role: string; expires_in_days: number }
): Promise<InviteUserOut> {
  const resp = await api.post(`/manage/client-orgs/${clientOrgId}/invite-user`, payload);
  return resp.data as InviteUserOut;
}

// ---------------------------------------------------------------------------
// Alert thresholds
// ---------------------------------------------------------------------------

export async function getClientOrgThresholds(clientOrgId: number): Promise<AlertThresholds> {
  const resp = await api.get(`/manage/client-orgs/${clientOrgId}/alert-thresholds`);
  return resp.data as AlertThresholds;
}

export async function updateClientOrgThresholds(
  clientOrgId: number,
  payload: Partial<AlertThresholds> & { scope: string }
): Promise<AlertThresholds> {
  const resp = await api.patch(`/manage/client-orgs/${clientOrgId}/alert-thresholds`, payload);
  return resp.data as AlertThresholds;
}

export type LinkRequest = {
  id: number;
  managing_org_id: number;
  managing_org_name: string;
  client_org_id: number;
  client_org_name: string;
  initiated_by: "consultant" | "org_owner";
  status: "pending" | "accepted" | "rejected" | "cancelled";
  message: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Consultant-side link request API
// ---------------------------------------------------------------------------

export async function consultantSendLinkRequest(
  targetOrgEmail: string,
  message?: string
): Promise<LinkRequest> {
  const resp = await api.post("/manage/link-requests", {
    target_org_email: targetOrgEmail,
    message: message || null,
  });
  return resp.data as LinkRequest;
}

export async function listConsultantLinkRequests(): Promise<LinkRequest[]> {
  const resp = await api.get("/manage/link-requests");
  return resp.data as LinkRequest[];
}

export async function consultantAcceptLinkRequest(requestId: number): Promise<LinkRequest> {
  const resp = await api.post(`/manage/link-requests/${requestId}/accept`);
  return resp.data as LinkRequest;
}

export async function consultantRejectLinkRequest(requestId: number): Promise<LinkRequest> {
  const resp = await api.post(`/manage/link-requests/${requestId}/reject`);
  return resp.data as LinkRequest;
}

export async function consultantCancelLinkRequest(requestId: number): Promise<void> {
  await api.delete(`/manage/link-requests/${requestId}`);
}

// ---------------------------------------------------------------------------
// Org-owner-side link request API
// ---------------------------------------------------------------------------

export async function orgSendLinkRequest(
  consultantEmail: string,
  message?: string
): Promise<LinkRequest> {
  const resp = await api.post("/org/link-requests", {
    consultant_email: consultantEmail,
    message: message || null,
  });
  return resp.data as LinkRequest;
}

export async function listOrgLinkRequests(): Promise<LinkRequest[]> {
  const resp = await api.get("/org/link-requests");
  return resp.data as LinkRequest[];
}

export async function orgAcceptLinkRequest(requestId: number): Promise<LinkRequest> {
  const resp = await api.post(`/org/link-requests/${requestId}/accept`);
  return resp.data as LinkRequest;
}

export async function orgRejectLinkRequest(requestId: number): Promise<LinkRequest> {
  const resp = await api.post(`/org/link-requests/${requestId}/reject`);
  return resp.data as LinkRequest;
}

export async function orgCancelLinkRequest(requestId: number): Promise<void> {
  await api.delete(`/org/link-requests/${requestId}`);
}