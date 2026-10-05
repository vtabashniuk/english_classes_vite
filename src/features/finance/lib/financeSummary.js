export const buildFinanceReceiptSummary = (rows = []) => {
  const summary = rows.reduce(
    (result, row) => {
      const currency = row.currency;

      if (currency) {
        result.totalsByCurrency[currency] =
          Number(result.totalsByCurrency[currency] ?? 0) +
          Number(row.amount_minor ?? 0);
      }

      if (row.reporting_uah_minor != null) {
        result.totalIncomeUahMinor += Number(row.reporting_uah_minor);
      } else {
        result.reportingPending = true;
      }

      if (
        row.profitability_status === "ready" &&
        row.net_income_uah_minor != null
      ) {
        result.netIncomeUahMinor += Number(row.net_income_uah_minor);
      } else {
        result.profitabilityPending = true;
      }

      if (row.profitability_status !== "ready") {
        result.reportingPending = true;
      }

      return result;
    },
    {
      totalsByCurrency: {},
      totalIncomeUahMinor: 0,
      netIncomeUahMinor: 0,
      reportingPending: false,
      profitabilityPending: false,
    },
  );

  return summary;
};
