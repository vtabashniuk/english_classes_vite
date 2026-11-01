export const getStudentBalanceDisplay = (overview) => {
  const balancesByCurrency = Object.fromEntries(
    (overview?.balances ?? []).map((item) => [item.currency, Number(item.balance_minor)]),
  );
  const billingCurrency =
    overview?.currentRate?.currency || overview?.settings?.billing_currency || "UAH";
  return {
    billingCurrency,
    primaryBalanceMinor: balancesByCurrency[billingCurrency] ?? 0,
    balancesByCurrency,
  };
};
