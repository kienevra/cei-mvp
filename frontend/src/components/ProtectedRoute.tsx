// frontend/src/components/ProtectedRoute.tsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
type ProtectedRouteProps = {
  children: React.ReactElement;
  allowedOrgTypes?: string[];
  allowCommercialista?: boolean;
};
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedOrgTypes, allowCommercialista }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // Wait for /auth/me before making any routing decisions
  if (isLoading) return null;

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        state={{ from: location, reason: "auth_required" }}
        replace
      />
    );
  }

  const orgType =
    user?.org?.org_type ?? user?.organization?.org_type ?? "standalone";
  const accountSubtype =
    user?.org?.account_subtype ?? user?.organization?.account_subtype ?? null;
  const isCommercialista = orgType === "managing" && accountSubtype === "commercialista";
  const isEsco = orgType === "managing" && accountSubtype !== "commercialista";

  // Block ESCO from /commercialista, redirect to /manage
  if (isEsco && location.pathname.startsWith("/commercialista")) {
    return <Navigate to="/manage" replace />;
  }

  const managingOrgSubtype =
    user?.org?.managing_org_subtype ?? user?.organization?.managing_org_subtype ?? null;
  const isClientOfCommercialista = orgType === "client" && managingOrgSubtype === "commercialista";

  if (allowedOrgTypes && allowedOrgTypes.length > 0) {
    if (!allowedOrgTypes.includes(orgType)) {
      if (allowCommercialista && isClientOfCommercialista) {
        // client org linked to a commercialista — allow through
      } else if (orgType === "managing") {
        return <Navigate to={isCommercialista ? "/commercialista" : "/manage"} replace />;
      } else if (orgType === "client") {
        return <Navigate to="/" replace />;
      } else {
        return <Navigate to="/" replace />;
      }
    }
  }

  return children;
};
export default ProtectedRoute;
