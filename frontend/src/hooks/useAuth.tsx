// frontend/src/hooks/useAuth.tsx
import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import axios, { AxiosError } from "axios";

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

  // On mount, sync with localStorage once.
  useEffect(() => {
    setTokenState(localStorage.getItem("cei_token"));
  }, []);

  const login = async (data: LoginRequest) => {
    // Send as x-www-form-urlencoded because backend uses OAuth2PasswordRequestForm
    const body = new URLSearchParams();
    body.set("username", data.username);
    body.set("password", data.password);

    try {
      const res = await api.post("/auth/login", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const acc = res.data?.access_token as string | undefined;
      if (!acc) {
        throw new Error("Invalid login response from server.");
      }

      localStorage.setItem("cei_token", acc);
      setTokenState(acc);
      navigate("/");
    } catch (err: any) {
      let message = "Login failed. Please try again.";

      if (axios.isAxiosError(err)) {
        const resp = err.response;

        if (resp) {
          if (resp.status === 401) {
            message = "Incorrect email or password.";
          } else if (resp.status === 429) {
            message = "Too many attempts. Please wait a bit before trying again.";
          } else if (typeof resp.data === "object" && resp.data && (resp.data as any).detail) {
            message = String((resp.data as any).detail);
          }
        } else if (err.message) {
          message = err.message;
        }
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }

      throw new Error(message);
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
