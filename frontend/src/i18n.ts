import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import it from "./locales/it.json";

const STORAGE_KEY = "cei_lang";

function normalizeLang(input: string | null | undefined): "en" | "it" {
  const raw = String(input || "").toLowerCase();
  if (raw.startsWith("it")) return "it";
  return "en";
}

function detectInitialLanguage(): "en" | "it" {
  // 1) Explicit stored preference
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeLang(stored);
  } catch {
    // ignore
  }

  // 2) Browser language
  if (typeof navigator !== "undefined") {
    const navLang =
      (navigator.languages && navigator.languages[0]) || navigator.language;
    return normalizeLang(navLang);
  }

  return "en";
}

const resources = {
  en: { translation: en },
  it: { translation: it },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes by default
  },
  returnEmptyString: false,
  // Keep UX stable even if a key is missing:
  // if a key doesn't exist, i18next will return the key by default.
});

i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeLang(lng));
  } catch {
    // ignore
  }
});

export default i18n;
