import React, { createContext, useContext, useState, useEffect } from "react";
import api from "../services/api";

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
    const res = await api.post<{ access_token: string }>("/auth/login", { username, password });
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}