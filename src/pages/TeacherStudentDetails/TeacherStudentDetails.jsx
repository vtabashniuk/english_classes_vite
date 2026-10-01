import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import {
  createPaymentAccount,
  getStudentFinanceOverview,
  getStudentFinanceTransactions,
  getTeacherPaymentAccounts,
  getMyCurrentTaxProfile,
  recordManualStudentPayment,
  resolvePaymentTax,
  setStudentLessonRate,
} from "../../features/finance/api/financeApi";
import { FINANCE_CURRENCIES } from "../../constants/finance";
import { getStudentById } from "../../features/profiles/api/profilesApi";
import { getIntlLocale } from "../../utils/getIntlLocale";
import { formatFinanceMoney } from "../../utils/formatFinanceMoney";

import styles from "./TeacherStudentDetails.module.css";

const DEFAULT_CURRENCY = "UAH";
const MINOR_UNIT_FACTOR = 100;

const TeacherStudentDetails = () => {
  const { studentId } = useParams();
  const { t, i18n } = useTranslation();
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [financeLoading, setFinanceLoading] = useState(true);
  const [financeError, setFinanceError] = useState("");
  const [financeOverview, setFinanceOverview] = useState(null);
  const [rateCurrency, setRateCurrency] = useState(DEFAULT_CURRENCY);
  const [lessonRate, setLessonRate] = useState("");
  const [rateEffectiveFrom, setRateEffectiveFrom] = useState(
    getLocalDateString(),
  );
  const [financeSaving, setFinanceSaving] = useState(false);
  const [financeSaveError, setFinanceSaveError] = useState("");
  const [financeSuccess, setFinanceSuccess] = useState("");

  const [financeActivityLoading, setFinanceActivityLoading] = useState(true);
  const [financeActivityError, setFinanceActivityError] = useState("");
  const [paymentAccounts, setPaymentAccounts] = useState([]);
  const [financeTransactions, setFinanceTransactions] = useState([]);
  const [currentTaxProfile, setCurrentTaxProfile] = useState(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState(DEFAULT_CURRENCY);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(getLocalDateString());
  const [paymentDescription, setPaymentDescription] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");

  const [accountName, setAccountName] = useState("");
  const [accountCurrency, setAccountCurrency] = useState(DEFAULT_CURRENCY);
  const [accountOwnerType, setAccountOwnerType] = useState("personal");
  const [accountType, setAccountType] = useState("bank_account");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");
  const [taxResolveError, setTaxResolveError] = useState("");
  const [taxRetryingPaymentId, setTaxRetryingPaymentId] = useState("");

  const paymentAttemptRef = useRef({ signature: "", requestId: "" });

  useEffect(() => {
    const loadStudent = async () => {
      try {
        setLoading(true);
        setErrorMessage("");

        const { data, error } = await getStudentById(studentId);

        if (error) throw error;

        if (!data) {
          setErrorMessage(t("teacherStudentDetails.errors.notFound"));
          return;
        }

        setStudent(data);
      } catch (error) {
        console.error("Student details load error:", error);
        setErrorMessage(t("teacherStudentDetails.errors.load"));
      } finally {
        setLoading(false);
      }
    };

    loadStudent();
  }, [studentId, t]);

  useEffect(() => {
    const loadFinance = async () => {
      try {
        setFinanceLoading(true);
        setFinanceError("");

        const { data, error } = await getStudentFinanceOverview(studentId);

        if (error) throw error;

        setFinanceOverview(data);

        applyFinanceFormState(data, {
          setRateCurrency,
          setLessonRate,
          setRateEffectiveFrom,
        });

        const activeCurrency =
          data?.currentRate?.currency ||
          data?.settings?.billing_currency ||
          DEFAULT_CURRENCY;

        setPaymentCurrency(activeCurrency);
        setAccountCurrency(activeCurrency);
      } catch (error) {
        console.error("Student finance load error:", error);
        setFinanceError(t("teacherStudentDetails.finance.errors.load"));
      } finally {
        setFinanceLoading(false);
      }
    };

    loadFinance();
  }, [studentId, t]);

  useEffect(() => {
    const loadFinanceActivity = async () => {
      try {
        setFinanceActivityLoading(true);
        setFinanceActivityError("");

        const [accountsResult, transactionsResult, taxProfileResult] = await Promise.all([
          getTeacherPaymentAccounts(),
          getStudentFinanceTransactions(studentId),
          getMyCurrentTaxProfile(),
        ]);

        if (accountsResult.error) throw accountsResult.error;
        if (transactionsResult.error) throw transactionsResult.error;
        if (taxProfileResult.error) throw taxProfileResult.error;

        setPaymentAccounts(accountsResult.data ?? []);
        setFinanceTransactions(transactionsResult.data ?? []);
        setCurrentTaxProfile(taxProfileResult.data ?? null);
      } catch (error) {
        console.error("Student finance activity load error:", error);
        setFinanceActivityError(
          t("teacherStudentDetails.finance.errors.activityLoad"),
        );
      } finally {
        setFinanceActivityLoading(false);
      }
    };

    loadFinanceActivity();
  }, [studentId, t]);

  const balancesByCurrency = useMemo(
    () =>
      Object.fromEntries(
        (financeOverview?.balances ?? []).map((item) => [
          item.currency,
          Number(item.balance_minor),
        ]),
      ),
    [financeOverview],
  );

  const activeBillingCurrency =
    financeOverview?.currentRate?.currency ||
    financeOverview?.settings?.billing_currency ||
    DEFAULT_CURRENCY;

  const primaryBalanceMinor =
    balancesByCurrency[activeBillingCurrency] ?? 0;
  const today = getLocalDateString();

  const peTaxEnabled = currentTaxProfile?.taxpayer_type === "pe";

  const eligiblePaymentAccounts = useMemo(
    () =>
      paymentAccounts.filter(
        (account) =>
          account.is_active &&
          account.currency === paymentCurrency &&
          (account.owner_type !== "pe" || peTaxEnabled),
      ),
    [paymentAccounts, paymentCurrency, peTaxEnabled],
  );

  const resolvedPaymentAccountId =
    paymentAccountId &&
    eligiblePaymentAccounts.some((account) => account.id === paymentAccountId)
      ? paymentAccountId
      : (eligiblePaymentAccounts[0]?.id ?? "");

  const selectedPaymentAccount = useMemo(
    () =>
      eligiblePaymentAccounts.find(
        (account) => account.id === resolvedPaymentAccountId,
      ) ?? null,
    [eligiblePaymentAccounts, resolvedPaymentAccountId],
  );

  const resolvedAccountOwnerType =
    peTaxEnabled && accountOwnerType === "pe" ? "pe" : "personal";
  const availableAccountTypes =
    resolvedAccountOwnerType === "pe"
      ? ["bank_account", "card", "cash"]
      : ["card", "cash"];
  const resolvedAccountType = availableAccountTypes.includes(accountType)
    ? accountType
    : availableAccountTypes[0];

  const formatDate = (dateString) =>
    new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateString));

  const formatDateTime = (dateString) =>
    new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateString));

  const formatMoney = (amountMinor, currency) =>
    formatFinanceMoney(
      amountMinor,
      currency,
      i18n.resolvedLanguage || i18n.language,
    );

  const formatSignedMoney = (amountMinor, currency) => {
    const amount = Number(amountMinor);
    const formatted = formatMoney(amount, currency);

    return amount > 0 ? `+${formatted}` : formatted;
  };

  const handleFinanceSubmit = async (event) => {
    event.preventDefault();

    setFinanceSaveError("");
    setFinanceSuccess("");

    const normalizedRate = lessonRate.trim().replace(",", ".");
    const numericRate = Number(normalizedRate);

    if (!normalizedRate) {
      setFinanceSaveError(
        t("teacherStudentDetails.finance.errors.rateRequired"),
      );
      return;
    }

    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      setFinanceSaveError(
        t("teacherStudentDetails.finance.errors.invalidRate"),
      );
      return;
    }

    if (!rateEffectiveFrom) {
      setFinanceSaveError(
        t("teacherStudentDetails.finance.errors.rateDateRequired"),
      );
      return;
    }

    if (rateEffectiveFrom < today) {
      setFinanceSaveError(
        t("teacherStudentDetails.finance.errors.pastRateDate"),
      );
      return;
    }

    try {
      setFinanceSaving(true);

      const { error } = await setStudentLessonRate({
        studentId,
        amountMinor: Math.round(numericRate * MINOR_UNIT_FACTOR),
        currency: rateCurrency,
        effectiveFrom: rateEffectiveFrom,
      });

      if (error) throw error;

      const { data: refreshedFinance, error: refreshError } =
        await getStudentFinanceOverview(studentId);

      if (refreshError) throw refreshError;

      setFinanceOverview(refreshedFinance);
      applyFinanceFormState(refreshedFinance, {
        setRateCurrency,
        setLessonRate,
        setRateEffectiveFrom,
      });

      setFinanceSuccess(
        t("teacherStudentDetails.finance.messages.rateSavedAndNotified"),
      );
    } catch (error) {
      console.error("Student finance save error:", error);
      setFinanceSaveError(getFinanceError(error, t));
    } finally {
      setFinanceSaving(false);
    }
  };

  const handlePaymentSubmit = async (event) => {
    event.preventDefault();
    setPaymentError("");
    setPaymentSuccess("");

    const normalizedAmount = paymentAmount.trim().replace(",", ".");
    const numericAmount = Number(normalizedAmount);
    const normalizedDescription = paymentDescription.trim();

    if (!normalizedAmount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setPaymentError(
        t("teacherStudentDetails.finance.errors.invalidPaymentAmount"),
      );
      return;
    }

    if (!paymentDate) {
      setPaymentError(
        t("teacherStudentDetails.finance.errors.paymentDateRequired"),
      );
      return;
    }

    if (paymentDate > today) {
      setPaymentError(
        t("teacherStudentDetails.finance.errors.futurePaymentDate"),
      );
      return;
    }

    if (!selectedPaymentAccount) {
      setPaymentError(
        t("teacherStudentDetails.finance.errors.paymentAccountRequired"),
      );
      return;
    }

    const amountMinor = Math.round(numericAmount * MINOR_UNIT_FACTOR);
    const paymentMethod =
      selectedPaymentAccount.account_type === "cash"
        ? "cash"
        : "bank_transfer";
    const paidAt = localDateToNoonIso(paymentDate);
    const signature = JSON.stringify({
      studentId,
      amountMinor,
      paymentCurrency,
      paymentAccountId: selectedPaymentAccount.id,
      paymentMethod,
      normalizedDescription,
      paidAt,
    });

    if (paymentAttemptRef.current.signature !== signature) {
      paymentAttemptRef.current = {
        signature,
        requestId: createClientRequestId(),
      };
    }

    try {
      setPaymentSaving(true);

      const { data: paymentResult, error } = await recordManualStudentPayment({
        studentId,
        amountMinor,
        currency: paymentCurrency,
        paymentAccountId: selectedPaymentAccount.id,
        paymentMethod,
        description: normalizedDescription,
        paidAt,
        clientRequestId: paymentAttemptRef.current.requestId,
      });

      if (error) throw error;

      const paymentId = Array.isArray(paymentResult)
        ? paymentResult[0]?.payment_id
        : paymentResult?.payment_id;
      let taxPending = false;

      if (paymentId && paymentCurrency !== "UAH") {
        const { error: fxError } = await resolvePaymentTax(paymentId);
        taxPending = Boolean(fxError);

        if (fxError) {
          console.error("NBU finance resolution error:", fxError);
        }
      }

      const [overviewResult, transactionsResult] = await Promise.all([
        getStudentFinanceOverview(studentId),
        getStudentFinanceTransactions(studentId),
      ]);

      if (overviewResult.error) throw overviewResult.error;
      if (transactionsResult.error) throw transactionsResult.error;

      setFinanceOverview(overviewResult.data);
      setFinanceTransactions(transactionsResult.data ?? []);
      setPaymentAmount("");
      setPaymentDescription("");
      setPaymentDate(getLocalDateString());
      paymentAttemptRef.current = { signature: "", requestId: "" };
      setPaymentSuccess(
        taxPending
          ? t("teacherStudentDetails.finance.messages.paymentSavedTaxPending")
          : t("teacherStudentDetails.finance.messages.paymentSaved"),
      );
    } catch (error) {
      console.error("Manual payment error:", error);
      setPaymentError(getPaymentError(error, t));
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleAccountSubmit = async (event) => {
    event.preventDefault();
    setAccountError("");
    setAccountSuccess("");

    const normalizedName = accountName.trim();

    if (!normalizedName) {
      setAccountError(
        t("teacherStudentDetails.finance.errors.accountNameRequired"),
      );
      return;
    }

    const provider = resolvedAccountType === "cash" ? "manual" : "monobank";

    try {
      setAccountSaving(true);

      const { data, error } = await createPaymentAccount({
        name: normalizedName,
        provider,
        accountType: resolvedAccountType,
        ownerType: resolvedAccountOwnerType,
        currency: accountCurrency,
      });

      if (error) throw error;

      const accountsResult = await getTeacherPaymentAccounts();

      if (accountsResult.error) throw accountsResult.error;

      const refreshedAccounts = accountsResult.data ?? [];
      const createdAccount =
        (data?.id && refreshedAccounts.find((account) => account.id === data.id)) ||
        refreshedAccounts.find(
          (account) =>
            account.name === normalizedName &&
            account.currency === accountCurrency,
        );

      setPaymentAccounts(refreshedAccounts);
      setPaymentCurrency(accountCurrency);
      setPaymentAccountId(createdAccount?.id ?? "");
      setAccountName("");
      setAccountSuccess(
        t("teacherStudentDetails.finance.messages.accountCreated"),
      );
    } catch (error) {
      console.error("Payment account create error:", error);
      setAccountError(getPaymentAccountError(error, t));
    } finally {
      setAccountSaving(false);
    }
  };

  const handleTaxRetry = async (paymentId) => {
    setTaxResolveError("");

    try {
      setTaxRetryingPaymentId(paymentId);

      const { error } = await resolvePaymentTax(paymentId);

      if (error) throw error;

      const transactionsResult = await getStudentFinanceTransactions(studentId);

      if (transactionsResult.error) throw transactionsResult.error;

      setFinanceTransactions(transactionsResult.data ?? []);
    } catch (error) {
      console.error("Tax retry error:", error);
      setTaxResolveError(
        t("teacherStudentDetails.finance.errors.taxRateResolve"),
      );
    } finally {
      setTaxRetryingPaymentId("");
    }
  };

  const backLink = (
    <Link to="/teacher-dashboard/students" className={styles.backLink}>
      ← {t("teacherStudentDetails.back")}
    </Link>
  );

  if (loading) {
    return (
      <section className={styles.page}>
        <p>{t("common.loading")}</p>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className={styles.page}>
        {backLink}
        <p className={styles.error}>{errorMessage}</p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      {backLink}

      <div className={styles.header}>
        <div className={styles.student}>
          <div className={styles.avatar}>
            {(student.full_name || student.email || "?").charAt(0).toUpperCase()}
          </div>

          <div>
            <div className={styles.titleRow}>
              <h1>{student.full_name || t("common.nameNotSpecified")}</h1>
              <span
                className={`${styles.status} ${
                  student.is_active ? styles.active : styles.inactive
                }`}
              >
                {student.is_active
                  ? t("common.active")
                  : t("common.inactive")}
              </span>
            </div>
            <p className={styles.email}>{student.email}</p>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <h2>{t("teacherStudentDetails.contactInfo")}</h2>
          <dl className={styles.details}>
            <div>
              <dt>{t("common.email")}</dt>
              <dd>{student.email}</dd>
            </div>
            <div>
              <dt>{t("common.phone")}</dt>
              <dd>{student.phone || t("common.notSpecified")}</dd>
            </div>
            <div>
              <dt>{t("teacherStudentDetails.addedDate")}</dt>
              <dd>{formatDate(student.created_at)}</dd>
            </div>
          </dl>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.balance")}</h2>
          </div>

          {financeLoading ? (
            <div className={styles.placeholder}>
              <span>{t("common.loading")}</span>
            </div>
          ) : financeError ? (
            <p className={styles.error}>{financeError}</p>
          ) : (
            <>
              <div className={styles.balanceSummary}>
                <strong
                  className={`${styles.balanceValue} ${
                    primaryBalanceMinor < 0
                      ? styles.balanceNegative
                      : primaryBalanceMinor > 0
                        ? styles.balancePositive
                        : ""
                  }`}
                >
                  {formatMoney(primaryBalanceMinor, activeBillingCurrency)}
                </strong>
                <span className={styles.balanceCaption}>
                  {t("teacherStudentDetails.finance.currentBalance")}
                </span>
              </div>

              <div className={styles.rateStatusList}>
                {financeOverview?.currentRate ? (
                  <div className={styles.rateStatus}>
                    <span>{t("teacherStudentDetails.finance.currentRate")}</span>
                    <strong>
                      {formatMoney(
                        financeOverview.currentRate.amount_minor,
                        financeOverview.currentRate.currency,
                      )}
                    </strong>
                    <small>
                      {t("teacherStudentDetails.finance.rateEffectiveFrom", {
                        date: formatDate(
                          financeOverview.currentRate.effective_from,
                        ),
                      })}
                    </small>
                  </div>
                ) : (
                  <p className={styles.rateMeta}>
                    {t("teacherStudentDetails.finance.rateNotSet")}
                  </p>
                )}

                {(financeOverview?.scheduledRates?.length ?? 0) > 0 && (
                  <div className={styles.scheduledRatesGroup}>
                    <span className={styles.scheduledRatesTitle}>
                      {t("teacherStudentDetails.finance.scheduledRates")}
                    </span>

                    <div className={styles.scheduledRatesList}>
                      {financeOverview.scheduledRates.map((rate) => (
                        <div
                          key={rate.id}
                          className={`${styles.rateStatus} ${styles.scheduledRate}`}
                        >
                          <strong>
                            {formatMoney(rate.amount_minor, rate.currency)}
                          </strong>
                          <small>
                            {t("teacherStudentDetails.finance.scheduledFrom", {
                              date: formatDate(rate.effective_from),
                            })}
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <form className={styles.financeForm} onSubmit={handleFinanceSubmit}>
                <strong className={styles.rateEditorTitle}>
                  {t("teacherStudentDetails.finance.setNewRate")}
                </strong>

                <div className={styles.financeFields}>
                  <label className={styles.field}>
                    <span>{t("teacherStudentDetails.finance.currency")}</span>
                    <select
                      value={rateCurrency}
                      onChange={(event) => {
                        const nextCurrency = event.target.value;
                        const editableRate = financeOverview?.currentRate;

                        setRateCurrency(nextCurrency);

                        if (editableRate && nextCurrency !== editableRate.currency) {
                          setLessonRate("");
                        } else if (editableRate) {
                          setLessonRate(
                            minorToInputValue(editableRate.amount_minor),
                          );
                        }

                        setFinanceSaveError("");
                        setFinanceSuccess("");
                      }}
                      disabled={financeSaving}
                    >
                      {FINANCE_CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={styles.field}>
                    <span>{t("teacherStudentDetails.finance.lessonRate")}</span>
                    <div className={styles.moneyInputWrap}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={lessonRate}
                        onChange={(event) => {
                          setLessonRate(event.target.value);
                          setFinanceSaveError("");
                          setFinanceSuccess("");
                        }}
                        placeholder="0.00"
                        disabled={financeSaving}
                      />
                      <span>{rateCurrency}</span>
                    </div>
                  </label>

                  <label className={`${styles.field} ${styles.dateField}`}>
                    <span>{t("teacherStudentDetails.finance.effectiveFrom")}</span>
                    <input
                      type="date"
                      min={today}
                      value={rateEffectiveFrom}
                      onChange={(event) => {
                        setRateEffectiveFrom(event.target.value);
                        setFinanceSaveError("");
                        setFinanceSuccess("");
                      }}
                      disabled={financeSaving}
                    />
                  </label>
                </div>

                <p className={styles.rateHint}>
                  {t("teacherStudentDetails.finance.effectiveFromHint")}
                </p>

                {financeSaveError && (
                  <p className={styles.error}>{financeSaveError}</p>
                )}

                {financeSuccess && (
                  <p className={styles.success}>{financeSuccess}</p>
                )}

                <div className={styles.financeActions}>
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={financeSaving}
                  >
                    {financeSaving
                      ? t("teacherStudentDetails.finance.saving")
                      : t("teacherStudentDetails.finance.saveRate")}
                  </button>
                </div>
              </form>

              <div className={styles.currencyBalances}>
                <span className={styles.currencyBalancesTitle}>
                  {t("teacherStudentDetails.finance.allBalances")}
                </span>
                <div className={styles.currencyBalanceList}>
                  {FINANCE_CURRENCIES.map((currency) => (
                    <span key={currency} className={styles.currencyBalanceItem}>
                      <strong>{currency}</strong>
                      {formatMoney(balancesByCurrency[currency] ?? 0, currency)}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </article>

        <article className={`${styles.card} ${styles.financeActivityCard}`}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.finance.paymentsAndHistory")}</h2>
          </div>

          {financeActivityLoading ? (
            <div className={styles.placeholder}>
              <span>{t("common.loading")}</span>
            </div>
          ) : financeActivityError ? (
            <p className={styles.error}>{financeActivityError}</p>
          ) : (
            <div className={styles.financeActivityGrid}>
              <div className={styles.financeActivityColumn}>
                <section className={styles.financeSubsection}>
                  <div className={styles.subsectionHeader}>
                    <div>
                      <h3>{t("teacherStudentDetails.finance.addPayment")}</h3>
                      <p>{t("teacherStudentDetails.finance.addPaymentHint")}</p>
                    </div>
                  </div>

                  <form className={styles.paymentForm} onSubmit={handlePaymentSubmit}>
                    <div className={styles.financeFields}>
                      <label className={styles.field}>
                        <span>{t("teacherStudentDetails.finance.paymentCurrency")}</span>
                        <select
                          value={paymentCurrency}
                          onChange={(event) => {
                            setPaymentCurrency(event.target.value);
                            setPaymentError("");
                            setPaymentSuccess("");
                          }}
                          disabled={paymentSaving}
                        >
                          {FINANCE_CURRENCIES.map((currency) => (
                            <option key={currency} value={currency}>
                              {currency}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.field}>
                        <span>{t("teacherStudentDetails.finance.paymentAmount")}</span>
                        <div className={styles.moneyInputWrap}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={paymentAmount}
                            onChange={(event) => {
                              setPaymentAmount(event.target.value);
                              setPaymentError("");
                              setPaymentSuccess("");
                            }}
                            placeholder="0.00"
                            disabled={paymentSaving}
                          />
                          <span>{paymentCurrency}</span>
                        </div>
                      </label>

                      <label className={`${styles.field} ${styles.fullField}`}>
                        <span>{t("teacherStudentDetails.finance.paymentAccount")}</span>
                        <select
                          value={resolvedPaymentAccountId}
                          onChange={(event) => {
                            setPaymentAccountId(event.target.value);
                            setPaymentError("");
                            setPaymentSuccess("");
                          }}
                          disabled={paymentSaving || eligiblePaymentAccounts.length === 0}
                        >
                          {eligiblePaymentAccounts.length === 0 ? (
                            <option value="">
                              {t("teacherStudentDetails.finance.noPaymentAccounts")}
                            </option>
                          ) : (
                            eligiblePaymentAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))
                          )}
                        </select>
                      </label>

                      <label className={styles.field}>
                        <span>{t("teacherStudentDetails.finance.paymentDate")}</span>
                        <input
                          type="date"
                          max={today}
                          value={paymentDate}
                          onChange={(event) => {
                            setPaymentDate(event.target.value);
                            setPaymentError("");
                            setPaymentSuccess("");
                          }}
                          disabled={paymentSaving}
                        />
                      </label>

                      <div className={styles.field}>
                        <span>{t("teacherStudentDetails.finance.paymentMethod")}</span>
                        <div className={styles.readOnlyValue}>
                          {selectedPaymentAccount
                            ? t(
                                `teacherStudentDetails.finance.methods.${
                                  selectedPaymentAccount.account_type === "cash"
                                    ? "cash"
                                    : "bank_transfer"
                                }`,
                              )
                            : "—"}
                        </div>
                      </div>

                      <label className={`${styles.field} ${styles.fullField}`}>
                        <span>{t("teacherStudentDetails.finance.paymentNote")}</span>
                        <textarea
                          value={paymentDescription}
                          onChange={(event) => {
                            setPaymentDescription(event.target.value);
                            setPaymentError("");
                            setPaymentSuccess("");
                          }}
                          maxLength={500}
                          rows={3}
                          disabled={paymentSaving}
                        />
                      </label>
                    </div>

                    {eligiblePaymentAccounts.length === 0 && (
                      <p className={styles.rateHint}>
                        {t("teacherStudentDetails.finance.createAccountFirst", {
                          currency: paymentCurrency,
                        })}
                      </p>
                    )}

                    {paymentError && <p className={styles.error}>{paymentError}</p>}
                    {paymentSuccess && (
                      <p className={styles.success}>{paymentSuccess}</p>
                    )}

                    <div className={styles.financeActions}>
                      <button
                        type="submit"
                        className={styles.primaryButton}
                        disabled={paymentSaving || eligiblePaymentAccounts.length === 0}
                      >
                        {paymentSaving
                          ? t("teacherStudentDetails.finance.savingPayment")
                          : t("teacherStudentDetails.finance.savePayment")}
                      </button>
                    </div>
                  </form>
                </section>

                <section className={styles.financeSubsection}>
                  <div className={styles.subsectionHeader}>
                    <div>
                      <h3>{t("teacherStudentDetails.finance.paymentAccounts")}</h3>
                      <p>{t("teacherStudentDetails.finance.paymentAccountsHint")}</p>
                    </div>
                  </div>

                  {paymentAccounts.length > 0 && (
                    <div className={styles.accountList}>
                      {paymentAccounts.map((account) => (
                        <span key={account.id} className={styles.accountChip}>
                          <strong>{account.name}</strong>
                          <small>
                            {account.currency} · {t(
                              `teacherStudentDetails.finance.accountOwners.${account.owner_type}`,
                            )} · {t(
                              `teacherStudentDetails.finance.accountTypes.${account.account_type}`,
                            )}
                          </small>
                        </span>
                      ))}
                    </div>
                  )}

                  <form className={styles.accountForm} onSubmit={handleAccountSubmit}>
                    <div className={styles.financeFields}>
                      <label className={`${styles.field} ${styles.fullField}`}>
                        <span>{t("teacherStudentDetails.finance.accountName")}</span>
                        <input
                          type="text"
                          value={accountName}
                          onChange={(event) => {
                            setAccountName(event.target.value);
                            setAccountError("");
                            setAccountSuccess("");
                          }}
                          placeholder={t(
                            "teacherStudentDetails.finance.accountNamePlaceholder",
                          )}
                          maxLength={100}
                          disabled={accountSaving}
                        />
                      </label>

                      <label className={styles.field}>
                        <span>{t("teacherStudentDetails.finance.accountCurrency")}</span>
                        <select
                          value={accountCurrency}
                          onChange={(event) => {
                            setAccountCurrency(event.target.value);
                            setAccountError("");
                            setAccountSuccess("");
                          }}
                          disabled={accountSaving}
                        >
                          {FINANCE_CURRENCIES.map((currency) => (
                            <option key={currency} value={currency}>
                              {currency}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.field}>
                        <span>{t("teacherStudentDetails.finance.accountOwner")}</span>
                        <select
                          value={resolvedAccountOwnerType}
                          onChange={(event) => {
                            setAccountOwnerType(event.target.value);
                            setAccountError("");
                            setAccountSuccess("");
                          }}
                          disabled={accountSaving}
                        >
                          <option value="personal">
                            {t("teacherStudentDetails.finance.accountOwners.personal")}
                          </option>
                          {peTaxEnabled && (
                            <option value="pe">
                              {t("teacherStudentDetails.finance.accountOwners.pe")}
                            </option>
                          )}
                        </select>
                      </label>

                      {!peTaxEnabled && (
                        <p className={`${styles.rateHint} ${styles.fullField}`}>
                          {t("teacherStudentDetails.finance.peAccountRequiresTaxProfile")}
                        </p>
                      )}

                      <label className={styles.field}>
                        <span>{t("teacherStudentDetails.finance.accountKind")}</span>
                        <select
                          value={resolvedAccountType}
                          onChange={(event) => {
                            setAccountType(event.target.value);
                            setAccountError("");
                            setAccountSuccess("");
                          }}
                          disabled={accountSaving}
                        >
                          {availableAccountTypes.map((type) => (
                            <option key={type} value={type}>
                              {t(`teacherStudentDetails.finance.accountTypes.${type}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {accountError && <p className={styles.error}>{accountError}</p>}
                    {accountSuccess && (
                      <p className={styles.success}>{accountSuccess}</p>
                    )}

                    <div className={styles.financeActions}>
                      <button
                        type="submit"
                        className={styles.secondaryButton}
                        disabled={accountSaving}
                      >
                        {accountSaving
                          ? t("teacherStudentDetails.finance.creatingAccount")
                          : t("teacherStudentDetails.finance.createAccount")}
                      </button>
                    </div>
                  </form>
                </section>
              </div>

              <section className={`${styles.financeSubsection} ${styles.historySection}`}>
                <div className={styles.subsectionHeader}>
                  <div>
                    <h3>{t("teacherStudentDetails.finance.history")}</h3>
                    <p>{t("teacherStudentDetails.finance.historyHint")}</p>
                  </div>
                </div>

                {taxResolveError && (
                  <p className={styles.error}>{taxResolveError}</p>
                )}

                {financeTransactions.length === 0 ? (
                  <p className={styles.rateMeta}>
                    {t("teacherStudentDetails.finance.historyEmpty")}
                  </p>
                ) : (
                  <div className={styles.transactionList}>
                    {financeTransactions.map((transaction) => (
                      <div key={transaction.id} className={styles.transactionRow}>
                        <div className={styles.transactionInfo}>
                          <strong>
                            {t(
                              `teacherStudentDetails.finance.transactionTypes.${transaction.transaction_type}`,
                            )}
                          </strong>
                          <span>{formatDateTime(transaction.effective_at)}</span>

                          {transaction.paymentAccount && (
                            <span>
                              {transaction.paymentAccount.name} · {t(
                                `teacherStudentDetails.finance.methods.${transaction.payment?.payment_method}`,
                              )}
                            </span>
                          )}

                          {transaction.description && (
                            <small>{transaction.description}</small>
                          )}

                          {transaction.taxAccrual && (
                            <div className={styles.taxBreakdown}>
                              <strong>
                                {t("teacherStudentDetails.finance.tax.title")}
                              </strong>

                              {transaction.taxAccrual.status === "ready" ? (
                                <>
                                  {transaction.taxAccrual.source_currency !== "UAH" && (
                                    <span>
                                      {t("teacherStudentDetails.finance.tax.nbuRate")}: {Number(
                                        transaction.taxAccrual.fx_rate,
                                      ).toFixed(4)} UAH/{transaction.taxAccrual.source_currency}
                                    </span>
                                  )}
                                  <span>
                                    {t("teacherStudentDetails.finance.tax.taxBase")}: {formatMoney(
                                      transaction.taxAccrual.tax_base_uah_minor,
                                      "UAH",
                                    )}
                                  </span>
                                  {transaction.taxAccrual.single_tax_basis ===
                                    "income_percent" && (
                                    <span>
                                      {t("teacherStudentDetails.finance.tax.singleTax")}: {formatMoney(
                                        transaction.taxAccrual.single_tax_minor,
                                        "UAH",
                                      )}
                                    </span>
                                  )}
                                  {transaction.taxAccrual.military_levy_basis ===
                                    "income_percent" && (
                                    <span>
                                      {t("teacherStudentDetails.finance.tax.militaryLevy")}: {formatMoney(
                                        transaction.taxAccrual.military_levy_minor,
                                        "UAH",
                                      )}
                                    </span>
                                  )}
                                  {transaction.taxAccrual.single_tax_basis ===
                                    "income_percent" ||
                                  transaction.taxAccrual.military_levy_basis ===
                                    "income_percent" ? (
                                    <strong>
                                      {t("teacherStudentDetails.finance.tax.totalIncomeTaxes")}: {formatMoney(
                                        transaction.taxAccrual.total_income_taxes_minor,
                                        "UAH",
                                      )}
                                    </strong>
                                  ) : (
                                    <span>
                                      {t("teacherStudentDetails.finance.tax.monthlyProfileNote")}
                                    </span>
                                  )}
                                </>
                              ) : transaction.taxAccrual.status === "fx_pending" ? (
                                <>
                                  <span>
                                    {t("teacherStudentDetails.finance.tax.fxPending")}
                                  </span>
                                  <button
                                    type="button"
                                    className={styles.inlineButton}
                                    onClick={() => handleTaxRetry(transaction.payment_id)}
                                    disabled={taxRetryingPaymentId === transaction.payment_id}
                                  >
                                    {taxRetryingPaymentId === transaction.payment_id
                                      ? t("teacherStudentDetails.finance.tax.retrying")
                                      : t("teacherStudentDetails.finance.tax.retry")}
                                  </button>
                                </>
                              ) : (
                                <span>{t("teacherStudentDetails.finance.tax.parametersMissing")}</span>
                              )}
                            </div>
                          )}
                        </div>

                        <strong
                          className={`${styles.transactionAmount} ${
                            Number(transaction.amount_minor) < 0
                              ? styles.balanceNegative
                              : styles.balancePositive
                          }`}
                        >
                          {formatSignedMoney(
                            transaction.amount_minor,
                            transaction.currency,
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.recurringSchedule")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.recurringPlaceholder")}</span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.upcomingLessons")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.upcomingPlaceholder")}</span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.assignments")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.assignmentsPlaceholder")}</span>
          </div>
        </article>

        <article className={`${styles.card} ${styles.notesCard}`}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.privateNotes")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.notesPlaceholder")}</span>
          </div>
        </article>
      </div>
    </section>
  );
};

const minorToInputValue = (amountMinor) => {
  const amount = Number(amountMinor) / MINOR_UNIT_FACTOR;

  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

const getLocalDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const localDateToNoonIso = (dateString) =>
  new Date(`${dateString}T12:00:00`).toISOString();

const createClientRequestId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;

    return value.toString(16);
  });
};

const applyFinanceFormState = (overview, setters) => {
  const activeCurrency =
    overview?.currentRate?.currency ||
    overview?.settings?.billing_currency ||
    DEFAULT_CURRENCY;
  const editableRate = overview?.currentRate;

  setters.setRateCurrency(editableRate?.currency || activeCurrency);
  setters.setLessonRate(
    editableRate ? minorToInputValue(editableRate.amount_minor) : "",
  );
  setters.setRateEffectiveFrom(getLocalDateString());
};

const getFinanceError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("INVALID_LESSON_RATE")) {
    return t("teacherStudentDetails.finance.errors.invalidRate");
  }

  if (message.includes("LESSON_RATE_PAST_DATE_NOT_ALLOWED")) {
    return t("teacherStudentDetails.finance.errors.pastRateDate");
  }

  if (message.includes("LESSON_RATE_UNCHANGED")) {
    return t("teacherStudentDetails.finance.errors.rateUnchanged");
  }

  if (message.includes("STUDENT_NOT_ASSIGNED")) {
    return t("teacherStudentDetails.finance.errors.studentNotAssigned");
  }

  if (message.includes("TEACHER_REQUIRED")) {
    return t("teacherStudentDetails.finance.errors.teacherRequired");
  }

  return t("teacherStudentDetails.finance.errors.save");
};

const getPaymentError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("INVALID_PAYMENT_AMOUNT")) {
    return t("teacherStudentDetails.finance.errors.invalidPaymentAmount");
  }

  if (message.includes("PAYMENT_ACCOUNT_NOT_FOUND_OR_CURRENCY_MISMATCH")) {
    return t("teacherStudentDetails.finance.errors.paymentAccountMismatch");
  }

  if (
    message.includes("CASH_PAYMENT_REQUIRES_CASH_ACCOUNT") ||
    message.includes("BANK_TRANSFER_REQUIRES_NON_CASH_ACCOUNT") ||
    message.includes("INVALID_MANUAL_PAYMENT_METHOD")
  ) {
    return t("teacherStudentDetails.finance.errors.paymentMethodMismatch");
  }

  if (message.includes("PAYMENT_REQUEST_ID_CONFLICT")) {
    return t("teacherStudentDetails.finance.errors.paymentRequestConflict");
  }

  if (message.includes("PE_TAX_PROFILE_REQUIRED_FOR_PAYMENT")) {
    return t("teacherStudentDetails.finance.errors.peTaxProfileRequired");
  }

  if (message.includes("STUDENT_NOT_ASSIGNED")) {
    return t("teacherStudentDetails.finance.errors.studentNotAssigned");
  }

  return t("teacherStudentDetails.finance.errors.paymentSave");
};

const getPaymentAccountError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("INVALID_PAYMENT_ACCOUNT_NAME")) {
    return t("teacherStudentDetails.finance.errors.accountNameRequired");
  }

  if (
    message.includes("payment_accounts_teacher_name_idx") ||
    message.includes("duplicate key")
  ) {
    return t("teacherStudentDetails.finance.errors.accountNameDuplicate");
  }

  if (message.includes("PE_TAX_PROFILE_REQUIRED_FOR_ACCOUNT")) {
    return t("teacherStudentDetails.finance.errors.peAccountRequiresTaxProfile");
  }

  if (message.includes("PERSONAL_ACCOUNT_TYPE_NOT_ALLOWED")) {
    return t("teacherStudentDetails.finance.errors.personalAccountTypeNotAllowed");
  }

  return t("teacherStudentDetails.finance.errors.accountCreate");
};

export default TeacherStudentDetails;
