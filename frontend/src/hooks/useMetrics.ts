// src/hooks/useMetrics.ts
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { MetricsResponse, AggregateMetricsResponse } from '../types/metrics';

export function useSiteMetrics(siteId: string, range: string = '7d') {
  return useQuery(['site-metrics', siteId, range], async () => {
    const { data } = await api.get<MetricsResponse>(`/sites/${siteId}/metrics`, { params: { range } });
    return data;
  }, { enabled: !!siteId });
}

export function useAggregateMetrics(range: string = '30d') {
  return useQuery(['aggregate-metrics', range], async () => {
    const { data } = await api.get<AggregateMetricsResponse>(`/metrics/aggregate`, { params: { range } });
    return data;
  });
}
