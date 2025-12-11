// src/hooks/useSites.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { SitesListResponse, SiteDetail } from '../types/site';

export function useSites(params: { page?: number; per_page?: number; search?: string } = {}) {
  return useQuery({
    queryKey: ['sites', params],
    queryFn: async () => {
      const { data } = await api.get<SitesListResponse>('/sites', { params });
      return data.items || data;
    }
  });
}

export function useSite(id: string) {
  return useQuery({
    queryKey: ['site', id],
    queryFn: async () => {
      const { data } = await api.get<SiteDetail>(`/sites/${id}`);
      return data;
    },
    enabled: !!id
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (site: Partial<SiteDetail>) => api.post('/sites', site),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites'] })
  });
}

export function useUpdateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...site }: Partial<SiteDetail> & { id: string }) =>
      api.put(`/sites/${id}`, site),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['site', variables.id] });
    }
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/sites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites'] })
  });
}
