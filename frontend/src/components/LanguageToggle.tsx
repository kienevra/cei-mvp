import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  variant?: "compact" | "pill";
  className?: string;
};

const LanguageToggle: React.FC<Props> = ({ variant = "compact", className }) => {
  const { i18n, t } = useTranslation();

  const currentLang = (i18n.language || "en").toLowerCase().startsWith("it") ? "it" : "en";

  const setLang = async (lang: "en" | "it") => {
    try {
      await i18n.changeLanguage(lang);
      // optional: persist (if you’re not already persisting elsewhere)
      try {
        localStorage.setItem("cei_lang", lang);
      } catch {
        // ignore
      }
    } catch {
      // ignore (non-fatal)
    }
  };

  const btnStyle: React.CSSProperties =
    variant === "pill"
      ? {
          padding: "0.3rem 0.55rem",
          fontSize: "0.78rem",
          borderRadius: "999px",
        }
      : {
          padding: "0.25rem 0.5rem",
          fontSize: "0.78rem",
        };

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
      }}
      aria-label={t("i18n.language", { defaultValue: "Language" })}
      title={t("i18n.language", { defaultValue: "Language" })}
    >
      <button
        type="button"
        className="cei-btn cei-btn-ghost"
        style={{ ...btnStyle, opacity: currentLang === "en" ? 1 : 0.75 }}
        onClick={() => setLang("en")}
        aria-pressed={currentLang === "en"}
      >
        EN
      </button>
      <button
        type="button"
        className="cei-btn cei-btn-ghost"
        style={{ ...btnStyle, opacity: currentLang === "it" ? 1 : 0.75 }}
        onClick={() => setLang("it")}
        aria-pressed={currentLang === "it"}
      >
        IT
      </button>
    </div>
  );
};

export default LanguageToggle;
