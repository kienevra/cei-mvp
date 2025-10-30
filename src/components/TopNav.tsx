import React from "react";
import { useAuth } from "../hooks/useAuth";

/**
 * Top navigation bar for CEI app.
 */
const TopNav: React.FC = () => {
  const { logout } = useAuth();
  return (
    <header className="bg-white shadow flex items-center justify-between px-6 py-3">
      <div className="font-bold text-lg">Carbon Efficiency Intelligence</div>
      <button className="text-sm text-blue-600" onClick={logout}>
        Logout
      </button>
    </header>
  );
};

export default TopNav;