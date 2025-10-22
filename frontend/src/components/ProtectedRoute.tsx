import React, { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

interface ProtectedRouteProps {
  children: JSX.Element;
  showToast?: (msg: string) => void;
  message?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  showToast,
  message,
}) => {
  const { accessToken } = useAuth();

  useEffect(() => {
    if (!accessToken && showToast && message) {
      showToast(message);
    }
  }, [accessToken, showToast, message]);

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default ProtectedRoute;