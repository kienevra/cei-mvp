import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

type LoginRequest = {
  username: string;
  password: string;
};

type AuthContextType = {
  isAuthenticated: boolean;
  token: string | null;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setTokenState] = useState<string | null>(localStorage.getItem("cei_token"));
  const navigate = useNavigate();

  useEffect(() => {
    setTokenState(localStorage.getItem("cei_token"));
  }, []);

  const login = async (data: LoginRequest) => {
    const res = await api.post("/auth/login", data);
    const acc = res.data?.access_token;
    if (acc) {
      localStorage.setItem("cei_token", acc);
      setTokenState(acc);
      navigate("/");
    } else {
      throw new Error("Invalid login response");
    }
  };

  const logout = () => {
    localStorage.removeItem("cei_token");
    setTokenState(null);
    navigate("/login");
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!token, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
