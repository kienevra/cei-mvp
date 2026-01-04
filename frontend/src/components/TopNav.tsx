// frontend/src/components/TopNav.tsx
import React, { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "react-i18next";

const TopNav: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { t, i18n } = useTranslation();

  const navItems = useMemo(
    () => [
      { label: t("nav.dashboard", { defaultValue: "Dashboard" }), path: "/" },
      { label: t("nav.sites", { defaultValue: "Sites" }), path: "/sites" },
      { label: t("nav.alerts", { defaultValue: "Alerts" }), path: "/alerts" },
      {
        label: t("nav.uploadCsv", { defaultValue: "Upload CSV" }),
        path: "/upload",
      },
      { label: t("nav.reports", { defaultValue: "Reports" }), path: "/reports" },
      {
        label: t("nav.settings", { defaultValue: "Settings" }),
        path: "/settings",
      },
      { label: t("nav.account", { defaultValue: "Account" }), path: "/account" },
    ],
    [t]
  );

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
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              marginRight: "0.75rem",
            }}
            aria-label={t("i18n.language", { defaultValue: "Language" })}
            title={t("i18n.language", { defaultValue: "Language" })}
          >
            <button
              type="button"
              className="cei-btn cei-btn-ghost"
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.78rem",
                opacity: currentLang === "en" ? 1 : 0.75,
              }}
              onClick={() => setLang("en")}
              aria-pressed={currentLang === "en"}
            >
              EN
            </button>
            <button
              type="button"
              className="cei-btn cei-btn-ghost"
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.78rem",
                opacity: currentLang === "it" ? 1 : 0.75,
              }}
              onClick={() => setLang("it")}
              aria-pressed={currentLang === "it"}
            >
              IT
            </button>
          </div>

          {user?.email && (
            <span style={{ marginRight: "0.5rem" }}>{user.email}</span>
          )}
          <button type="button" className="cei-btn cei-btn-ghost" onClick={logout}>
            {t("auth.logout", { defaultValue: "Logout" })}
          </button>
        </div>

        {/* Mobile menu toggle – 3-dot button */}
        <div className="cei-mobile-menu-toggle">
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
                      <span style={{ fontSize: "0.7rem", opacity: 0.7, marginLeft: 8 }}>
                        ●
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
                    display: "flex",
                    gap: "0.4rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>
                    {t("i18n.language", { defaultValue: "Language" })}:
                  </span>
                  <button
                    type="button"
                    className="cei-btn cei-btn-ghost"
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.78rem",
                      opacity: currentLang === "en" ? 1 : 0.75,
                    }}
                    onClick={() => setLang("en")}
                    aria-pressed={currentLang === "en"}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    className="cei-btn cei-btn-ghost"
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.78rem",
                      opacity: currentLang === "it" ? 1 : 0.75,
                    }}
                    onClick={() => setLang("it")}
                    aria-pressed={currentLang === "it"}
                  >
                    IT
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
