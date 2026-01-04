// frontend/src/i18n.ts
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
  // Make language persistence robust across refreshes and re-inits.
  // - explicit storage (localStorage)
  // - cookie backup for some edge deployments / embedded contexts
  // - no dependency on navigator after first init
  detection: {
    // This is only used by i18next-browser-languagedetector, but keeping the
    // config here is harmless and documents intent. If the detector is present,
    // it will respect these settings.
    order: ["localStorage", "cookie", "navigator"],
    lookupLocalStorage: STORAGE_KEY,
    caches: ["localStorage", "cookie"],
  } as any,
  // Keep UX stable even if a key is missing:
  // if a key doesn't exist, i18next will return the key by default.
});

i18n.on("languageChanged", (lng) => {
  const normalized = normalizeLang(lng);

  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // ignore
  }

  // Cookie backup (helps in some embedded / privacy-restricted scenarios)
  try {
    if (typeof document !== "undefined") {
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `${STORAGE_KEY}=${normalized}; path=/; max-age=${oneYear}`;
    }
  } catch {
    // ignore
  }
});

export default i18n;
