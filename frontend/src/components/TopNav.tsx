// frontend/src/components/TopNav.tsx
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const TopNav: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { label: "Dashboard", path: "/" },
    { label: "Sites", path: "/sites" },
    { label: "Alerts", path: "/alerts" },
    { label: "Upload CSV", path: "/upload" },
    { label: "Reports", path: "/reports" },
    { label: "Settings", path: "/settings" },
    { label: "Account", path: "/account" },
  ];

  const handleNavClick = (path: string) => {
    navigate(path);
    setMenuOpen(false);
  };

  const handleLogoutClick = () => {
    setMenuOpen(false);
    logout();
  };

  return (
    <header className="cei-topnav">
      <div className="cei-topnav-inner">
        <div className="cei-topnav-brand">
          <span className="cei-topnav-brand-main">CEI</span>
          <span className="cei-topnav-brand-sub">
            Carbon Efficiency Intelligence
          </span>
        </div>

        {/* Desktop user info (hidden on mobile) */}
        <div className="cei-topnav-right hide-on-mobile">
          {user?.email && (
            <span style={{ marginRight: "0.5rem" }}>{user.email}</span>
          )}
          <button
            type="button"
            className="cei-btn cei-btn-ghost"
            onClick={logout}
          >
            Logout
          </button>
        </div>

        {/* Mobile menu toggle – 3-dot button */}
        <div className="cei-mobile-menu-toggle">
          <button
            type="button"
            aria-label="Open navigation menu"
            className="cei-btn cei-btn-ghost"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            ⋮
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="cei-mobile-menu">
          <div className="cei-mobile-menu-list">
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  className="cei-mobile-menu-link"
                  onClick={() => handleNavClick(item.path)}
                >
                  <span>{item.label}</span>
                  {active && (
                    <span
                      style={{ fontSize: "0.7rem", opacity: 0.7, marginLeft: 8 }}
                    >
                      ●
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="cei-mobile-menu-footer">
            <div>
              {user?.email ? (
                <span>{user.email}</span>
              ) : (
                <span>Signed in</span>
              )}
            </div>
            <button
              type="button"
              className="cei-btn cei-btn-danger"
              style={{ padding: "0.3rem 0.7rem", fontSize: "0.78rem" }}
              onClick={handleLogoutClick}
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default TopNav;
