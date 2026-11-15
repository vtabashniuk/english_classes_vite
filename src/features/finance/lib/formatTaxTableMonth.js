/** Compact, localized month label for the tax-accrual table. */
export const formatTaxTableMonth = (dateString, language) => {
  if (typeof dateString !== "string") return null;
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(dateString);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || month < 1 || month > 12) return null;

  const locale = String(language).startsWith("en")
    ? "en-GB"
    : String(language).startsWith("ru")
      ? "ru-RU"
      : "uk-UA";

  const date = new Date(Date.UTC(year, month - 1, 1));
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const capitalizedMonth =
    monthLabel.charAt(0).toLocaleUpperCase(locale) + monthLabel.slice(1);

  return { month: capitalizedMonth, year: match[1] };
};
