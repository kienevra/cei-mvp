import api from './api';

export async function fetchKpis(): Promise<{ totalSites: number; avgEfficiency: number; outstandingOpps: number }> {
  // Wire to backend analytics endpoint
  const res = await api.get('/analytics/kpis');
  return res.data;
}

export async function fetchTimeSeries(params?: Record<string, any>): Promise<any[]> {
  // Wire to backend timeseries endpoint
  const res = await api.get('/analytics/timeseries', { params });
  return res.data;
}