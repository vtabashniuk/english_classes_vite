import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import {
  cancelManualStudentPayment,
  correctManualStudentPayment,
  getStudentFinanceOverview,
  getStudentFinanceTransactions,
  getTeacherPaymentAccounts,
  getTeacherStudentFinanceHealth,
  recordManualStudentPayment,
  resolvePaymentTax,
  setStudentLessonRate,
  transferManualStudentPayment,
} from "../../features/finance/api/financeApi";
import { sortFinanceOperationsNewestFirst } from "../../features/finance/lib/financeSort";
import {
  DEFAULT_FINANCE_HISTORY_DAYS,
  DEFAULT_FINANCE_SETTINGS,
  FINANCE_CURRENCIES,
} from "../../constants/finance";
import { getStudentById } from "../../features/profiles/api/profilesApi";
import { getMyTeacherScheduleSettings } from "../../features/settings/api/teacherSettingsApi";
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

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState(DEFAULT_CURRENCY);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(getLocalDateString());
  const [paymentDescription, setPaymentDescription] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");
  const [editingPaymentId, setEditingPaymentId] = useState("");
  const [paymentAction, setPaymentAction] = useState(null);
  const [paymentActionSaving, setPaymentActionSaving] = useState(false);
  const [paymentActionError, setPaymentActionError] = useState("");
  const [paymentActionSuccess, setPaymentActionSuccess] = useState("");
  const [cancelReasonCode, setCancelReasonCode] = useState("duplicate");
  const [cancelReasonNote, setCancelReasonNote] = useState("");
  const [transferStudentId, setTransferStudentId] = useState("");
  const [transferReasonCode, setTransferReasonCode] = useState("wrong_student");
  const [transferReasonNote, setTransferReasonNote] = useState("");
  const [transferCandidates, setTransferCandidates] = useState([]);
  const [paymentActionRequestId, setPaymentActionRequestId] = useState("");

  const [historyDateFrom, setHistoryDateFrom] = useState(() =>
    getLocalDateDaysAgo(DEFAULT_FINANCE_HISTORY_DAYS - 1),
  );
  const [historyDateTo, setHistoryDateTo] = useState(getLocalDateString());
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(
    DEFAULT_FINANCE_SETTINGS.historyPageSize,
  );
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const [taxResolveError, setTaxResolveError] = useState("");
  const [taxRetryingPaymentId, setTaxRetryingPaymentId] = useState("");

  const paymentAttemptRef = useRef({ signature: "", requestId: "" });
  const historySectionRef = useRef(null);

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

        const [accountsResult, settingsResult, studentsResult] = await Promise.all([
          getTeacherPaymentAccounts(),
          getMyTeacherScheduleSettings(),
          getTeacherStudentFinanceHealth(),
        ]);

        if (accountsResult.error || settingsResult.error || studentsResult.error) {
          throw accountsResult.error || settingsResult.error || studentsResult.error;
        }

        setPaymentAccounts(accountsResult.data ?? []);
        setTransferCandidates(
          (studentsResult.data ?? []).filter((item) => item.student_id !== studentId),
        );
        setHistoryPageSize(
          Number(
            settingsResult.data?.finance_history_page_size ??
              DEFAULT_FINANCE_SETTINGS.historyPageSize,
          ),
        );
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

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError("");

        const result = await getStudentFinanceTransactions(studentId, {
          limit: historyPageSize,
          offset: historyPage * historyPageSize,
          dateFrom: historyDateFrom || null,
          dateTo: historyDateTo || null,
        });

        if (result.error) throw result.error;
        if (cancelled) return;

        setFinanceTransactions(result.data ?? []);
        setHistoryTotal(result.count ?? 0);
      } catch (error) {
        if (cancelled) return;
        console.error("Student finance history load error:", error);
        setHistoryError(t("teacherStudentDetails.finance.errors.historyLoad"));
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [historyDateFrom, historyDateTo, historyPage, historyPageSize, studentId, t]);

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

  const eligiblePaymentAccounts = useMemo(
    () =>
      paymentAccounts.filter(
        (account) => account.is_active && account.currency === paymentCurrency,
      ),
    [paymentAccounts, paymentCurrency],
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

  const lessonRateIsValid = isPositiveIntegerInput(lessonRate);
  const paymentAmountMinor = parseMoneyInputToMinor(paymentAmount);
  const paymentAmountIsValid = paymentAmountMinor !== null && paymentAmountMinor > 0;
  const historyPageCount = Math.max(
    1,
    Math.ceil(historyTotal / historyPageSize),
  );

  const handleHistoryPageChange = (nextPage) => {
    setHistoryPage(nextPage);

    window.requestAnimationFrame(() => {
      historySectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };
  const isEditingPayment = Boolean(editingPaymentId);
  const transactionDisplayGroups = useMemo(
    () => buildTransactionDisplayGroups(financeTransactions),
    [financeTransactions],
  );

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

  const refreshFinanceHistory = async ({ page = historyPage } = {}) => {
    const result = await getStudentFinanceTransactions(studentId, {
      limit: historyPageSize,
      offset: page * historyPageSize,
      dateFrom: historyDateFrom || null,
      dateTo: historyDateTo || null,
    });

    if (result.error) throw result.error;

    setFinanceTransactions(result.data ?? []);
    setHistoryTotal(result.count ?? 0);
  };

  const resetPaymentForm = () => {
    setEditingPaymentId("");
    setPaymentAmount("");
    setPaymentCurrency(activeBillingCurrency);
    setPaymentAccountId("");
    setPaymentDate(getLocalDateString());
    setPaymentDescription("");
    setPaymentError("");
    paymentAttemptRef.current = { signature: "", requestId: "" };
  };

  const handleEditPayment = (transaction) => {
    if (
      transaction.transaction_type !== "payment" ||
      !transaction.payment ||
      transaction.payment.provider !== "manual" ||
      transaction.payment.status !== "succeeded"
    ) {
      return;
    }

    setEditingPaymentId(transaction.payment.id);
    setPaymentAmount(minorToPaymentInputValue(transaction.amount_minor));
    setPaymentCurrency(transaction.currency);
    setPaymentAccountId(transaction.payment.payment_account_id ?? "");
    setPaymentDate(toLocalDateInputValue(transaction.payment.paid_at));
    setPaymentDescription(transaction.payment.description ?? "");
    setPaymentError("");
    setPaymentSuccess("");
    paymentAttemptRef.current = { signature: "", requestId: "" };
  };

  const resetPaymentAction = () => {
    setPaymentAction(null);
    setPaymentActionError("");
    setCancelReasonCode("duplicate");
    setCancelReasonNote("");
    setTransferStudentId("");
    setTransferReasonCode("wrong_student");
    setTransferReasonNote("");
    setPaymentActionRequestId("");
  };

  const openPaymentCancellation = (transaction) => {
    setPaymentAction({ mode: "cancel", transaction });
    setPaymentActionError("");
    setPaymentActionSuccess("");
    setCancelReasonCode("duplicate");
    setCancelReasonNote("");
    setPaymentActionRequestId("");
  };

  const openPaymentTransfer = (transaction) => {
    setPaymentAction({ mode: "transfer", transaction });
    setPaymentActionError("");
    setPaymentActionSuccess("");
    setTransferStudentId(transferCandidates[0]?.student_id ?? "");
    setTransferReasonCode("wrong_student");
    setTransferReasonNote("");
    setPaymentActionRequestId(createClientRequestId());
  };

  const refreshFinanceAfterPaymentAction = async () => {
    const overviewResult = await getStudentFinanceOverview(studentId);
    if (overviewResult.error) throw overviewResult.error;

    setFinanceOverview(overviewResult.data);
    await refreshFinanceHistory({ page: historyPage });
  };

  const handleCancelPayment = async () => {
    const transaction = paymentAction?.transaction;
    if (!transaction?.payment?.id) return;

    if (cancelReasonCode === "other" && !cancelReasonNote.trim()) {
      setPaymentActionError(
        t("teacherStudentDetails.finance.errors.paymentActionReasonRequired"),
      );
      return;
    }

    try {
      setPaymentActionSaving(true);
      setPaymentActionError("");
      setPaymentActionSuccess("");

      const { error } = await cancelManualStudentPayment({
        paymentId: transaction.payment.id,
        reasonCode: cancelReasonCode,
        reasonNote: cancelReasonNote.trim(),
      });

      if (error) throw error;

      await refreshFinanceAfterPaymentAction();
      resetPaymentAction();
      setPaymentActionSuccess(
        t("teacherStudentDetails.finance.messages.paymentCancelled"),
      );
    } catch (error) {
      console.error("Manual payment cancellation error:", error);
      setPaymentActionError(getPaymentActionError(error, t));
    } finally {
      setPaymentActionSaving(false);
    }
  };

  const handleTransferPayment = async () => {
    const transaction = paymentAction?.transaction;
    if (!transaction?.payment?.id) return;

    if (!transferStudentId) {
      setPaymentActionError(
        t("teacherStudentDetails.finance.errors.transferStudentRequired"),
      );
      return;
    }

    if (transferReasonCode === "other" && !transferReasonNote.trim()) {
      setPaymentActionError(
        t("teacherStudentDetails.finance.errors.paymentActionReasonRequired"),
      );
      return;
    }

    try {
      setPaymentActionSaving(true);
      setPaymentActionError("");
      setPaymentActionSuccess("");

      const { error } = await transferManualStudentPayment({
        paymentId: transaction.payment.id,
        targetStudentId: transferStudentId,
        reasonCode: transferReasonCode,
        reasonNote: transferReasonNote.trim(),
        clientRequestId: paymentActionRequestId || createClientRequestId(),
      });

      if (error) throw error;

      await refreshFinanceAfterPaymentAction();
      resetPaymentAction();
      setPaymentActionSuccess(
        t("teacherStudentDetails.finance.messages.paymentTransferred"),
      );
    } catch (error) {
      console.error("Manual payment transfer error:", error);
      setPaymentActionError(getPaymentActionError(error, t));
    } finally {
      setPaymentActionSaving(false);
    }
  };

  const handleFinanceSubmit = async (event) => {
    event.preventDefault();

    setFinanceSaveError("");
    setFinanceSuccess("");

    if (!lessonRate) {
      setFinanceSaveError(
        t("teacherStudentDetails.finance.errors.rateRequired"),
      );
      return;
    }

    if (!lessonRateIsValid) {
      setFinanceSaveError(
        t("teacherStudentDetails.finance.errors.invalidRate"),
      );
      return;
    }

    const numericRate = Number(lessonRate);

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
        amountMinor: numericRate * MINOR_UNIT_FACTOR,
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

    const normalizedDescription = paymentDescription.trim();

    if (!paymentAmountIsValid) {
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

    const amountMinor = paymentAmountMinor;
    const paymentMethod =
      selectedPaymentAccount.account_type === "cash"
        ? "cash"
        : "bank_transfer";
    const paidAt = localDateToNoonIso(paymentDate);
    const signature = JSON.stringify({
      editingPaymentId: editingPaymentId || null,
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

      const paymentMutation = isEditingPayment
        ? correctManualStudentPayment({
            paymentId: editingPaymentId,
            amountMinor,
            currency: paymentCurrency,
            paymentAccountId: selectedPaymentAccount.id,
            paymentMethod,
            description: normalizedDescription,
            paidAt,
            clientRequestId: paymentAttemptRef.current.requestId,
          })
        : recordManualStudentPayment({
            studentId,
            amountMinor,
            currency: paymentCurrency,
            paymentAccountId: selectedPaymentAccount.id,
            paymentMethod,
            description: normalizedDescription,
            paidAt,
            clientRequestId: paymentAttemptRef.current.requestId,
          });

      const { data: paymentResult, error } = await paymentMutation;

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

      const overviewResult = await getStudentFinanceOverview(studentId);

      if (overviewResult.error) throw overviewResult.error;

      setFinanceOverview(overviewResult.data);
      await refreshFinanceHistory({ page: 0 });
      setHistoryPage(0);

      const wasEditing = isEditingPayment;
      resetPaymentForm();
      setPaymentSuccess(
        taxPending
          ? t(
              wasEditing
                ? "teacherStudentDetails.finance.messages.paymentUpdatedTaxPending"
                : "teacherStudentDetails.finance.messages.paymentSavedTaxPending",
            )
          : t(
              wasEditing
                ? "teacherStudentDetails.finance.messages.paymentUpdated"
                : "teacherStudentDetails.finance.messages.paymentSaved",
            ),
      );
    } catch (error) {
      console.error("Manual payment error:", error);
      setPaymentError(getPaymentError(error, t));
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleTaxRetry = async (paymentId) => {
    setTaxResolveError("");

    try {
      setTaxRetryingPaymentId(paymentId);

      const { error } = await resolvePaymentTax(paymentId);

      if (error) throw error;

      await refreshFinanceHistory();
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
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={lessonRate}
                        onChange={(event) => {
                          setLessonRate(sanitizePositiveIntegerInput(event.target.value));
                          setFinanceSaveError("");
                          setFinanceSuccess("");
                        }}
                        placeholder="0"
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
                    disabled={
                      financeSaving ||
                      !lessonRateIsValid ||
                      !rateEffectiveFrom ||
                      rateEffectiveFrom < today
                    }
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
                      <h3>
                        {t(
                          isEditingPayment
                            ? "teacherStudentDetails.finance.editPayment"
                            : "teacherStudentDetails.finance.addPayment",
                        )}
                      </h3>
                      <p>
                        {t(
                          isEditingPayment
                            ? "teacherStudentDetails.finance.editPaymentHint"
                            : "teacherStudentDetails.finance.addPaymentHint",
                        )}
                      </p>
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
                              setPaymentAmount(sanitizeMoneyInput(event.target.value));
                              setPaymentError("");
                              setPaymentSuccess("");
                            }}
                            placeholder="0,00"
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
                        })}{" "}
                        <Link to="/teacher-dashboard/settings#payment-accounts">
                          {t("teacherStudentDetails.finance.managePaymentAccounts")}
                        </Link>
                      </p>
                    )}

                    {paymentError && <p className={styles.error}>{paymentError}</p>}
                    {paymentSuccess && (
                      <p className={styles.success}>{paymentSuccess}</p>
                    )}

                    <div className={styles.financeActions}>
                      {isEditingPayment && (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => {
                            resetPaymentForm();
                            setPaymentSuccess("");
                          }}
                          disabled={paymentSaving}
                        >
                          {t("teacherStudentDetails.finance.cancelPaymentEdit")}
                        </button>
                      )}

                      <button
                        type="submit"
                        className={styles.primaryButton}
                        disabled={
                          paymentSaving ||
                          !paymentAmountIsValid ||
                          !selectedPaymentAccount ||
                          !paymentDate ||
                          paymentDate > today
                        }
                      >
                        {paymentSaving
                          ? t(
                              isEditingPayment
                                ? "teacherStudentDetails.finance.savingPaymentChanges"
                                : "teacherStudentDetails.finance.savingPayment",
                            )
                          : t(
                              isEditingPayment
                                ? "teacherStudentDetails.finance.savePaymentChanges"
                                : "teacherStudentDetails.finance.savePayment",
                            )}
                      </button>
                    </div>
                  </form>
                </section>

              </div>

              <section
                ref={historySectionRef}
                className={`${styles.financeSubsection} ${styles.historySection}`}
              >
                <div className={styles.subsectionHeader}>
                  <div>
                    <h3>{t("teacherStudentDetails.finance.history")}</h3>
                    <p>{t("teacherStudentDetails.finance.historyHint")}</p>
                  </div>
                </div>

                <div className={styles.historyFilters}>
                  <label className={styles.field}>
                    <span>{t("teacherStudentDetails.finance.historyFrom")}</span>
                    <input
                      type="date"
                      value={historyDateFrom}
                      max={historyDateTo}
                      onChange={(event) => {
                        setHistoryDateFrom(event.target.value);
                        setHistoryPage(0);
                      }}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>{t("teacherStudentDetails.finance.historyTo")}</span>
                    <input
                      type="date"
                      value={historyDateTo}
                      min={historyDateFrom}
                      max={today}
                      onChange={(event) => {
                        setHistoryDateTo(event.target.value);
                        setHistoryPage(0);
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      setHistoryDateFrom(
                        getLocalDateDaysAgo(DEFAULT_FINANCE_HISTORY_DAYS - 1),
                      );
                      setHistoryDateTo(getLocalDateString());
                      setHistoryPage(0);
                    }}
                  >
                    {t("teacherStudentDetails.finance.historyReset")}
                  </button>
                </div>

                {taxResolveError && (
                  <p className={styles.error}>{taxResolveError}</p>
                )}

                {historyError ? (
                  <p className={styles.error}>{historyError}</p>
                ) : historyLoading ? (
                  <p className={styles.rateMeta}>{t("common.loading")}</p>
                ) : financeTransactions.length === 0 ? (
                  <p className={styles.rateMeta}>
                    {t("teacherStudentDetails.finance.historyEmpty")}
                  </p>
                ) : (
                  <>
                  {paymentActionSuccess && (
                    <p className={styles.success}>{paymentActionSuccess}</p>
                  )}
                  {paymentActionError && (
                    <p className={styles.error}>{paymentActionError}</p>
                  )}

                  <div className={styles.transactionList}>
                    {transactionDisplayGroups.map((group) => (
                      <div
                        key={group.key}
                        className={`${styles.transactionGroup} ${
                          group.related ? styles.transactionGroupRelated : ""
                        }`}
                      >
                        {group.transactions.map((transaction) => {
                          const primaryRelation = getPrimaryTransactionRelation(
                            transaction,
                          );
                          const isActiveManualPayment =
                            transaction.transaction_type === "payment" &&
                            transaction.payment?.provider === "manual" &&
                            transaction.payment?.status === "succeeded";
                          const isPaymentActionOpen =
                            paymentAction?.transaction?.id === transaction.id;

                          return (
                            <div
                              key={transaction.id}
                              className={styles.transactionRow}
                            >
                              <div className={styles.transactionInfo}>
                                <strong>
                                  {t(
                                    `teacherStudentDetails.finance.transactionTypes.${transaction.transaction_type}`,
                                  )}
                                </strong>
                                <span>{formatDateTime(transaction.display_at ?? transaction.created_at)}</span>

                                {transaction.transaction_type === "lesson_charge" &&
                                  transaction.created_at && (
                                    <small>
                                      {t("teacherStudentDetails.finance.lessonChargeRecordedAt", {
                                        date: formatDateTime(transaction.created_at),
                                      })}
                                    </small>
                                  )}

                                {transaction.paymentAccount && (
                                  <span>
                                    {transaction.paymentAccount.name} · {t(
                                      `teacherStudentDetails.finance.methods.${transaction.payment?.payment_method}`,
                                    )}
                                  </span>
                                )}

                                {transaction.transaction_type === "payment" &&
                                  transaction.payment?.paid_at &&
                                  transaction.display_date !==
                                    transaction.effective_date && (
                                    <small>
                                      {t("teacherStudentDetails.finance.paymentEffectiveDate", {
                                        date: formatDate(transaction.payment.paid_at),
                                      })}
                                    </small>
                                  )}

                                {transaction.description && (
                                  <small>{transaction.description}</small>
                                )}

                                {primaryRelation && (
                                  <small className={styles.correctedPaymentLabel}>
                                    {getTransactionRelationLabel(
                                      primaryRelation,
                                      transaction,
                                      t,
                                    )}
                                  </small>
                                )}

                                {isActiveManualPayment && (
                                  <div className={styles.transactionActions}>
                                    <button
                                      type="button"
                                      className={styles.inlineButton}
                                      onClick={() => {
                                        resetPaymentAction();
                                        handleEditPayment(transaction);
                                      }}
                                      disabled={paymentSaving || paymentActionSaving || isEditingPayment}
                                    >
                                      {t("teacherStudentDetails.finance.editPaymentAction")}
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.inlineButton}
                                      onClick={() => openPaymentTransfer(transaction)}
                                      disabled={paymentSaving || paymentActionSaving || isEditingPayment}
                                    >
                                      {t("teacherStudentDetails.finance.transferPaymentAction")}
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.inlineButton} ${styles.dangerInlineButton}`}
                                      onClick={() => openPaymentCancellation(transaction)}
                                      disabled={paymentSaving || paymentActionSaving || isEditingPayment}
                                    >
                                      {t("teacherStudentDetails.finance.cancelPaymentAction")}
                                    </button>
                                  </div>
                                )}

                                {isPaymentActionOpen && paymentAction?.mode === "cancel" && (
                                  <div className={styles.paymentActionPanel}>
                                    <strong>
                                      {t("teacherStudentDetails.finance.cancelPaymentTitle")}
                                    </strong>
                                    <p>
                                      {t("teacherStudentDetails.finance.cancelPaymentConfirm", {
                                        amount: formatMoney(
                                          transaction.amount_minor,
                                          transaction.currency,
                                        ),
                                      })}
                                    </p>
                                    <label className={styles.field}>
                                      <span>
                                        {t("teacherStudentDetails.finance.paymentActionReason")}
                                      </span>
                                      <select
                                        value={cancelReasonCode}
                                        onChange={(event) => {
                                          setCancelReasonCode(event.target.value);
                                          setPaymentActionError("");
                                        }}
                                        disabled={paymentActionSaving}
                                      >
                                        {["duplicate", "not_received", "entry_error", "other"].map(
                                          (reason) => (
                                            <option key={reason} value={reason}>
                                              {t(
                                                `teacherStudentDetails.finance.paymentCancellationReasons.${reason}`,
                                              )}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </label>
                                    <label className={styles.field}>
                                      <span>
                                        {t("teacherStudentDetails.finance.paymentActionNote")}
                                      </span>
                                      <textarea
                                        value={cancelReasonNote}
                                        onChange={(event) => {
                                          setCancelReasonNote(event.target.value);
                                          setPaymentActionError("");
                                        }}
                                        maxLength={500}
                                        rows={2}
                                        disabled={paymentActionSaving}
                                      />
                                    </label>
                                    <div className={styles.financeActions}>
                                      <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={resetPaymentAction}
                                        disabled={paymentActionSaving}
                                      >
                                        {t("common.cancel")}
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.dangerButton}
                                        onClick={handleCancelPayment}
                                        disabled={
                                          paymentActionSaving ||
                                          (cancelReasonCode === "other" &&
                                            !cancelReasonNote.trim())
                                        }
                                      >
                                        {paymentActionSaving
                                          ? t("teacherStudentDetails.finance.paymentActionSaving")
                                          : t("teacherStudentDetails.finance.confirmCancelPayment")}
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {isPaymentActionOpen && paymentAction?.mode === "transfer" && (
                                  <div className={styles.paymentActionPanel}>
                                    <strong>
                                      {t("teacherStudentDetails.finance.transferPaymentTitle")}
                                    </strong>
                                    <p>
                                      {t("teacherStudentDetails.finance.transferPaymentHint", {
                                        amount: formatMoney(
                                          transaction.amount_minor,
                                          transaction.currency,
                                        ),
                                      })}
                                    </p>
                                    <label className={styles.field}>
                                      <span>
                                        {t("teacherStudentDetails.finance.transferPaymentStudent")}
                                      </span>
                                      <select
                                        value={transferStudentId}
                                        onChange={(event) => {
                                          setTransferStudentId(event.target.value);
                                          setPaymentActionError("");
                                        }}
                                        disabled={paymentActionSaving}
                                      >
                                        {transferCandidates.length === 0 ? (
                                          <option value="">
                                            {t(
                                              "teacherStudentDetails.finance.noTransferStudents",
                                            )}
                                          </option>
                                        ) : (
                                          transferCandidates.map((candidate) => (
                                            <option
                                              key={candidate.student_id}
                                              value={candidate.student_id}
                                            >
                                              {candidate.student_name ||
                                                candidate.student_email}
                                            </option>
                                          ))
                                        )}
                                      </select>
                                    </label>
                                    <label className={styles.field}>
                                      <span>
                                        {t("teacherStudentDetails.finance.paymentActionReason")}
                                      </span>
                                      <select
                                        value={transferReasonCode}
                                        onChange={(event) => {
                                          setTransferReasonCode(event.target.value);
                                          setPaymentActionError("");
                                        }}
                                        disabled={paymentActionSaving}
                                      >
                                        {["wrong_student", "other"].map((reason) => (
                                          <option key={reason} value={reason}>
                                            {t(
                                              `teacherStudentDetails.finance.paymentTransferReasons.${reason}`,
                                            )}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className={styles.field}>
                                      <span>
                                        {t("teacherStudentDetails.finance.paymentActionNote")}
                                      </span>
                                      <textarea
                                        value={transferReasonNote}
                                        onChange={(event) => {
                                          setTransferReasonNote(event.target.value);
                                          setPaymentActionError("");
                                        }}
                                        maxLength={500}
                                        rows={2}
                                        disabled={paymentActionSaving}
                                      />
                                    </label>
                                    <div className={styles.financeActions}>
                                      <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={resetPaymentAction}
                                        disabled={paymentActionSaving}
                                      >
                                        {t("common.cancel")}
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.primaryButton}
                                        onClick={handleTransferPayment}
                                        disabled={
                                          paymentActionSaving ||
                                          !transferStudentId ||
                                          (transferReasonCode === "other" &&
                                            !transferReasonNote.trim())
                                        }
                                      >
                                        {paymentActionSaving
                                          ? t("teacherStudentDetails.finance.paymentActionSaving")
                                          : t("teacherStudentDetails.finance.confirmTransferPayment")}
                                      </button>
                                    </div>
                                  </div>
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
                                            {t(
                                              "teacherStudentDetails.finance.tax.totalIncomeTaxes",
                                            )}: {formatMoney(
                                              transaction.taxAccrual.total_income_taxes_minor,
                                              "UAH",
                                            )}
                                          </strong>
                                        ) : (
                                          <span>
                                            {t(
                                              "teacherStudentDetails.finance.tax.monthlyProfileNote",
                                            )}
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
                                          onClick={() =>
                                            handleTaxRetry(transaction.payment_id)
                                          }
                                          disabled={
                                            taxRetryingPaymentId === transaction.payment_id
                                          }
                                        >
                                          {taxRetryingPaymentId === transaction.payment_id
                                            ? t(
                                                "teacherStudentDetails.finance.tax.retrying",
                                              )
                                            : t(
                                                "teacherStudentDetails.finance.tax.retry",
                                              )}
                                        </button>
                                      </>
                                    ) : (
                                      <span>
                                        {t(
                                          "teacherStudentDetails.finance.tax.parametersMissing",
                                        )}
                                      </span>
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
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <div className={styles.historyPagination}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleHistoryPageChange(Math.max(0, historyPage - 1))}
                      disabled={historyPage === 0 || historyLoading}
                    >
                      {t("teacherStudentDetails.finance.historyPrevious")}
                    </button>

                    <span>
                      {t("teacherStudentDetails.finance.historyPage", {
                        current: historyPage + 1,
                        total: historyPageCount,
                        count: historyTotal,
                      })}
                    </span>

                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() =>
                        handleHistoryPageChange(
                          Math.min(historyPageCount - 1, historyPage + 1),
                        )
                      }
                      disabled={
                        historyPage >= historyPageCount - 1 || historyLoading
                      }
                    >
                      {t("teacherStudentDetails.finance.historyNext")}
                    </button>
                  </div>
                  </>
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

  return Number.isInteger(amount) ? String(amount) : "";
};

const minorToPaymentInputValue = (amountMinor) => {
  const amount = Number(amountMinor) / MINOR_UNIT_FACTOR;

  return Number.isInteger(amount)
    ? String(amount)
    : amount.toFixed(2).replace(".", ",");
};

const sanitizePositiveIntegerInput = (value) => value.replace(/\D/g, "");

const sanitizeMoneyInput = (value) => {
  const normalized = value.replace(".", ",").replace(/[^\d,]/g, "");
  const [integerPart = "", ...fractionParts] = normalized.split(",");

  if (fractionParts.length === 0) return integerPart;

  const fraction = fractionParts.join("").slice(0, 2);
  return `${integerPart},${fraction}`;
};

const isPositiveIntegerInput = (value) => /^[1-9]\d*$/.test(value);

const parseMoneyInputToMinor = (value) => {
  const normalized = value.trim().replace(",", ".");

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;

  const [whole, fraction = ""] = normalized.split(".");
  const amountMinor =
    Number(whole) * MINOR_UNIT_FACTOR + Number(fraction.padEnd(2, "0"));

  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
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

const getLocalDateDaysAgo = (daysAgo) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const toLocalDateInputValue = (dateString) => {
  if (!dateString) return getLocalDateString();

  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

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

const getPrimaryTransactionRelation = (transaction) => {
  const relations = transaction?.relations ?? [];

  if (relations.length === 0) return null;

  return [...relations].sort(
    (left, right) =>
      new Date(right.relation_created_at).getTime() -
      new Date(left.relation_created_at).getTime(),
  )[0];
};

const buildTransactionDisplayGroups = (transactions) => {
  const transactionsById = Object.fromEntries(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const genericReversalGroupByTransactionId = new Map();

  transactions.forEach((transaction) => {
    if (
      transaction.transaction_type !== "reversal" ||
      getPrimaryTransactionRelation(transaction) ||
      !transaction.reversal_of_id
    ) {
      return;
    }

    const original = transactionsById[transaction.reversal_of_id];

    if (
      original &&
      !getPrimaryTransactionRelation(original) &&
      original.display_date === transaction.display_date
    ) {
      const groupKey = `reversal:${original.id}:${transaction.display_date}`;
      genericReversalGroupByTransactionId.set(original.id, groupKey);
      genericReversalGroupByTransactionId.set(transaction.id, groupKey);
    }
  });

  const groups = new Map();

  transactions.forEach((transaction) => {
    const relation = getPrimaryTransactionRelation(transaction);
    const displayDate = transaction.display_date ?? "";
    const genericReversalGroup = genericReversalGroupByTransactionId.get(
      transaction.id,
    );
    const key = relation
      ? `${relation.relation_id}:${displayDate}`
      : genericReversalGroup ?? `transaction:${transaction.id}`;
    const displayAt = new Date(
      transaction.display_at ?? transaction.created_at,
    ).getTime();

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        related: Boolean(relation || genericReversalGroup),
        displayDate,
        sortAt: displayAt,
        transactions: [],
      });
    }

    const group = groups.get(key);
    group.sortAt = Math.max(group.sortAt, displayAt);
    group.transactions.push(transaction);
  });

  const roleOrder = {
    original: 1,
    reversal: 2,
    replacement: 3,
  };

  const displayGroups = [...groups.values()].map((group) => ({
    ...group,
    transactions: [...group.transactions].sort((left, right) => {
      const leftDisplayAt = new Date(
        left.display_at ?? left.created_at,
      ).getTime();
      const rightDisplayAt = new Date(
        right.display_at ?? right.created_at,
      ).getTime();
      const timeDifference = rightDisplayAt - leftDisplayAt;

      // Keep the same newest-first chronology inside a related block that we
      // use for the blocks themselves. Grouping should not make an older
      // original transaction appear above a newer correction/reversal.
      if (timeDifference !== 0) return timeDifference;

      const leftRelation = getPrimaryTransactionRelation(left);
      const rightRelation = getPrimaryTransactionRelation(right);

      if (
        leftRelation &&
        rightRelation &&
        leftRelation.relation_id === rightRelation.relation_id
      ) {
        // PostgreSQL now() is transaction-scoped, so correction rows created
        // by one RPC can have exactly the same timestamp. In that case show
        // the newest logical state first: replacement -> reversal -> original.
        const roleDifference =
          (roleOrder[rightRelation.relation_role] ?? 0) -
          (roleOrder[leftRelation.relation_role] ?? 0);

        if (roleDifference !== 0) return roleDifference;
      }

      if (left.id === right.reversal_of_id) return 1;
      if (right.id === left.reversal_of_id) return -1;

      return 0;
    }),
  }));

  return sortFinanceOperationsNewestFirst(displayGroups, {
    dateField: "displayDate",
    createdAtField: "sortAt",
    idField: "key",
  });
};

const getStudentRelationName = (student) =>
  student?.full_name || student?.email || "—";

const getTransactionRelationLabel = (relation, transaction, t) => {
  if (!relation) return "";

  const source = getStudentRelationName(relation.sourceStudent);
  const target = getStudentRelationName(relation.targetStudent);
  const label = t(
    `teacherStudentDetails.finance.relationLabels.${relation.relation_type}.${relation.relation_role}`,
    { source, target },
  );

  if (
    relation.relation_type === "cancellation" &&
    relation.reason_code
  ) {
    return `${label} · ${t(
      `teacherStudentDetails.finance.paymentCancellationReasons.${relation.reason_code}`,
    )}`;
  }

  if (relation.relation_type === "transfer" && relation.reason_code) {
    return `${label} · ${t(
      `teacherStudentDetails.finance.paymentTransferReasons.${relation.reason_code}`,
    )}`;
  }

  if (
    transaction.transaction_type === "payment" &&
    relation.relation_type === "correction" &&
    relation.relation_role === "original"
  ) {
    return t("teacherStudentDetails.finance.paymentCorrected");
  }

  return label;
};

const getPaymentActionError = (error, t) => {
  const message = error?.message ?? "";

  if (
    message.includes("PAYMENT_NOT_EDITABLE") ||
    message.includes("PAYMENT_ALREADY_REVERSED") ||
    message.includes("PAYMENT_ALREADY_TRANSFERRED")
  ) {
    return t("teacherStudentDetails.finance.errors.paymentNotEditable");
  }

  if (message.includes("TARGET_STUDENT_NOT_ASSIGNED")) {
    return t("teacherStudentDetails.finance.errors.transferStudentNotAssigned");
  }

  if (message.includes("PAYMENT_TRANSFER_SAME_STUDENT")) {
    return t("teacherStudentDetails.finance.errors.transferSameStudent");
  }

  if (
    message.includes("PAYMENT_CANCELLATION_NOTE_REQUIRED") ||
    message.includes("PAYMENT_TRANSFER_NOTE_REQUIRED")
  ) {
    return t("teacherStudentDetails.finance.errors.paymentActionReasonRequired");
  }

  if (message.includes("PAYMENT_REQUEST_ID_CONFLICT")) {
    return t("teacherStudentDetails.finance.errors.paymentRequestConflict");
  }

  return t("teacherStudentDetails.finance.errors.paymentActionFailed");
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

  if (message.includes("FUTURE_PAYMENT_DATE_NOT_ALLOWED")) {
    return t("teacherStudentDetails.finance.errors.futurePaymentDate");
  }

  if (message.includes("PAYMENT_UNCHANGED")) {
    return t("teacherStudentDetails.finance.errors.paymentUnchanged");
  }

  if (
    message.includes("PAYMENT_NOT_EDITABLE") ||
    message.includes("PAYMENT_ALREADY_CORRECTED") ||
    message.includes("PAYMENT_ALREADY_REVERSED")
  ) {
    return t("teacherStudentDetails.finance.errors.paymentNotEditable");
  }

  if (message.includes("PE_TAX_PROFILE_REQUIRED_FOR_PAYMENT")) {
    return t("teacherStudentDetails.finance.errors.peTaxProfileRequired");
  }

  if (message.includes("STUDENT_NOT_ASSIGNED")) {
    return t("teacherStudentDetails.finance.errors.studentNotAssigned");
  }

  return t("teacherStudentDetails.finance.errors.paymentSave");
};

export default TeacherStudentDetails;
