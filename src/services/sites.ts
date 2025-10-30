import api from "./api";

export interface Site {
  id: string;
  name: string;
  location?: string;
  meters?: string[];
  [key: string]: any;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export async function fetchSites(): Promise<Site[]> {
  try {
    const res = await api.get<ApiResponse<Site[]>>("/sites");
    return res.data.data;
  } catch (err: any) {
    throw new Error(err?.response?.data?.message || "Failed to fetch sites");
  }
}

export async function fetchSite(id: string): Promise<Site> {
  try {
    const res = await api.get<ApiResponse<Site>>(`/sites/${id}`);
    return res.data.data;
  } catch (err: any) {
    throw new Error(err?.response?.data?.message || `Failed to fetch site ${id}`);
  }
}

export async function fetchSiteTimeseries(id: string, params?: Record<string, any>): Promise<any[]> {
  try {
    const res = await api.get<ApiResponse<any[]>>(`/sites/${id}/timeseries`, { params });
    return res.data.data;
  } catch (err: any) {
    throw new Error(err?.response?.data?.message || `Failed to fetch timeseries for site ${id}`);
  }
}

export async function createSite(payload: Partial<Site>): Promise<Site> {
  try {
    const res = await api.post<ApiResponse<Site>>("/sites", payload);
    return res.data.data;
  } catch (err: any) {
    throw new Error(err?.response?.data?.message || "Failed to create site");
  }
}