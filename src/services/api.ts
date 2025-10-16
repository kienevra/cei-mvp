import axios from "axios";
import { getRuntimeApiBase } from "../utils/runtimeConfig";

const api = axios.create({
  baseURL: getRuntimeApiBase(),
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    if (!config.headers) {
      config.headers = {};
    }
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Skeleton for token refresh logic
    if (error.response?.status === 401) {
      // TODO: Implement refresh token logic if needed
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;