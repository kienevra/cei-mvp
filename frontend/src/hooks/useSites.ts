// src/hooks/useSites.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { SitesListResponse, SiteSummary, SiteDetail } from '../types/site';

export function useSites(params: { page?: number; per_page?: number; search?: string } = {}) {
  return useQuery(['sites', params], async () => {
    const { data } = await api.get<SitesListResponse>('/sites', { params });
    return data.items || data;
  });
}

export function useSite(id: string) {
  return useQuery(['site', id], async () => {
    const { data } = await api.get<SiteDetail>(`/sites/${id}`);
    return data;
  }, { enabled: !!id });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  return useMutation(
    (site: Partial<SiteDetail>) => api.post('/sites', site),
    {
      onSuccess: () => queryClient.invalidateQueries(['sites'])
    }
  );
}

export function useUpdateSite() {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, ...site }: Partial<SiteDetail> & { id: string }) => api.put(`/sites/${id}`, site),
    {
      onSuccess: (_, { id }) => {
        queryClient.invalidateQueries(['sites']);
        queryClient.invalidateQueries(['site', id]);
      }
    }
  );
}

export function useDeleteSite() {
  const queryClient = useQueryClient();
  return useMutation(
    (id: string) => api.delete(`/sites/${id}`),
    {
      onSuccess: () => queryClient.invalidateQueries(['sites'])
    }
  );
}
