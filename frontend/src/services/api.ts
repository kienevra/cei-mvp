import axios from "axios";

/**
 * Runtime-friendly API base URL:
 * - If running in a browser, use the same origin + /api/v1 (works when frontend is served from Vercel)
 * - Else fall back to VITE_API_URL (build-time env), NEXT_PUBLIC_API_URL, or localhost for dev.
 */
const DEFAULT_API = ((): string => {
  try {
    if (typeof window !== "undefined" && window.location) {
      // When the frontend is hosted (Vercel), this will point to the Vercel origin.
      // If you want to force Render regardless of origin, set VITE_API_URL in Vercel env.
      return `${window.location.origin}/api/v1`;
    }
  } catch (_) {
    // ignore
  }
  return (process.env.VITE_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1");
})();

const api = axios.create({
  baseURL: DEFAULT_API,
  timeout: 10000,
});

export default api;
