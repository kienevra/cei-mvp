// frontend/src/components/TopNav.tsx
import React, { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "react-i18next";
import NotificationBell from "./NotificationBell";

const TopNav: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { t, i18n } = useTranslation();

  const isManagingOrg =
    user?.org?.org_type === "managing" ||
    user?.organization?.org_type === "managing";

  const isClientOrg =
    user?.org?.org_type === "client" ||
    user?.organization?.org_type === "client";

  const managingOrgSubtype =
    user?.org?.managing_org_subtype ?? user?.organization?.managing_org_subtype ?? null;

  const isClientOfCommercialista = isClientOrg && managingOrgSubtype === "commercialista";

  const navItems = useMemo(() => {
    if (isManagingOrg) {
      return [
        { label: t("nav.manage", { defaultValue: "Manage" }), path: "/manage" },
        { label: t("nav.account", { defaultValue: "Account" }), path: "/account" },
        { label: t("nav.billing", { defaultValue: "Billing" }), path: "/billing" },
        { label: t("nav.settings", { defaultValue: "Settings" }), path: "/settings" },
        { label: t("nav.support", { defaultValue: "Support" }), path: "/support" },
      ];
    }

    if (isClientOfCommercialista) {
      return [
        { label: t("nav.dashboard", { defaultValue: "Dashboard" }), path: "/" },
        { label: t("nav.sites", { defaultValue: "Sites" }), path: "/sites" },
        { label: t("nav.alerts", { defaultValue: "Alerts" }), path: "/alerts" },
        { label: t("nav.uploadCsv", { defaultValue: "Upload CSV" }), path: "/upload" },
        { label: t("nav.reports", { defaultValue: "Reports" }), path: "/reports" },
        { label: t("nav.billing", { defaultValue: "Billing" }), path: "/billing" },
        { label: t("nav.settings", { defaultValue: "Settings" }), path: "/settings" },
        { label: t("nav.account", { defaultValue: "Account" }), path: "/account" },
        { label: t("nav.support", { defaultValue: "Support" }), path: "/support" },
      ];
    }
    if (isClientOrg) {
      return [
        { label: t("nav.dashboard", { defaultValue: "Dashboard" }), path: "/" },
        { label: t("nav.account", { defaultValue: "Account" }), path: "/account" },
        { label: t("nav.billing", { defaultValue: "Billing" }), path: "/billing" },
        { label: t("nav.settings", { defaultValue: "Settings" }), path: "/settings" },
        { label: t("nav.support", { defaultValue: "Support" }), path: "/support" },
      ];
    }

    // Standard org — full menu
    return [
      { label: t("nav.dashboard", { defaultValue: "Dashboard" }), path: "/" },
      { label: t("nav.sites", { defaultValue: "Sites" }), path: "/sites" },
      { label: t("nav.alerts", { defaultValue: "Alerts" }), path: "/alerts" },
      { label: t("nav.uploadCsv", { defaultValue: "Upload CSV" }), path: "/upload" },
      { label: t("nav.reports", { defaultValue: "Reports" }), path: "/reports" },
      { label: t("nav.billing", { defaultValue: "Billing" }), path: "/billing" },
      { label: t("nav.settings", { defaultValue: "Settings" }), path: "/settings" },
      { label: t("nav.account", { defaultValue: "Account" }), path: "/account" },
      { label: t("nav.support", { defaultValue: "Support" }), path: "/support" },
    ];
  }, [t, isManagingOrg, isClientOrg, isClientOfCommercialista]);

  const currentLang = (i18n.language || "en").toLowerCase().startsWith("it")
    ? "it"
    : "en";

  const setLang = async (lang: "en" | "it") => {
    try {
      await i18n.changeLanguage(lang);
    } catch {
      // non-fatal; keep UX stable even if i18n isn't fully wired yet
    }
  };

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
        <Link
          to="/"
          className="cei-topnav-brand"
          title={t("topnav.goToDashboard", { defaultValue: "Go to Dashboard" })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            textDecoration: "none",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <img
            src="/cei-logo-icon.png"
            alt={t("topnav.logoAlt", { defaultValue: "CEI logo" })}
            style={{
              height: "40px",
              width: "auto",
              display: "block",
            }}
          />
          <div>
            <span className="cei-topnav-brand-main">CEI</span>
            <span className="cei-topnav-brand-sub">
              {t("topnav.brandSubtitle", {
                defaultValue: "Carbon Efficiency Intelligence",
              })}
            </span>
          </div>
        </Link>

        {/* Desktop user info (hidden on mobile) */}
        <div className="cei-topnav-right hide-on-mobile">
          {/* Language switcher (desktop) */}
          {user && <NotificationBell />}
          <div
            style={{
              display: "inline-flex",
              background: "rgba(15,23,42,0.8)",
              borderRadius: "999px",
              padding: "0.12rem",
              border: "1px solid rgba(148,163,184,0.2)",
              gap: "0.1rem",
              marginRight: "0.75rem",
            }}
            aria-label={t("i18n.language", { defaultValue: "Language" })}
          >
            <button
              type="button"
              onClick={() => setLang("it")}
              aria-pressed={currentLang === "it"}
              style={{
                padding: "0.3rem 0.75rem",
                borderRadius: "999px",
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.04em",
                cursor: "pointer",
                border: "none",
                background: currentLang === "it" ? "rgba(34,197,94,0.15)" : "transparent",
                color: currentLang === "it" ? "#22c55e" : "#94a3b8",
                transition: "all 0.2s",
              }}
            >
              IT
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={currentLang === "en"}
              style={{
                padding: "0.3rem 0.75rem",
                borderRadius: "999px",
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.04em",
                cursor: "pointer",
                border: "none",
                background: currentLang === "en" ? "rgba(34,197,94,0.15)" : "transparent",
                color: currentLang === "en" ? "#22c55e" : "#94a3b8",
                transition: "all 0.2s",
              }}
            >
              EN
            </button>
          </div>

          {user?.email && (
            <span style={{ marginRight: "0.5rem" }}>{user.email}</span>
          )}
          <button type="button" className="cei-btn cei-btn-ghost" onClick={logout}>
            {t("auth.logout", { defaultValue: "Logout" })}
          </button>
        </div>

        {/* Mobile menu toggle — bell + 3-dot button */}
        <div className="cei-mobile-menu-toggle" style={{ alignItems: "center", gap: "0.5rem" }}>
          {user && <NotificationBell />}
          <button
            type="button"
            aria-label={
              menuOpen
                ? t("topnav.closeMenu", { defaultValue: "Close navigation menu" })
                : t("topnav.openMenu", { defaultValue: "Open navigation menu" })
            }
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
              width: "280px",
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
                      <span style={{ fontSize: "0.7rem", opacity: 0.7, marginLeft: 8 }}>
                        ◀
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="cei-mobile-menu-footer">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {/* Language switcher (mobile) */}
                <div
                  style={{
                    display: "inline-flex",
                    background: "rgba(15,23,42,0.8)",
                    borderRadius: "999px",
                    padding: "0.12rem",
                    border: "1px solid rgba(148,163,184,0.2)",
                    gap: "0.1rem",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setLang("it")}
                    aria-pressed={currentLang === "it"}
                    style={{
                      padding: "0.3rem 0.75rem",
                      borderRadius: "999px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                      border: "none",
                      background: currentLang === "it" ? "rgba(34,197,94,0.15)" : "transparent",
                      color: currentLang === "it" ? "#22c55e" : "#94a3b8",
                      transition: "all 0.2s",
                    }}
                  >
                    IT
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang("en")}
                    aria-pressed={currentLang === "en"}
                    style={{
                      padding: "0.3rem 0.75rem",
                      borderRadius: "999px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                      border: "none",
                      background: currentLang === "en" ? "rgba(34,197,94,0.15)" : "transparent",
                      color: currentLang === "en" ? "#22c55e" : "#94a3b8",
                      transition: "all 0.2s",
                    }}
                  >
                    EN
                  </button>
                </div>

                <span>
                  {user?.email
                    ? user.email
                    : t("auth.signedIn", { defaultValue: "Signed in" })}
                </span>
              </div>

              <button
                type="button"
                className="cei-btn cei-btn-danger"
                style={{ padding: "0.3rem 0.7rem", fontSize: "0.78rem" }}
                onClick={handleLogoutClick}
              >
                {t("auth.logout", { defaultValue: "Logout" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default TopNav;
