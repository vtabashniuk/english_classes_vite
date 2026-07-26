import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import enTranslation from "./locales/en/translation.json";
import uaTranslation from "./locales/ua/translation.json";
import ruTranslation from "./locales/ru/translation.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslation },
      ua: { translation: uaTranslation },
      ru: { translation: ruTranslation },
    },
    fallbackLng: "ua",
    supportedLngs: ["ua", "en", "ru"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
