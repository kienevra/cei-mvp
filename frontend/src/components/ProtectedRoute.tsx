// frontend/src/components/ProtectedRoute.tsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

type ProtectedRouteProps = {
  children: React.ReactElement;
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  // Not authenticated: send to a clean login URL.
  // We do NOT append ?reason=session_expired here.
  // Session-expired redirects are handled centrally in the axios interceptor.
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        state={{
          from: location,
          // additive: gives Login a stable, translatable reason without query params
          reason: "auth_required",
        }}
        replace
      />
    );
  }

  return children;
};

export default ProtectedRoute;
