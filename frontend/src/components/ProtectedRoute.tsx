// frontend/src/components/ProtectedRoute.tsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

type ProtectedRouteProps = {
  children: React.ReactElement;
  allowedOrgTypes?: string[];
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedOrgTypes }) => {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        state={{ from: location, reason: "auth_required" }}
        replace
      />
    );
  }

  if (allowedOrgTypes && allowedOrgTypes.length > 0) {
    const orgType =
      user?.org?.org_type ?? user?.organization?.org_type ?? "standalone";
    if (!allowedOrgTypes.includes(orgType)) {
      // Redirect to the most appropriate page for their org type
      if (orgType === "managing") return <Navigate to="/manage" replace />;
      if (orgType === "client") return <Navigate to="/" replace />;
      return <Navigate to="/" replace />;
    }
  }

  return children;
};

export default ProtectedRoute;