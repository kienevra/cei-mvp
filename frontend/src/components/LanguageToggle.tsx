import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  variant?: "compact" | "pill";
  className?: string;
};

const LanguageToggle: React.FC<Props> = ({ className }) => {
  const { i18n, t } = useTranslation();

  const currentLang = (i18n.language || "en").toLowerCase().startsWith("it") ? "it" : "en";

  const setLang = async (lang: "en" | "it") => {
    try {
      await i18n.changeLanguage(lang);
      try { localStorage.setItem("cei_lang", lang); } catch { /* ignore */ }
    } catch { /* ignore */ }
  };

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        background: "rgba(15,23,42,0.8)",
        borderRadius: "999px",
        padding: "0.12rem",
        border: "1px solid rgba(148,163,184,0.2)",
        gap: "0.1rem",
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
  );
};

export default LanguageToggle;