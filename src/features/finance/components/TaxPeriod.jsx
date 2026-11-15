import { formatTaxTableMonth } from "../lib/formatTaxTableMonth";
import styles from "./TaxPeriod.module.css";

export default function TaxPeriod({ monthStart, language }) {
  const period = formatTaxTableMonth(monthStart, language);

  if (!period) return "—";
  return (
    <span className={styles.taxPeriod}>
      <span>{period.month}</span>
      <span className={styles.taxPeriodYear}>{period.year}</span>
    </span>
  );
}
