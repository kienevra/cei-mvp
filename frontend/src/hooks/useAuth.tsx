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
import axios from "axios";

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

/* ===== Request-id helpers (keeps login errors consistent with api.ts support codes) ===== */

function getRequestIdFromAxiosError(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;

  const headers: any = err.response?.headers || {};
  const fromHeader =
    (typeof headers["x-request-id"] === "string" && headers["x-request-id"]) ||
    (typeof headers["X-Request-ID"] === "string" && headers["X-Request-ID"]) ||
    (typeof headers["x-requestid"] === "string" && headers["x-requestid"]) ||
    null;

  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();

  const data: any = err.response?.data;
  const fromBody =
    typeof data?.request_id === "string"
      ? data.request_id
      : typeof data?.requestId === "string"
      ? data.requestId
      : null;

  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();

  return null;
}

function appendSupportCode(msg: string, rid: string | null): string {
  if (!rid) return msg;
  if (msg && msg.toLowerCase().includes("support code:")) return msg;
  return `${msg} (Support code: ${rid})`;
}

function safeStringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function getAuthErrorMessage(err: unknown, fallback: string): string {
  const rid = getRequestIdFromAxiosError(err);

  if (axios.isAxiosError(err)) {
    const data: any = err.response?.data;

    if (data?.detail != null) {
      const detail =
        typeof data.detail === "string" ? data.detail : safeStringify(data.detail);
      return appendSupportCode(detail || fallback, rid);
    }

    if (data?.message != null) {
      const msg =
        typeof data.message === "string" ? data.message : safeStringify(data.message);
      return appendSupportCode(msg || fallback, rid);
    }

    const axMsg = typeof err.message === "string" ? err.message : "";
    return appendSupportCode(axMsg || fallback, rid);
  }

  if (err instanceof Error) return appendSupportCode(err.message || fallback, rid);
  return appendSupportCode(fallback, rid);
}

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

    try {
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
    } catch (err: any) {
      // Ensure Login.tsx gets a clean message that includes Support code when available
      throw new Error(getAuthErrorMessage(err, "Authentication failed. Please try again."));
    }
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
