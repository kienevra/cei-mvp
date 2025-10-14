import axios from "axios";

/**
 * API base URL resolution:
 * 1) Prefer build-time env (VITE_API_URL or NEXT_PUBLIC_API_URL) — set this in Vercel.
 * 2) If not present, prefer runtime origin (window.location.origin).
 * 3) Final fallback: explicit Render backend URL.
 */
function getApiBase(): string {
  // 1) build-time envs injected at build
  const buildEnv = (process?.env?.VITE_API_URL || process?.env?.NEXT_PUBLIC_API_URL);
  if (buildEnv && buildEnv.length) {
    return buildEnv;
  }

  // 2) runtime — useful for local dev serving
  try {
    if (typeof window !== "undefined" && window.location && window.location.origin) {
      return `${window.location.origin}/api/v1`;
    }
  } catch (e) {
    // ignore
  }

  // 3) explicit fallback to your Render backend
  return "https://cei-mvp.onrender.com/api/v1";
}

const DEFAULT_API = getApiBase();

const api = axios.create({
  baseURL: DEFAULT_API,
  timeout: 10000,
});

export default api;
