import axios from 'axios';

// Robust baseURL determination
const envBase = (import.meta as any).env?.VITE_API_URL || "";
const base = envBase.replace(/\/+$/, "");
const baseURL = base.endsWith("/api/v1") ? base : `${base}/api/v1`;

const api = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  withCredentials: false,
});

// Request interceptor to attach token from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cei_token');
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for 401 handling and error logging
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      window.location.href = '/login';
    }
    console.error('API error:', error);
    return Promise.reject(error);
  }
);

// Typed helper functions
export async function getSites() {
  // Example usage: const sites = await getSites();
  const res = await api.get('/sites');
  return res.data;
}

export async function getSite(id: string) {
  // Example usage: const site = await getSite('site-123');
  const res = await api.get(`/sites/${id}`);
  return res.data;
}

export async function postTimeseriesBatch(payload: any) {
  // Example usage: await postTimeseriesBatch([{...}, {...}]);
  const res = await api.post('/data/timeseries', payload);
  return res.data;
}

export async function uploadCsv(formData: FormData) {
  // Example usage: await uploadCsv(formData);
  const res = await api.post('/upload-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export default api;
