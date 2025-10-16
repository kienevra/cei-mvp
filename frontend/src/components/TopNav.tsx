import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function TopNav() {
  const { isAuthenticated, logout } = useAuth();
  return (
    <nav className="top-nav">
      <Link to="/">Dashboard</Link>
      <Link to="/sites">Sites</Link>
      <Link to="/account">Account</Link>
      <Link to="/settings">Settings</Link>
      {isAuthenticated ? (
        <button onClick={logout}>Logout</button>
      ) : (
        <Link to="/login">Login</Link>
      )}
    </nav>
  );
}