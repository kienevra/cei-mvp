const DEFAULT_API = ((): string => {
  try {
    if (typeof window !== "undefined" && window.location) {
      // running in browser; prefer same-origin + /api/v1
      return `${window.location.origin}/api/v1`;
    }
  } catch (_) {
    // ignore
  }

  // Build-time env (Vite) -> import.meta.env
  // Also fallback to process.env.* for compatibility if you previously used that.
  const vite = (import.meta as any).env?.VITE_API_URL;
  const nextPublic = (process.env as any).NEXT_PUBLIC_API_URL;
  const procVite = (process.env as any).VITE_API_URL;

  return vite || nextPublic || procVite || "http://localhost:8000/api/v1";
})();
