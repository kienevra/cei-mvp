// src/hooks/useAuth.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import api from '../services/api';

interface AuthContextType {
  accessToken: string | null;
  refreshToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getStoredTokens() {
  return {
    accessToken: localStorage.getItem('cei_token'),
    refreshToken: localStorage.getItem('cei_refresh_token'),
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [accessToken, setAccessToken] = useState<string | null>(getStoredTokens().accessToken);
  const [refreshToken, setRefreshToken] = useState<string | null>(getStoredTokens().refreshToken);
  const navigate = useNavigate();

  useEffect(() => {
    // Keep tokens in sync with localStorage
    setAccessToken(localStorage.getItem('cei_token'));
    setRefreshToken(localStorage.getItem('cei_refresh_token'));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { access_token, refresh_token } = res.data;
    localStorage.setItem('cei_token', access_token);
    localStorage.setItem('cei_refresh_token', refresh_token);
    setAccessToken(access_token);
    setRefreshToken(refresh_token);
    navigate('/');
  };

  const logout = () => {
    localStorage.removeItem('cei_token');
    localStorage.removeItem('cei_refresh_token');
    setAccessToken(null);
    setRefreshToken(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ accessToken, refreshToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { accessToken } = useAuth();
  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
