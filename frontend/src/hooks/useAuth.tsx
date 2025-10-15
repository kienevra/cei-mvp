import React, { createContext, useContext, useState, useEffect } from "react";
import api from "../services/api";
import { AuthResponse } from "../types/auth";

interface AuthContextType {
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("access_token"));

  useEffect(() => {
    if (token) localStorage.setItem("access_token", token);
    else localStorage.removeItem("access_token");
  }, [token]);

  const login = async (username: string, password: string) => {
    const res = await api.post<AuthResponse>("/auth/login", { username, password });
    setToken(res.data.access_token);
  };

  const logout = () => {
    setToken(null);
  };

  const value: AuthContextType = {
    token,
    login,
    logout,
    isAuthenticated: !!token,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

// useRequireAuth should be a hook, not a function that redirects immediately.
// Instead, use it inside a component to conditionally redirect.
import { useEffect } from "react";
export function useRequireAuth() {
  const { isAuthenticated } = useAuth();
  const navigateToLogin = () => {
    window.location.href = "/login";
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigateToLogin();
    }
  }, [isAuthenticated]);
}