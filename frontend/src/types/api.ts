export interface ApiError {
  message: string;
  status?: number;
  details?: any;
}

export interface Site {
  id: number;
  name: string;
  description: string;
  simple_roi_years: number;
  est_co2_tons_saved_per_year: number;
  est_annual_kwh_saved: number;
  est_capex_eur: number;
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

/**
 * === Analytics / Insights types ===
 * These mirror the payload from:
 *   GET /api/v1/analytics/sites/{site_id}/insights
 * including the statistical baseline profile.
 */

export interface BaselineBucket {
  hour_of_day: number;      // 0–23
  is_weekend: boolean;
  mean_kwh: number;
  std_kwh: number;
}

export interface BaselineProfile {
  site_id: string;
  meter_id?: string | null;
  lookback_days: number;
  global_mean_kwh: number;
  global_p50_kwh: number;
  global_p90_kwh: number;
  n_points: number;

  // Warm-up / confidence metadata (additive)
  total_history_days?: number | null;
  is_warming_up?: boolean | null;
  confidence_level?: string | null;

  buckets: BaselineBucket[];
}

export type InsightBand = "normal" | "elevated" | "critical";

export interface SiteInsightHour {
  hour: number;          // 0–23
  actual_kwh: number;
  expected_kwh: number;
  delta_kwh: number;
  delta_pct: number;
  z_score: number;
  band: InsightBand;
}

export interface SiteInsights {
  site_id: string;
  window_hours: number;
  baseline_lookback_days: number;
  total_actual_kwh: number;
  total_expected_kwh: number;
  deviation_pct: number;
  critical_hours: number;
  elevated_hours: number;
  below_baseline_hours: number;
  hours: SiteInsightHour[];
  generated_at: string;

  // New: warm-up / confidence metadata (top-level from insights engine)
  total_history_days?: number | null;
  is_baseline_warming_up?: boolean | null;
  confidence_level?: string | null;

  // New statistical baseline profile
  baseline_profile?: BaselineProfile | null;
}

/**
 * === Forecast types ===
 * These mirror the payload from:
 *   GET /api/v1/analytics/sites/{site_id}/forecast
 */

export interface ForecastPoint {
  ts: string;               // ISO timestamp
  expected_kwh: number;
  lower_kwh: number | null;
  upper_kwh: number | null;
  basis?: string;           // e.g. "stub_baseline_v1"
}

export interface SiteForecast {
  site_id: string;
  history_window_hours?: number;
  horizon_hours: number;
  baseline_lookback_days?: number;
  generated_at: string;
  method?: string;          // e.g. "stub_baseline_v1"

  // Warm-up / confidence metadata for the baseline behind the forecast
  baseline_total_history_days?: number | null;
  baseline_is_warming_up?: boolean | null;
  baseline_confidence_level?: string | null;

  points: ForecastPoint[];
}
