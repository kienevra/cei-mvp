// src/services/productionApi.ts
import api from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CorrelationDay {
  date: string;
  kwh: number;
  units_produced: number;
  kwh_per_unit: number;
  unit_label: string;
  is_anomaly: boolean;
  anomaly_reason: string | null;
}

export interface ProductionCorrelationResponse {
  site_id: number;
  start: string;
  end: string;
  unit_label: string;
  days: CorrelationDay[];
  trend_slope: number | null;
  trend_direction: "improving" | "worsening" | "stable" | "insufficient_data";
  mean_kwh_per_unit: number | null;
  best_day: CorrelationDay | null;
  worst_day: CorrelationDay | null;
  anomaly_count: number;
  coverage_days: number;
  total_days_requested: number;
}

export interface ProductionUploadResponse {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ─── API Calls ────────────────────────────────────────────────────────────────

export async function fetchProductionCorrelation(
  siteId: number | string,
  start: string,
  end: string
): Promise<ProductionCorrelationResponse> {
  // Axios interceptor adds Authorization header automatically.
  // Pass start/end as params so axios handles URL encoding (no & issues).
  const resp = await api.get<ProductionCorrelationResponse>(
    `/analytics/sites/${siteId}/production-correlation`,
    { params: { start, end } }
  );
  return resp.data;
}

export async function uploadProductionCsv(
  siteId: number | string,
  file: File
): Promise<ProductionUploadResponse> {
  const form = new FormData();
  form.append("file", file);

  // axios sets Content-Type: multipart/form-data with boundary automatically
  // when body is FormData — do NOT set it manually.
  const resp = await api.post<ProductionUploadResponse>(
    `/analytics/sites/${siteId}/production-upload`,
    form
  );
  return resp.data;
}