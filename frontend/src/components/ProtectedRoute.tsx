import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

type ProtectedRouteProps = {
  children: React.ReactNode;
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Build a query string with a standard "session_expired" reason.
    const params = new URLSearchParams();
    params.set("reason", "session_expired");

    // Optional: remember where the user was trying to go
    if (location.pathname && location.pathname !== "/login") {
      params.set("from", location.pathname);
    }

    const to = `/login?${params.toString()}`;

    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
