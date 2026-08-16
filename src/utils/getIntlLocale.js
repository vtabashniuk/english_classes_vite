const INTL_LOCALES = {
  ua: "uk-UA",
  uk: "uk-UA",
  ru: "ru-RU",
  en: "en-GB",
};

export const getIntlLocale = (language) => {
  const baseLanguage = language?.split("-")[0]?.toLowerCase();
  return INTL_LOCALES[baseLanguage] || "en-GB";
};
