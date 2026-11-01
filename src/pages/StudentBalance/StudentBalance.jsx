import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../context/useAuth";
import { getMyActiveTeacherLink } from "../../features/auth/api/googleInvitationsApi";
import { getStudentFinanceOverview } from "../../features/finance/api/financeApi";
import { getPublishedTeacherPaymentInstructions } from "../../features/finance/api/paymentInstructionsApi";
import { getStudentBalanceDisplay } from "../../features/finance/lib/studentBalance";
import { formatFinanceMoney } from "../../utils/formatFinanceMoney";
import styles from "./StudentBalance.module.css";

const CURRENCIES = ["UAH", "USD", "EUR"];

const StudentBalance = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [instructions, setInstructions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const link = await getMyActiveTeacherLink(user.id);
        if (link.error) throw link.error;
        if (!link.data?.teacher_id) throw new Error("ACTIVE_TEACHER_NOT_FOUND");
        const [finance, payment] = await Promise.all([
          getStudentFinanceOverview(user.id, { teacherId: link.data.teacher_id }),
          getPublishedTeacherPaymentInstructions(link.data.teacher_id),
        ]);
        if (finance.error || payment.error) throw finance.error || payment.error;
        if (active) {
          setOverview(finance.data);
          setInstructions(payment.data ?? []);
        }
      } catch (cause) {
        console.error("Student balance load error:", cause);
        if (active) setError(t("studentBalance.loadError"));
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [user?.id, t]);

  const { billingCurrency, balancesByCurrency, primaryBalanceMinor } = useMemo(
    () => getStudentBalanceDisplay(overview), [overview],
  );
  const displayedCurrencies = CURRENCIES;
  const money = (amount, currency) => formatFinanceMoney(amount, currency, i18n.resolvedLanguage);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1>{t("studentBalance.title")}</h1>
        <p>{t("studentBalance.description")}</p>
      </header>
      {loading ? <p role="status">{t("common.loading")}</p> : error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : (
        <>
          <section className={styles.card} aria-label={t("studentBalance.currentBalance")}>
            <h2>{t("studentBalance.currentBalance")}</h2>
            <div className={`${styles.mainBalance} ${primaryBalanceMinor < 0 ? styles.negative : ""}`}>
              {money(primaryBalanceMinor, billingCurrency)}
            </div>
            <p className={styles.hint}>{t("studentBalance.balanceNote")}</p>
            <div className={styles.balanceList}>
              {displayedCurrencies.map((currency) => (
                <div key={currency} className={styles.balanceRow}>
                  <span>{currency}</span>
                  <strong>{money(balancesByCurrency[currency] ?? 0, currency)}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className={styles.card}>
            <h2>{t("studentBalance.paymentTitle")}</h2>
            {instructions.length === 0 ? (
              <p className={styles.hint}>{t("studentBalance.noPaymentDetails")}</p>
            ) : (
              <div className={styles.instructionsGrid}>
                {instructions.map((item) => (
                  <article key={item.currency} className={styles.instruction}>
                    <h3>{t("studentBalance.forCurrency", { currency: item.currency })}</h3>
                    <dl className={styles.details}>
                      {[
                        ["recipient", item.recipient_name],
                        ["bank", item.bank_name],
                        ["iban", item.iban],
                        ["purpose", item.payment_purpose],
                      ].filter(([, value]) => value).map(([key, value]) => (
                        <div key={key}><dt>{t(`studentBalance.${key}`)}</dt><dd>{value}</dd></div>
                      ))}
                    </dl>
                    {item.notes && <p className={styles.hint}>{item.notes}</p>}
                    {item.qr_image_url && <img className={styles.qr} src={item.qr_image_url} alt={t("studentBalance.qrAlt", { currency: item.currency })} loading="lazy" referrerPolicy="no-referrer" />}
                    {item.payment_url && <a href={item.payment_url} target="_blank" rel="noopener noreferrer" className={styles.payLink}>{t("studentBalance.openPaymentLink")}</a>}
                  </article>
                ))}
              </div>
            )}
            <p className={styles.hint}>{t("studentBalance.manualPaymentsNote")}</p>
          </section>
        </>
      )}
    </section>
  );
};

export default StudentBalance;
