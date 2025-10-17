import React, { useState, useEffect, useCallback, useContext, createContext, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

// Vite provides type definitions for import.meta.env automatically.
// Remove custom ImportMeta and ImportMetaEnv interfaces to avoid conflicts.

const TOKEN_KEY = "cei_token";
const AuthContext = createContext<any>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const navigate = useNavigate();

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  const login = useCallback(async ({ username, password }: { username: string; password: string }) => {
    // TODO: adapt if backend uses different field names
    const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error("Invalid credentials");
    const data = await res.json();
    setToken(data.access_token);
    navigate("/");
  }, [navigate]);

  const logout = useCallback(() => {
    setToken(null);
    navigate("/login");
  }, [navigate]);

  const isAuthenticated = !!token;

  return (
    <AuthContext.Provider value={{ token, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}