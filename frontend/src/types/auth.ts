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
  id: string;
  name: string;

  // Plan / feature gating
  subscription_plan_key?: string | null;
  subscription_status?: string | null;
  enable_alerts?: boolean;
  enable_reports?: boolean;

  // Pricing analytics inputs
  primary_energy_sources?: string[] | null;
  electricity_price_per_kwh?: number | null;
  gas_price_per_kwh?: number | null;
  currency_code?: string | null;
}

/**
 * Account "me" payload – user plus org context.
 * Tariff fields are on the organization summary above.
 */
export interface AccountMe {
  id: string;
  email: string;
  full_name?: string | null;

  organization?: OrganizationSummary | null;
}
