import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
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
  const [token, setTokenState] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("cei_token") : null
  );
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window !== "undefined") {
      setTokenState(localStorage.getItem("cei_token"));
    }
  }, []);

  const login = async (data: LoginRequest) => {
    // Backend expects OAuth2PasswordRequestForm:
    // Content-Type: application/x-www-form-urlencoded
    // Fields: username, password
    const form = new URLSearchParams();
    form.append("username", data.username);
    form.append("password", data.password);

    const res = await api.post("/auth/login", form, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const acc = res.data?.access_token;
    if (!acc) {
      throw new Error("Invalid login response: no access_token");
    }

    localStorage.setItem("cei_token", acc);
    setTokenState(acc);

    // Land on dashboard after login
    navigate("/dashboard");
  };

  const logout = () => {
    localStorage.removeItem("cei_token");
    setTokenState(null);
    navigate("/login");
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
