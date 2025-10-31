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
  const { token } = useAuth();

  useEffect(() => {
    if (!token && showToast && message) {
      showToast(message);
    }
  }, [token, showToast, message]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default ProtectedRoute;