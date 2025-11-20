// frontend/src/components/Sidebar.tsx
import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FiHome,
  FiList,
  FiAlertTriangle,
  FiFileText,
  FiUser,
  FiSettings,
} from "react-icons/fi";

/**
 * Sidebar navigation for CEI app.
 * Uses button-like pills for each nav item.
 */
const navItems = [
  { label: "Dashboard", path: "/", icon: <FiHome /> },
  { label: "Sites", path: "/sites", icon: <FiList /> },
  { label: "Alerts", path: "/alerts", icon: <FiAlertTriangle /> },
  { label: "Reports", path: "/reports", icon: <FiFileText /> },
  { label: "Account", path: "/account", icon: <FiUser /> },
  { label: "Settings", path: "/settings", icon: <FiSettings /> },
];

const Sidebar: React.FC = () => {
  const { pathname } = useLocation();

  return (
    <aside
      style={{
        width: "220px",
        background: "rgba(15, 23, 42, 0.98)",
        borderRight: "1px solid var(--cei-border-subtle)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0.9rem 0.8rem 1.2rem",
      }}
    >
      {/* Lightweight label to anchor the column */}
      <div
        style={{
          padding: "0.2rem 0.6rem 0.1rem",
          fontSize: "0.8rem",
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: "var(--cei-text-muted)",
          opacity: 0.8,
        }}
      >
        Navigation
      </div>

      <nav
        style={{
          marginTop: "0.6rem", // pushes Dashboard down a bit from top edge
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
          flex: 1,
        }}
      >
        {navItems.map((item) => {
          const active =
            pathname === item.path ||
            (item.path !== "/" && pathname.startsWith(item.path));

          return (
            <Link
              key={item.path}
              to={item.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.55rem",
                padding: "0.45rem 0.85rem",
                borderRadius: "999px",
                fontSize: "0.87rem",
                textDecoration: "none",
                color: active ? "#e5e7eb" : "var(--cei-text-muted)",
                background: active
                  ? "rgba(15, 23, 42, 0.98)"
                  : "transparent",
                border: active
                  ? "1px solid rgba(148, 163, 184, 0.55)"
                  : "1px solid transparent",
                transition: "background 0.12s ease-out, border-color 0.12s ease-out, color 0.12s ease-out, transform 0.08s ease-out",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background =
                  active
                    ? "rgba(15, 23, 42, 1)"
                    : "rgba(15, 23, 42, 0.75)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background =
                  active ? "rgba(15, 23, 42, 0.98)" : "transparent";
              }}
            >
              <span
                style={{
                  fontSize: "1rem",
                  display: "flex",
                  alignItems: "center",
                  opacity: active ? 1 : 0.85,
                }}
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};

export default Sidebar;
