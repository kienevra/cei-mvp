// src/utils/runtimeConfig.ts

interface ImportMeta {
  env: {
    VITE_API_URL?: string;
    [key: string]: any;
  };
}

export function getApiBaseUrl(): string {
  // Priority: VITE_API_URL > window.__API_URL__ > same-origin /api/v1 > localhost fallback
  const viteEnv = import.meta.env.VITE_API_URL;
  if (viteEnv && typeof viteEnv === 'string') return viteEnv.replace(/\/+$/, '');
  // @ts-ignore
  if (window && window.__API_URL__) return window.__API_URL__;
  if (window && window.location) {
    return window.location.origin + '/api/v1';
  }
  return 'http://localhost:8000/api/v1';
}
