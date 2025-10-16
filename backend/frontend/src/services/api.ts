import axios from "axios";

/**
 * Runtime-friendly API base URL with build-time override:
 * 1. If VITE_API_URL is provided at build time (import.meta.env.VITE_API_URL) it will be embedded.
 * 2. Else, if running in browser use window.location.origin + /api/v1 (works for same-origin deployments).
 * 3. Else fallback to NEXT_PUBLIC_API_URL or localhost for dev.
 */
const DEFAULT_API = ((): string => {
  // Vite exposes build-time envs as import.meta.env
  const buildUrl = (import.meta as any).env?.VITE_API_URL || (import.meta as any).env?.NEXT_PUBLIC_API_URL;
  if (buildUrl && buildUrl !== "") {
    // ensure no trailing slash
    return buildUrl.replace(/\/+$/, "");
  }

  try {
    if (typeof window !== "undefined" && window.location) {
      return `${window.location.origin}/api/v1`;
    }
  } catch (_) {
    // ignore
  }

  // Fallbacks
  // For Node-based builds or tests, you might still read process.env
  const nodeEnvUrl = (process.env as any).VITE_API_URL || (process.env as any).NEXT_PUBLIC_API_URL;
  if (nodeEnvUrl) return nodeEnvUrl.replace(/\/+$/, "");

  return "http://localhost:8000/api/v1";
})();

const api = axios.create({
  baseURL: DEFAULT_API,
  timeout: 10000,
});

export default api;
