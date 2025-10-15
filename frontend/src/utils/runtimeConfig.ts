export function getRuntimeApiBase(): string {
  const envUrl =
    import.meta.env.VITE_API_URL ||
    import.meta.env.NEXT_PUBLIC_API_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location) {
    return `${window.location.origin}/api/v1`;
  }
  return "http://localhost:8000/api/v1";
}