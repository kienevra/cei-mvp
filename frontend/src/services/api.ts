import axios from 'axios';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { getToken, setToken, getRefreshToken, setRefreshToken, removeToken, removeRefreshToken } from '../utils/storage';

const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: false,
});

// Request interceptor to attach token
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for token refresh skeleton
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          // Implement your refresh endpoint if available
          const res = await axios.post(getApiBaseUrl() + '/auth/refresh', { refresh_token: refreshToken });
          setToken(res.data.access_token);
          if (res.data.refresh_token) setRefreshToken(res.data.refresh_token);
          originalRequest.headers['Authorization'] = `Bearer ${res.data.access_token}`;
          return api(originalRequest);
        } catch (refreshErr) {
          removeToken();
          removeRefreshToken();
          window.location.href = '/login';
        }
      } else {
        removeToken();
        removeRefreshToken();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
