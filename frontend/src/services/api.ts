import axios from "axios";

const rawEnv = (import.meta as any).env || {};
const envBase = rawEnv.VITE_API_URL || "";
const base = envBase.replace(/\/+$/, "");
const baseURL = base ? (base.endsWith("/api/v1") ? base : `${base}/api/v1`) : "/api/v1";

const api = axios.create({
  baseURL,
  timeout: 10000,
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cei_token");
  if (token) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("cei_token");
      // UI should handle redirect to /login
    }
    return Promise.reject(err);
  }
);

// typed helper functions
export async function getSites() {
  try {
    const r = await api.get("/sites");
    return r.data;
  } catch (e: any) {
    // If the backend doesn't have /sites yet, treat 404 as "no sites"
    if (e?.response?.status === 404) {
      return [];
    }
    throw e;
  }
}

export async function createSite(payload: { name: string; location?: string }) {
  const r = await api.post("/sites", payload);
  return r.data;
}

export async function getSite(id: number | string) {
  const r = await api.get(`/sites/${id}`);
  return r.data;
}


export async function postTimeseriesBatch(payload: any[]) {
  const r = await api.post("/timeseries", payload);
  return r.data;
}

export async function uploadCsv(formData: FormData) {
  const r = await api.post("/upload-csv", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

export default api;
