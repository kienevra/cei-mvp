// frontend/src/hooks/useAuth.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

type LoginPayload = {
  username: string;
  password: string;
};

export type AuthUser = {
  username?: string;
  email?: string;
  [key: string]: any;
};

export type AuthContextType = {
  token: string | null;
  isAuthenticated: boolean;
  user: AuthUser | null;
  login: (data: LoginPayload) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();

  // Token is the only thing we *must* persist
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem("cei_token");
    } catch {
      return null;
    }
  });

  // Optional user object (TopNav is reading this)
  const [user, setUser] = useState<AuthUser | null>(null);

  const isAuthenticated = !!token;

  // Keep localStorage in sync with token
  useEffect(() => {
    try {
      if (token) {
        localStorage.setItem("cei_token", token);
      } else {
        localStorage.removeItem("cei_token");
      }
    } catch {
      // fail silently if storage is unavailable
    }
  }, [token]);

  const login = async ({ username, password }: LoginPayload) => {
    // Backend expects application/x-www-form-urlencoded (OAuth2PasswordRequestForm)
    const form = new URLSearchParams();
    form.append("username", username);
    form.append("password", password);
    // grant_type is optional but harmless; some libs expect "password"
    form.append("grant_type", "password");

    const resp = await api.post("/auth/login", form, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = resp.data as any;

    const accessToken: string | undefined = data?.access_token;
    if (!accessToken) {
      throw new Error("Login response missing access_token");
    }

    // Store token in state (and indirectly in localStorage via effect)
    setToken(accessToken);

    // If backend returns user payload, use it; otherwise synthesize minimal user
    if (data.user && typeof data.user === "object") {
      setUser(data.user as AuthUser);
    } else {
      setUser({ username });
    }

    navigate("/", { replace: true });
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem("cei_token");
    } catch {
      // ignore
    }
    navigate("/login", { replace: true });
  };

  const value: AuthContextType = {
    token,
    isAuthenticated,
    user,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

export default useAuth;
