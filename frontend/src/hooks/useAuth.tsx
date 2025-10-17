// src/hooks/useAuth.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { getToken, setToken, removeToken, getRefreshToken, setRefreshToken, removeRefreshToken } from '../utils/storage';
import { AuthResponse, LoginRequest } from '../types/auth';

interface AuthContextType {
  isAuthenticated: boolean;
  token: string | null;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setTokenState] = useState<string | null>(getToken());
  const navigate = useNavigate();

  useEffect(() => {
    setTokenState(getToken());
  }, []);

  const login = async (data: LoginRequest) => {
    const res = await api.post<AuthResponse>('/auth/login', data);
    setToken(res.data.access_token);
    setTokenState(res.data.access_token);
    if (res.data.refresh_token) setRefreshToken(res.data.refresh_token);
    navigate('/');
  };

  const logout = () => {
    removeToken();
    removeRefreshToken();
    setTokenState(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!token, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequireAuth() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAuthenticated) navigate('/login');
  }, [isAuthenticated, navigate]);
}
