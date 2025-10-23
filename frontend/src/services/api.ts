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
      // simple handling; route to /login in components using this service
      localStorage.removeItem("cei_token");
      // we can't navigate here (no router), caller should handle redirect
    }
    return Promise.reject(err);
  }
);

// typed helper functions
export async function getSites() {
  const r = await api.get("/sites").catch((e) => {
    throw e;
  });
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
