// src/types/auth.ts

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * Organization summary as returned by /account/me (or equivalent),
 * including plan flags and pricing analytics inputs.
 */
export interface OrganizationSummary {
  id: number;
  name: string;

  // Plan / feature gating
  plan_key?: string | null; // backend may include this
  subscription_plan_key?: string | null;
  subscription_status?: string | null;
  enable_alerts?: boolean | null;
  enable_reports?: boolean | null;

  // Pricing analytics inputs
  // Backend currently stores/returns this as a comma-separated string (e.g. "electricity,gas")
  primary_energy_sources?: string | null;
  electricity_price_per_kwh?: number | null;
  gas_price_per_kwh?: number | null;
  currency_code?: string | null;
}

export type UserRole = "owner" | "member" | "admin";

/**
 * Account "me" payload – user plus org context.
 * Tariff fields are on the organization summary above.
 */
export interface AccountMe {
  id: number;
  email: string;
  full_name?: string | null;

  organization_id?: number | null;

  // Roles & permissions (Step 4)
  role?: UserRole | null;

  // Backend may return org under either key; we support both in UI code.
  org?: OrganizationSummary | null;
  organization?: OrganizationSummary | null;

  // Some endpoints mirror these at the top-level as well
  subscription_plan_key?: string | null;
  subscription_status?: string | null;
  enable_alerts?: boolean | null;
  enable_reports?: boolean | null;

  // Optional top-level mirrors (backend may include)
  primary_energy_sources?: string | null;
  electricity_price_per_kwh?: number | null;
  gas_price_per_kwh?: number | null;
  currency_code?: string | null;
}

export interface OrgSettingsUpdateRequest {
  primary_energy_sources?: string | null;
  electricity_price_per_kwh?: number | null;
  gas_price_per_kwh?: number | null;
  currency_code?: string | null;
}
