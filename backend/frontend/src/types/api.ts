// Common interfaces for API responses and data types

export interface Site {
  id: number;
  name: string;
  location: string;
  kpis: {
    energy_kwh: number;
    avg_power_kw: number;
    peak_kw: number;
    load_factor: number;
  };
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface Opportunity {
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