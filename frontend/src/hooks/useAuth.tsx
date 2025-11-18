import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
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
  const [token, setToken] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("cei_token") : null
  );
  const navigate = useNavigate();

  // Keep token in sync with localStorage on initial load
  useEffect(() => {
    const existing = localStorage.getItem("cei_token");
    if (existing && !token) {
      setToken(existing);
    }
  }, [token]);

  const login = async ({ username, password }: LoginRequest) => {
    const body = new URLSearchParams();
    body.append("username", username);
    body.append("password", password);

    const res = await api.post("/auth/login", body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const accessToken = res.data?.access_token;
    if (!accessToken) {
      throw new Error("Invalid login response");
    }

    localStorage.setItem("cei_token", accessToken);
    setToken(accessToken);

    // ✅ Always go to dashboard root after login
    navigate("/", { replace: true });
  };

  const logout = () => {
    localStorage.removeItem("cei_token");
    setToken(null);
    navigate("/login", { replace: true });
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token,
        token,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
