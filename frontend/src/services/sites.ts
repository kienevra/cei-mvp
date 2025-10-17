import api from "./api";
import { Site } from "../types/Site";

export async function getSites(): Promise<Site[]> {
  const { data } = await api.get("/sites");
  // TODO: adapt if backend returns { items: [...] }
  return Array.isArray(data) ? data : data.items;
}

export async function getSite(id: string): Promise<Site> {
  const { data } = await api.get(`/sites/${id}`);
  return data;
}

export async function createSite(payload: Partial<Site>): Promise<Site> {
  const { data } = await api.post("/sites", payload);
  return data;
}

export async function updateSite(id: string, payload: Partial<Site>): Promise<Site> {
  const { data } = await api.put(`/sites/${id}`, payload);
  return data;
}

export async function deleteSite(id: string): Promise<void> {
  await api.delete(`/sites/${id}`);
}