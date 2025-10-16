import api from "./api";
import { Site } from "../types/site";

export async function getSites(): Promise<Site[]> {
  const res = await api.get("/sites");
  if (Array.isArray(res.data)) return res.data;
  if ("items" in res.data && Array.isArray(res.data.items)) return res.data.items;
  return [];
}

export async function getSite(id: string): Promise<Site> {
  const res = await api.get(`/sites/${id}`);
  return res.data;
}

export async function createSite(payload: Partial<Site>): Promise<Site> {
  const res = await api.post("/sites", payload);
  return res.data;
}

export async function updateSite(id: string, payload: Partial<Site>): Promise<Site> {
  const res = await api.put(`/sites/${id}`, payload);
  return res.data;
}

export async function deleteSite(id: string): Promise<void> {
  await api.delete(`/sites/${id}`);
}