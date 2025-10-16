import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { Metrics } from "../types/metrics";

// Example: fetch metrics for a site
export function useSiteMetrics(siteId: string) {
  return useQuery<Metrics[], Error>({
    queryKey: ["metrics", siteId],
    queryFn: async () => {
      const res = await api.get(`/sites/${siteId}/metrics`);
      // TODO: Confirm backend shape
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!siteId,
  });
}

// Example: fetch global metrics
export function useGlobalMetrics() {
  return useQuery<Metrics[], Error>({
    queryKey: ["metrics", "global"],
    queryFn: async () => {
      const res = await api.get("/metrics");
      // TODO: Confirm backend shape
      return Array.isArray(res.data) ? res.data : [];
    },
  });
}