import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { Site, SitesListResponse } from "../types/site";

// Fix: react-query v4 expects queryKey as array, and mutationFn should match types
export function useSites(params?: { page?: number; per_page?: number; search?: string }) {
  return useQuery<Site[], Error>({
    queryKey: ["sites", params],
    queryFn: async () => {
      const res = await api.get<SitesListResponse>("/sites", { params });
      // Defensive: handle both array and { items: [...] }
      if (Array.isArray(res.data)) return res.data;
      if ("items" in res.data && Array.isArray(res.data.items)) return res.data.items;
      return [];
    },
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  return useMutation<Site, Error, Partial<Site>>({
    mutationFn: async (site) => {
      const res = await api.post<Site>("/sites", site);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useUpdateSite() {
  const queryClient = useQueryClient();
  return useMutation<Site, Error, { id: string; site: Partial<Site> }>({
    mutationFn: async ({ id, site }) => {
      const res = await api.put<Site>(`/sites/${id}`, site);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete(`/sites/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}