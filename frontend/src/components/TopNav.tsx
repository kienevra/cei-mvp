// frontend/src/components/TopNav.tsx
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

// Read environment flag from Vite
const rawEnv = (import.meta as any).env || {};
const rawEnvName =
  rawEnv.VITE_ENVIRONMENT ||
  rawEnv.MODE || // fallback to Vite mode if set
  "dev";

const envName = String(rawEnvName).toLowerCase();

let envLabel = "DEV";
let envClass = "cei-pill cei-pill-neutral";
let envTitle =
  "Local development environment. Safe for experiments and test data.";

if (envName.startsWith("prod")) {
  envLabel = "PROD";
  envClass = "cei-pill cei-pill-negative";
  envTitle =
    "Production environment. Live tenant data – be careful with changes.";
} else if (envName.startsWith("pilot") || envName.startsWith("stage")) {
  envLabel = envName.startsWith("pilot") ? "PILOT" : "STAGING";
  envClass = "cei-pill cei-pill-warning";
  envTitle =
    "Pilot / staging environment. Used for customer testing before full rollout.";
}

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

  const toggleMenu = () => {
    setMenuOpen((prev) => !prev);
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <header className="cei-topnav">
      <div className="cei-topnav-inner">
        <div
          className="cei-topnav-brand"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
          }}
        >
          <img
            src="/cei-logo-icon.png"
            alt="CEI logo"
            style={{
              height: "40px",
              width: "auto",
              display: "block",
            }}
          />
          <div>
            <span className="cei-topnav-brand-main">CEI</span>
            <span className="cei-topnav-brand-sub">
              Carbon Efficiency Intelligence
            </span>
          </div>
        </div>

        {/* Desktop user info (hidden on mobile) */}
        <div className="cei-topnav-right hide-on-mobile">
          {/* Environment badge */}
          <span
            className={envClass}
            title={envTitle}
            style={{
              marginRight: "0.75rem",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "0.15rem 0.5rem",
            }}
          >
            {envLabel}
          </span>

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
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            className="cei-btn cei-btn-ghost"
            onClick={toggleMenu}
          >
            ⋮
          </button>
        </div>
      </div>

      {/* Mobile overlay + dropdown menu */}
      {menuOpen && (
        <div
          className="cei-mobile-menu-overlay"
          onClick={closeMenu}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            className="cei-mobile-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "3.25rem",
              right: "0.75rem",
              left: "0.75rem",
              borderRadius: "0.9rem",
              background: "rgba(15, 23, 42, 0.98)",
              border: "1px solid rgba(31, 41, 55, 0.85)",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.9)",
            }}
          >
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
                        style={{
                          fontSize: "0.7rem",
                          opacity: 0.7,
                          marginLeft: 8,
                        }}
                      >
                        ●
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="cei-mobile-menu-footer">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.2rem",
                }}
              >
                {/* Environment badge on mobile */}
                <span
                  className={envClass}
                  title={envTitle}
                  style={{
                    alignSelf: "flex-start",
                    fontSize: "0.7rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: "0.15rem 0.45rem",
                  }}
                >
                  {envLabel}
                </span>

                <span>{user?.email ? user.email : "Signed in"}</span>
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
        </div>
      )}
    </header>
  );
};

export default TopNav;
