import axios from 'axios';
import { ApiResponse } from '../types/api';

const api = axios.create({
  baseURL: 'http://localhost:8000',
  timeout: 10000, // 10 second timeout
});

// JWT token handling
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('jwt');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response handling
api.interceptors.response.use(
  (response) => {
    return {
      ...response,
      data: {
        data: response.data,
        error: undefined
      } as ApiResponse<typeof response.data>
    };
  },
  (error) => {
    const errorMessage = 
      error.response?.data?.message || 
      error.message || 
      'An unexpected error occurred';
    
    console.error('API Error:', errorMessage);
    
    return Promise.reject({
      ...error,
      data: {
        data: null,
        error: errorMessage
      } as ApiResponse<null>
    });
  }
);


export default api;
