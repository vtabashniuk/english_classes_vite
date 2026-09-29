const normalizeLanguage = (language) => String(language || "uk").toLowerCase();

const formatNumber = (value) =>
  new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
    .format(value)
    .replace(/[\u00A0\u202F]/g, " ");

export const formatFinanceMoney = (amountMinor, currency, language) => {
  if (!Number.isFinite(Number(amountMinor))) return "—";

  const amount = Number(amountMinor) / 100;
  const number = formatNumber(amount);
  const lang = normalizeLanguage(language);

  if (currency === "UAH") {
    return lang.startsWith("en") ? `UAH ${number}` : `${number} грн.`;
  }

  return lang.startsWith("en") ? `${currency} ${number}` : `${number} ${currency}`;
};

export const formatFinanceMajor = (amount, currency, language) => {
  if (!Number.isFinite(Number(amount))) return "—";

  return formatFinanceMoney(Math.round(Number(amount) * 100), currency, language);
};

export const formatPercentValue = (ratio) => {
  if (!Number.isFinite(Number(ratio))) return "—";

  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })
    .format(Number(ratio) * 100)
    .replace(/[\u00A0\u202F]/g, " ");
};
