import axios from "axios";

/**
 * Runtime-friendly API base URL:
 * - In browser: use same origin + /api/v1 (preferred for Vercel serving frontend)
 * - Else: fall back to build-time env VITE_API_URL / NEXT_PUBLIC_API_URL
 * - Final fallback: the Render backend URL provided
 */
function getApiBase(): string {
  try {
    if (typeof window !== "undefined" && window.location && window.location.origin) {
      // If the frontend is loaded in the browser, use that origin at runtime.
      return `${window.location.origin}/api/v1`;
    }
  } catch (e) {
    // ignore
  }

  // build-time environment variables injected by Vite/Next or an explicit Render URL
  const fromEnv = (process?.env?.VITE_API_URL || process?.env?.NEXT_PUBLIC_API_URL);
  if (fromEnv && fromEnv.length) return fromEnv;

  // Last resort (use your Render backend URL)
  return "https://cei-mvp.onrender.com/api/v1";
}

const DEFAULT_API = getApiBase();

const api = axios.create({
  baseURL: DEFAULT_API,
  timeout: 10000,
});

export default api;
