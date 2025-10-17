// src/types/api.ts

export interface ApiError {
  message: string;
  status?: number;
  details?: any;
}
  id: number;
  name: string;
  description: string;
  simple_roi_years: number;
  est_co2_tons_saved_per_year: number;
  est_annual_kwh_saved: number;
  est_capex_eur: number;
}

export interface Metric {
  ts: string;
  value: number;
}

export interface SitesResponse {
  sites: Site[];
}

export interface OpportunitiesResponse {
  opportunities: Opportunity[];
}

export interface MetricsResponse {
  metrics: Metric[];
}