import axios from "axios";

const rawEnv = (import.meta as any).env || {};
const envBase = rawEnv.VITE_API_URL || "";
const base = envBase.replace(/\/+$/, "");
const baseURL = base
  ? base.endsWith("/api/v1")
    ? base
    : `${base}/api/v1`
  : "/api/v1";

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
    const status = err?.response?.status;

    if (status === 401) {
      // Kill the session
      localStorage.removeItem("cei_token");

      // Best-effort redirect to login with a reason tag
      if (typeof window !== "undefined") {
        const currentPath = window.location.pathname || "";

        // Avoid redirect loops
        if (!currentPath.startsWith("/login")) {
          try {
            const url = new URL(window.location.href);
            url.pathname = "/login";
            url.searchParams.set("reason", "session_expired");
            window.location.href = url.toString();
          } catch {
            // Fallback if URL parsing ever explodes
            window.location.href = "/login?reason=session_expired";
          }
        }
      }
    }

    return Promise.reject(err);
  }
);


// === typed helper functions ===

export async function getSites() {
  const r = await api.get("/sites");
  return r.data;
}

export async function createSite(payload: { name: string; location?: string }) {
  const r = await api.post("/sites", payload);
  return r.data;
}

export async function getTimeseriesSummary(params: {
  site_id?: string;
  meter_id?: string;
  window_hours?: number;
}) {
  const r = await api.get("/timeseries/summary", { params });
  return r.data;
}

export async function getTimeseriesSeries(params: {
  site_id?: string;
  meter_id?: string;
  window_hours?: number;
  resolution?: "hour" | "day";
}) {
  const r = await api.get("/timeseries/series", { params });
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
