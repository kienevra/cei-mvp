// frontend/src/components/Sidebar.tsx
import React, { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FiHome,
  FiList,
  FiAlertTriangle,
  FiFileText,
  FiUser,
  FiSettings,
  FiUpload,
} from "react-icons/fi";

/**
 * Sidebar navigation for CEI app.
 * Uses button-like pills for each nav item.
 */
const Sidebar: React.FC = () => {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  const navItems = useMemo(
    () => [
      { label: t("nav.dashboard", { defaultValue: "Dashboard" }), path: "/", icon: <FiHome /> },
      { label: t("nav.sites", { defaultValue: "Sites" }), path: "/sites", icon: <FiList /> },
      { label: t("nav.alerts", { defaultValue: "Alerts" }), path: "/alerts", icon: <FiAlertTriangle /> },
      { label: t("nav.uploadCsv", { defaultValue: "Upload CSV" }), path: "/upload", icon: <FiUpload /> },
      { label: t("nav.reports", { defaultValue: "Reports" }), path: "/reports", icon: <FiFileText /> },
      { label: t("nav.account", { defaultValue: "Account" }), path: "/account", icon: <FiUser /> },
      { label: t("nav.settings", { defaultValue: "Settings" }), path: "/settings", icon: <FiSettings /> },
    ],
    [t]
  );

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
        {t("nav.navigation", { defaultValue: "Navigation" })}
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
          const active = pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));

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
                background: active ? "rgba(15, 23, 42, 0.98)" : "transparent",
                border: active ? "1px solid rgba(148, 163, 184, 0.55)" : "1px solid transparent",
                transition:
                  "background 0.12s ease-out, border-color 0.12s ease-out, color 0.12s ease-out, transform 0.08s ease-out",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background = active
                  ? "rgba(15, 23, 42, 1)"
                  : "rgba(15, 23, 42, 0.75)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background = active
                  ? "rgba(15, 23, 42, 0.98)"
                  : "transparent";
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
