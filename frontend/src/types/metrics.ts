// src/types/metrics.ts

export interface MetricPoint {
  timestamp: string;
  value: number;
  type?: string;
}

export interface MetricsResponse {
  site_id: string;
  range: string;
  metrics: MetricPoint[];
}

export interface AggregateMetricsResponse {
  kpis: {
    total_sites: number;
    avg_carbon_intensity: number;
    recent_alerts: number;
    [key: string]: number;
  };
  timeseries: MetricPoint[];
}

export type Metric = {
  timestamp: string;
  value: number;
  [key: string]: any;
};
