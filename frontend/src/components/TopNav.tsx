// frontend/src/components/TopNav.tsx
import React from "react";
import { useAuth } from "../hooks/useAuth";

const TopNav: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  return (
    <header className="cei-topnav">
      <div className="cei-topnav-inner">
        {/* Brand */}
        <div className="cei-topnav-brand">
          <span className="cei-topnav-brand-main">CEI</span>
          <span className="cei-topnav-brand-sub">
            Carbon Efficiency Intelligence
          </span>
        </div>

        {/* Right side – just logout for now */}
        <div className="cei-topnav-right">
          {isAuthenticated && (
            <button
              type="button"
              className="cei-btn cei-btn-ghost"
              style={{
                padding: "0.3rem 0.9rem",
                fontSize: "0.8rem",
                borderRadius: "999px",
              }}
              onClick={handleLogout}
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopNav;
