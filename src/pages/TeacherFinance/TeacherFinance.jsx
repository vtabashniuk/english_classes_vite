import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  FINANCE_CURRENCIES,
  getMyCurrentTaxProfile,
  getMyTaxParameterOverrides,
  getMyTaxParameters,
  getMyTaxProfiles,
  getTeacherFinanceReceipts,
  getTeacherMonthlyTaxSummary,
  getTeacherStudentFinanceHealth,
} from "../../features/finance/api/financeApi";
import { getMyTeacherScheduleSettings } from "../../features/settings/api/teacherSettingsApi";
import { formatFinanceMoney, formatPercentValue } from "../../utils/formatFinanceMoney";

import styles from "./TeacherFinance.module.css";


const TeacherFinance = () => {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const initialToday = getBrowserDateString();
  const initialMonthRange = getMonthRange(initialToday);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [teacherToday, setTeacherToday] = useState(initialToday);
  const [lowBalanceThresholdLessons, setLowBalanceThresholdLessons] = useState(2);

  const [currentTaxProfile, setCurrentTaxProfile] = useState(null);
  const [taxProfiles, setTaxProfiles] = useState([]);
  const [currentParameters, setCurrentParameters] = useState([]);
  const [parameterOverrides, setParameterOverrides] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [studentFinanceHealth, setStudentFinanceHealth] = useState([]);

  const [receiptFrom, setReceiptFrom] = useState(initialMonthRange.start);
  const [receiptTo, setReceiptTo] = useState(initialMonthRange.end);
  const [receipts, setReceipts] = useState([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState("");
  const [receiptGroupMode, setReceiptGroupMode] = useState("students");

  const [taxViewMode, setTaxViewMode] = useState("quarter");
  const [taxPeriodDate, setTaxPeriodDate] = useState(initialToday);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setLoadError("");

        const scheduleResult = await getMyTeacherScheduleSettings();
        if (scheduleResult.error) throw scheduleResult.error;

        const timezone = scheduleResult.data?.schedule_timezone || "Europe/Kyiv";
        const today = getDateInTimeZone(timezone);
        const monthRange = getMonthRange(today);

        const [
          currentProfileResult,
          profilesResult,
          parametersResult,
          overridesResult,
          summaryResult,
          receiptsResult,
          healthResult,
        ] = await Promise.all([
          getMyCurrentTaxProfile(),
          getMyTaxProfiles(),
          getMyTaxParameters(today),
          getMyTaxParameterOverrides(),
          getTeacherMonthlyTaxSummary(),
          getTeacherFinanceReceipts({
            dateFrom: monthRange.start,
            dateTo: monthRange.end,
          }),
          getTeacherStudentFinanceHealth(),
        ]);

        const error =
          currentProfileResult.error ||
          profilesResult.error ||
          parametersResult.error ||
          overridesResult.error ||
          summaryResult.error ||
          receiptsResult.error ||
          healthResult.error;

        if (error) throw error;

        setTeacherToday(today);
        setLowBalanceThresholdLessons(
          Number(scheduleResult.data?.low_balance_threshold_lessons ?? 2),
        );
        setReceiptFrom(monthRange.start);
        setReceiptTo(monthRange.end);
        setTaxPeriodDate(today);
        setCurrentTaxProfile(currentProfileResult.data ?? null);
        setTaxProfiles(profilesResult.data ?? []);
        setCurrentParameters(parametersResult.data ?? []);
        setParameterOverrides(overridesResult.data ?? []);
        setMonthlySummary(summaryResult.data ?? []);
        setReceipts(receiptsResult.data ?? []);
        setStudentFinanceHealth(healthResult.data ?? []);
      } catch (error) {
        console.error("Load teacher finance dashboard error:", error);
        setLoadError(t("teacherFinance.loadError"));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [t]);

  const scheduledTaxProfiles = useMemo(
    () =>
      taxProfiles
        .filter((profile) => profile.effective_from > teacherToday)
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from)),
    [taxProfiles, teacherToday],
  );

  const scheduledParameterOverrides = useMemo(
    () =>
      parameterOverrides
        .filter((item) => item.effective_from > teacherToday)
        .sort((a, b) => {
          const dateCompare = a.effective_from.localeCompare(b.effective_from);
          return dateCompare || a.code.localeCompare(b.code);
        }),
    [parameterOverrides, teacherToday],
  );

  const parameterMap = useMemo(
    () => Object.fromEntries(currentParameters.map((item) => [item.code, item])),
    [currentParameters],
  );

  const receiptTotals = useMemo(() => sumReceiptsByCurrency(receipts), [receipts]);
  const paidStudentCount = useMemo(
    () => new Set(receipts.map((item) => item.student_id)).size,
    [receipts],
  );

  const periodNetIncome = useMemo(
    () =>
      receipts.reduce(
        (total, item) =>
          item.profitability_status === "ready" && item.net_income_uah_minor != null
            ? total + Number(item.net_income_uah_minor)
            : total,
        0,
      ),
    [receipts],
  );

  const profitabilityPending = useMemo(
    () => receipts.some((item) => item.profitability_status !== "ready"),
    [receipts],
  );

  const debtors = useMemo(
    () =>
      studentFinanceHealth
        .filter((item) => Number(item.debt_minor ?? 0) > 0)
        .sort((a, b) => {
          const lessonsCompare =
            Number(b.unpaid_lesson_count ?? 0) - Number(a.unpaid_lesson_count ?? 0);
          return lessonsCompare || (a.student_name || "").localeCompare(b.student_name || "");
        }),
    [studentFinanceHealth],
  );

  const lowBalanceStudents = useMemo(
    () =>
      studentFinanceHealth
        .filter((item) => {
          const balance = Number(item.balance_minor ?? 0);
          const remaining = item.remaining_lesson_count;
          return (
            item.billing_currency &&
            balance >= 0 &&
            (balance > 0 || Number(item.priced_upcoming_lessons ?? 0) > 0) &&
            remaining != null &&
            Number(remaining) <= lowBalanceThresholdLessons
          );
        })
        .sort((a, b) => {
          const remainingCompare =
            Number(a.remaining_lesson_count ?? 0) - Number(b.remaining_lesson_count ?? 0);
          return remainingCompare || (a.student_name || "").localeCompare(b.student_name || "");
        }),
    [studentFinanceHealth, lowBalanceThresholdLessons],
  );

  const receiptGroups = useMemo(
    () =>
      groupReceipts(
        receipts,
        receiptGroupMode,
        (account) => formatAccountMeta(account, t),
      ),
    [receipts, receiptGroupMode, t],
  );

  const taxPeriodRange = useMemo(
    () =>
      taxViewMode === "quarter"
        ? getQuarterRange(taxPeriodDate)
        : getMonthRange(taxPeriodDate),
    [taxPeriodDate, taxViewMode],
  );

  const selectedTaxRows = useMemo(
    () =>
      monthlySummary
        .filter(
          (row) =>
            row.month_start >= taxPeriodRange.start &&
            row.month_start <= taxPeriodRange.end,
        )
        .sort((a, b) => a.month_start.localeCompare(b.month_start)),
    [monthlySummary, taxPeriodRange],
  );

  const selectedTaxTotals = useMemo(
    () => sumTaxRows(selectedTaxRows),
    [selectedTaxRows],
  );

  const currentTaxRange = useMemo(
    () =>
      taxViewMode === "quarter"
        ? getQuarterRange(teacherToday)
        : getMonthRange(teacherToday),
    [taxViewMode, teacherToday],
  );

  const nextTaxPeriodStart = useMemo(
    () => shiftPeriodStart(taxPeriodRange.start, taxViewMode, 1),
    [taxPeriodRange.start, taxViewMode],
  );

  const canGoNextTaxPeriod = nextTaxPeriodStart <= currentTaxRange.start;
  const peTaxEnabled = currentTaxProfile?.taxpayer_type === "pe";

  const loadReceipts = async (dateFrom, dateTo) => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) return;

    try {
      setReceiptsLoading(true);
      setReceiptsError("");
      const result = await getTeacherFinanceReceipts({ dateFrom, dateTo });
      if (result.error) throw result.error;
      setReceipts(result.data ?? []);
    } catch (error) {
      console.error("Load finance receipts error:", error);
      setReceiptsError(t("teacherFinance.receiptsLoadError"));
    } finally {
      setReceiptsLoading(false);
    }
  };

  const applyReceiptRange = (range) => {
    setReceiptFrom(range.start);
    setReceiptTo(range.end);
    loadReceipts(range.start, range.end);
  };

  const handleReceiptDateChange = (field, value) => {
    const nextFrom = field === "from" ? value : receiptFrom;
    const nextTo = field === "to" ? value : receiptTo;

    if (field === "from") setReceiptFrom(value);
    else setReceiptTo(value);

    if (nextFrom && nextTo && nextFrom > nextTo) {
      setReceiptsError(t("teacherFinance.invalidPeriod"));
      return;
    }

    if (nextFrom && nextTo) {
      loadReceipts(nextFrom, nextTo);
    }
  };

  const shiftTaxPeriod = (direction) => {
    setTaxPeriodDate(
      shiftPeriodStart(taxPeriodRange.start, taxViewMode, direction),
    );
  };

  if (loading) {
    return <div className={styles.state}>{t("teacherFinance.loading")}</div>;
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("teacherFinance.title")}</h1>
          <p>{t("teacherFinance.dashboardDescription")}</p>
        </div>
      </header>

      {loadError && <p className={styles.error}>{loadError}</p>}

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>{t("teacherFinance.receiptsForPeriod")}</span>
          <div className={styles.moneyStack}>
            {renderCurrencyTotals(receiptTotals, language, styles)}
          </div>
          <small>
            {formatDate(receiptFrom)} — {formatDate(receiptTo)}
          </small>
        </article>

        <article className={styles.summaryCard}>
          <span>{t("teacherFinance.studentsPaid")}</span>
          <strong className={styles.largeMetric}>{paidStudentCount}</strong>
          <small>{t("teacherFinance.successfulPayments", { count: receipts.length })}</small>
        </article>

        <article className={styles.summaryCard}>
          <span>{t("teacherFinance.netIncomeForPeriod")}</span>
          <strong className={styles.largeMetric}>
            {receipts.length > 0 && !profitabilityPending
              ? formatFinanceMoney(periodNetIncome, "UAH", language)
              : "—"}
          </strong>
          <small>
            {profitabilityPending
              ? t("teacherFinance.netIncomeFxPending")
              : t("teacherFinance.netIncomeManagementShort")}
          </small>
        </article>

        <article className={styles.summaryCard}>
          <span>{t("teacherFinance.taxAccrued")}</span>
          <strong className={styles.largeMetric}>
            {peTaxEnabled
              ? formatFinanceMoney(selectedTaxTotals.total_tax_minor, "UAH", language)
              : "—"}
          </strong>
          <small>
            {peTaxEnabled
              ? formatTaxPeriodLabel(taxPeriodRange.start, taxViewMode, language, t)
              : t("teacherFinance.notPeShort")}
          </small>
        </article>
      </div>

      <div className={styles.attentionGrid}>
        <section className={styles.attentionCard}>
          <div className={styles.attentionHeader}>
            <div>
              <h2>{t("teacherFinance.debtorsTitle")}</h2>
              <p>{t("teacherFinance.debtorsHint")}</p>
            </div>
            <strong>{debtors.length}</strong>
          </div>

          {debtors.length > 0 ? (
            <div className={styles.attentionList}>
              {debtors.map((item) => (
                <Link
                  key={item.student_id}
                  to={`/teacher-dashboard/students/${item.student_id}`}
                  className={styles.attentionItem}
                >
                  <div>
                    <strong>{item.student_name || item.student_email}</strong>
                    <small>
                      {t("teacherFinance.unpaidLessons", {
                        count: Number(item.unpaid_lesson_count ?? 0),
                      })}
                    </small>
                  </div>
                  <strong className={styles.debtValue}>
                    −{formatFinanceMoney(item.debt_minor, item.billing_currency, language)}
                  </strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>{t("teacherFinance.noDebtors")}</p>
          )}
        </section>

        <section className={styles.attentionCard}>
          <div className={styles.attentionHeader}>
            <div>
              <h2>{t("teacherFinance.lowBalanceTitle")}</h2>
              <p>
                {t("teacherFinance.lowBalanceHint", {
                  count: lowBalanceThresholdLessons,
                })}
              </p>
              <Link
                to="/teacher-dashboard/settings#finance-preferences"
                className={styles.inlineLink}
              >
                {t("teacherFinance.configureLowBalance")}
              </Link>
            </div>
            <strong>{lowBalanceStudents.length}</strong>
          </div>

          {lowBalanceStudents.length > 0 ? (
            <div className={styles.attentionList}>
              {lowBalanceStudents.map((item) => (
                <Link
                  key={item.student_id}
                  to={`/teacher-dashboard/students/${item.student_id}`}
                  className={styles.attentionItem}
                >
                  <div>
                    <strong>{item.student_name || item.student_email}</strong>
                    <small>
                      {t("teacherFinance.balanceForLessons", {
                        count: Number(item.remaining_lesson_count ?? 0),
                      })}
                    </small>
                  </div>
                  <strong>
                    {formatFinanceMoney(
                      item.balance_minor,
                      item.billing_currency,
                      language,
                    )}
                  </strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>{t("teacherFinance.noLowBalance")}</p>
          )}
        </section>
      </div>

      <div className={styles.dashboardGrid}>
        <section className={`${styles.card} ${styles.fullWidthCard}`}>
          <div className={styles.cardHeader}>
            <div>
              <h2>{t("teacherFinance.receiptsTitle")}</h2>
              <p>{t("teacherFinance.receiptsHint")}</p>
            </div>
            <Link className={styles.linkButton} to="/teacher-dashboard/settings#payment-accounts">
              {t("teacherFinance.manageAccounts")}
            </Link>
          </div>

          <div className={styles.periodToolbar}>
            <div className={styles.presetButtons}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => applyReceiptRange(getMonthRange(teacherToday))}
              >
                {t("teacherFinance.currentMonth")}
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => applyReceiptRange(getQuarterRange(teacherToday))}
              >
                {t("teacherFinance.currentQuarter")}
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => applyReceiptRange(getYearRange(teacherToday))}
              >
                {t("teacherFinance.currentYear")}
              </button>
            </div>

            <div className={styles.dateRange}>
              <label>
                <span>{t("teacherFinance.from")}</span>
                <input
                  type="date"
                  value={receiptFrom}
                  onChange={(event) => handleReceiptDateChange("from", event.target.value)}
                />
              </label>
              <label>
                <span>{t("teacherFinance.to")}</span>
                <input
                  type="date"
                  value={receiptTo}
                  onChange={(event) => handleReceiptDateChange("to", event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className={styles.segmentedControl}>
            <button
              type="button"
              className={receiptGroupMode === "students" ? styles.segmentActive : ""}
              onClick={() => setReceiptGroupMode("students")}
            >
              {t("teacherFinance.byStudents")}
            </button>
            <button
              type="button"
              className={receiptGroupMode === "accounts" ? styles.segmentActive : ""}
              onClick={() => setReceiptGroupMode("accounts")}
            >
              {t("teacherFinance.byAccounts")}
            </button>
          </div>

          {receiptGroupMode === "students" && (
            <p className={styles.analyticsNote}>
              {t("teacherFinance.netIncomeManagementHint")}
            </p>
          )}

          {receiptsError && <p className={styles.error}>{receiptsError}</p>}
          {receiptsLoading ? (
            <p className={styles.muted}>{t("teacherFinance.receiptsLoading")}</p>
          ) : receiptGroups.length > 0 ? (
            <div className={styles.receiptGroups}>
              {receiptGroups.map((group) => (
                <details key={group.id} className={styles.receiptGroup}>
                  <summary>
                    <div>
                      <strong>{group.label}</strong>
                      {group.subtitle && <small>{group.subtitle}</small>}
                    </div>
                    <div className={styles.groupSummaryMetrics}>
                      <div className={styles.inlineMoney}>
                        {renderCurrencyTotals(group.totals, language, styles)}
                      </div>
                      {receiptGroupMode === "students" && (
                        <small className={styles.netIncomeLabel}>
                          {group.profitabilityPending
                            ? t("teacherFinance.netIncomePendingShort")
                            : t("teacherFinance.netIncomeStudent", {
                                amount: formatFinanceMoney(
                                  group.netIncomeUahMinor,
                                  "UAH",
                                  language,
                                ),
                              })}
                        </small>
                      )}
                    </div>
                  </summary>
                  <div className={styles.receiptDetails}>
                    {group.items.map((item) => (
                      <div key={item.payment_id} className={styles.receiptItem}>
                        <div>
                          <strong>{formatDate(item.payment_date)}</strong>
                          <small>
                            {receiptGroupMode === "students"
                              ? item.account_name
                              : item.student_name || item.student_email || t("teacherFinance.unknownStudent")}
                          </small>
                        </div>
                        <div className={styles.receiptAmountBlock}>
                          <strong>
                            {formatFinanceMoney(item.amount_minor, item.currency, language)}
                          </strong>
                          {receiptGroupMode === "students" && (
                            <small>
                              {item.profitability_status === "ready" &&
                              item.net_income_uah_minor != null
                                ? t("teacherFinance.paymentNetIncome", {
                                    amount: formatFinanceMoney(
                                      item.net_income_uah_minor,
                                      "UAH",
                                      language,
                                    ),
                                  })
                                : t("teacherFinance.netIncomePendingShort")}
                            </small>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>{t("teacherFinance.noReceipts")}</p>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>{t("teacherFinance.profileTitle")}</h2>
              <p>{t("teacherFinance.profileDashboardHint")}</p>
            </div>
            <Link className={styles.linkButton} to="/teacher-dashboard/settings#tax-profile">
              {t("teacherFinance.editTaxProfile")}
            </Link>
          </div>

          <div className={styles.profileValue}>
            <strong>{formatTaxProfile(currentTaxProfile, t)}</strong>
            {currentTaxProfile?.effective_from && (
              <small>
                {t("teacherFinance.activeFrom", {
                  date: formatDate(currentTaxProfile.effective_from),
                })}
              </small>
            )}
          </div>

          {peTaxEnabled ? (
            <div className={styles.parameterSnapshot}>
              {getVisibleParameterRows(currentTaxProfile, parameterMap).map((item) => (
                <div key={item.code} className={styles.parameterRow}>
                  <span>{formatParameterName(item.code, t)}</span>
                  <strong>{formatResolvedParameter(item.value, language)}</strong>
                </div>
              ))}
              <Link className={styles.inlineLink} to="/teacher-dashboard/settings#tax-parameters">
                {t("teacherFinance.editTaxParameters")}
              </Link>
            </div>
          ) : (
            <p className={styles.info}>{t("teacherFinance.notPe")}</p>
          )}

          <div className={styles.scheduledBlock}>
            <h3>{t("teacherFinance.scheduledChanges")}</h3>
            {scheduledTaxProfiles.length === 0 && scheduledParameterOverrides.length === 0 ? (
              <p className={styles.muted}>{t("teacherFinance.noScheduledChanges")}</p>
            ) : (
              <div className={styles.scheduledList}>
                {scheduledTaxProfiles.map((profile) => (
                  <div key={`profile-${profile.id}`} className={styles.scheduledItem}>
                    <div>
                      <span>{t("teacherFinance.profileChange")}</span>
                      <strong>{formatTaxProfile(profile, t)}</strong>
                    </div>
                    <small>{formatDate(profile.effective_from)}</small>
                  </div>
                ))}
                {scheduledParameterOverrides.map((item) => (
                  <div key={`parameter-${item.id}`} className={styles.scheduledItem}>
                    <div>
                      <span>{formatParameterName(item.code, t)}</span>
                      <strong>{formatParameterOverride(item, language)}</strong>
                    </div>
                    <small>{formatDate(item.effective_from)}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>{t("teacherFinance.taxAccrualsTitle")}</h2>
              <p>{t("teacherFinance.taxAccrualsHint")}</p>
            </div>
          </div>

          {peTaxEnabled ? (
            <>
              <div className={styles.taxControls}>
                <div className={styles.segmentedControl}>
                  <button
                    type="button"
                    className={taxViewMode === "quarter" ? styles.segmentActive : ""}
                    onClick={() => setTaxViewMode("quarter")}
                  >
                    {t("teacherFinance.quarter")}
                  </button>
                  <button
                    type="button"
                    className={taxViewMode === "month" ? styles.segmentActive : ""}
                    onClick={() => setTaxViewMode("month")}
                  >
                    {t("teacherFinance.monthMode")}
                  </button>
                </div>

                <div className={styles.periodNavigation}>
                  <button type="button" className={styles.iconButton} onClick={() => shiftTaxPeriod(-1)}>
                    ←
                  </button>
                  <strong>
                    {formatTaxPeriodLabel(taxPeriodRange.start, taxViewMode, language, t)}
                  </strong>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => shiftTaxPeriod(1)}
                    disabled={!canGoNextTaxPeriod}
                  >
                    →
                  </button>
                </div>
              </div>

              <div className={styles.taxTotalsGrid}>
                <TaxMetric
                  label={t("teacherFinance.income")}
                  value={formatFinanceMoney(selectedTaxTotals.income_base_uah_minor, "UAH", language)}
                />
                <TaxMetric
                  label={t("teacherFinance.singleTax")}
                  value={formatFinanceMoney(selectedTaxTotals.single_tax_minor, "UAH", language)}
                />
                <TaxMetric
                  label={t("teacherFinance.militaryLevy")}
                  value={formatFinanceMoney(selectedTaxTotals.military_levy_minor, "UAH", language)}
                />
                <TaxMetric
                  label={t("teacherFinance.esv")}
                  value={formatFinanceMoney(selectedTaxTotals.esv_minor, "UAH", language)}
                />
                <TaxMetric
                  label={t("teacherFinance.total")}
                  value={formatFinanceMoney(selectedTaxTotals.total_tax_minor, "UAH", language)}
                  emphasized
                />
              </div>

              {selectedTaxTotals.pending_fx_count > 0 && (
                <p className={styles.warning}>
                  {t("teacherFinance.pendingFx", {
                    count: selectedTaxTotals.pending_fx_count,
                  })}
                </p>
              )}

              {selectedTaxRows.length > 0 ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{t("teacherFinance.month")}</th>
                        <th>{t("teacherFinance.income")}</th>
                        <th>{t("teacherFinance.singleTax")}</th>
                        <th>{t("teacherFinance.militaryLevy")}</th>
                        <th>{t("teacherFinance.esv")}</th>
                        <th>{t("teacherFinance.total")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTaxRows.map((row) => (
                        <tr key={row.month_start}>
                          <td>{formatMonth(row.month_start, language)}</td>
                          <td>{formatFinanceMoney(row.income_base_uah_minor, "UAH", language)}</td>
                          <td>{formatFinanceMoney(row.single_tax_minor, "UAH", language)}</td>
                          <td>{formatFinanceMoney(row.military_levy_minor, "UAH", language)}</td>
                          <td>{formatFinanceMoney(row.esv_minor, "UAH", language)}</td>
                          <td>
                            <strong>{formatFinanceMoney(row.total_tax_minor, "UAH", language)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.muted}>{t("teacherFinance.noTaxRowsForPeriod")}</p>
              )}
            </>
          ) : (
            <p className={styles.info}>{t("teacherFinance.taxNotApplicable")}</p>
          )}
        </section>
      </div>
    </section>
  );
};

const TaxMetric = ({ label, value, emphasized = false }) => (
  <div className={`${styles.taxMetric} ${emphasized ? styles.taxMetricEmphasized : ""}`}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const renderCurrencyTotals = (totals, language, css) => {
  const rows = FINANCE_CURRENCIES.filter((currency) => Number(totals[currency] ?? 0) !== 0);

  if (rows.length === 0) return <span className={css.zeroMoney}>—</span>;

  return rows.map((currency) => (
    <strong key={currency}>{formatFinanceMoney(totals[currency], currency, language)}</strong>
  ));
};

const sumReceiptsByCurrency = (rows) =>
  rows.reduce((totals, row) => {
    totals[row.currency] = Number(totals[row.currency] ?? 0) + Number(row.amount_minor ?? 0);
    return totals;
  }, {});

const groupReceipts = (rows, mode, formatAccount) => {
  const groups = new Map();

  rows.forEach((row) => {
    const isStudent = mode === "students";
    const id = isStudent ? row.student_id : row.payment_account_id;
    const label = isStudent
      ? row.student_name || row.student_email || "—"
      : row.account_name || "—";
    const subtitle = isStudent
      ? row.student_email || ""
      : formatAccount(row);

    if (!groups.has(id)) {
      groups.set(id, {
        id,
        label,
        subtitle,
        totals: {},
        netIncomeUahMinor: 0,
        profitabilityPending: false,
        items: [],
      });
    }

    const group = groups.get(id);
    group.totals[row.currency] =
      Number(group.totals[row.currency] ?? 0) + Number(row.amount_minor ?? 0);

    if (row.profitability_status === "ready" && row.net_income_uah_minor != null) {
      group.netIncomeUahMinor += Number(row.net_income_uah_minor);
    } else {
      group.profitabilityPending = true;
    }

    group.items.push(row);
  });

  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
};

const sumTaxRows = (rows) =>
  rows.reduce(
    (totals, row) => ({
      income_base_uah_minor:
        totals.income_base_uah_minor + Number(row.income_base_uah_minor ?? 0),
      single_tax_minor: totals.single_tax_minor + Number(row.single_tax_minor ?? 0),
      military_levy_minor:
        totals.military_levy_minor + Number(row.military_levy_minor ?? 0),
      esv_minor: totals.esv_minor + Number(row.esv_minor ?? 0),
      total_tax_minor: totals.total_tax_minor + Number(row.total_tax_minor ?? 0),
      pending_fx_count: totals.pending_fx_count + Number(row.pending_fx_count ?? 0),
    }),
    {
      income_base_uah_minor: 0,
      single_tax_minor: 0,
      military_levy_minor: 0,
      esv_minor: 0,
      total_tax_minor: 0,
      pending_fx_count: 0,
    },
  );

const getVisibleParameterRows = (profile, parameterMap) => {
  if (!profile || profile.taxpayer_type !== "pe") return [];

  const group = Number(profile.pe_group);
  const codes = [
    "minimum_wage_minor",
    ...(group === 1 ? ["living_wage_minor"] : []),
    `group${group}_single_tax_rate`,
    `group${group}_military_levy_rate`,
    "esv_rate",
  ];

  return codes
    .map((code) => ({ code, value: parameterMap[code] }))
    .filter((item) => item.value?.value_numeric != null);
};

const formatResolvedParameter = (item, language) => {
  if (!item) return "—";
  if (item.unit === "uah_minor") {
    return formatFinanceMoney(item.value_numeric, "UAH", language);
  }
  return `${formatPercentValue(item.value_numeric)}%`;
};

const formatParameterOverride = (item, language) => {
  if (item.unit === "uah_minor") {
    return formatFinanceMoney(item.value_numeric, "UAH", language);
  }
  return `${formatPercentValue(item.value_numeric)}%`;
};

const formatParameterName = (code, t) => {
  if (code === "minimum_wage_minor") return t("teacherFinance.minimumWage");
  if (code === "living_wage_minor") return t("teacherFinance.livingWage");
  if (code === "esv_rate") return t("teacherFinance.esvRate");
  if (code.includes("single_tax")) return t("teacherFinance.singleTaxRate");
  return t("teacherFinance.militaryRate");
};

const formatTaxProfile = (profile, t) => {
  if (!profile) return t("teacherSettings.tax.notConfigured");
  if (profile.taxpayer_type === "none") return t("teacherSettings.tax.types.none");
  return `${t("teacherSettings.tax.types.pe")} · ${t(`teacherSettings.tax.groups.${profile.pe_group}`)}`;
};

const formatAccountMeta = (account, t) => {
  const owner = account.owner_type === "pe"
    ? t("teacherFinance.ownerPe")
    : t("teacherFinance.ownerPersonal");
  const type = account.account_type === "bank_account"
    ? t("teacherFinance.typeBank")
    : account.account_type === "cash"
      ? t("teacherFinance.typeCash")
      : t("teacherFinance.typeCard");
  return `${owner} · ${type}`;
};

const getBrowserDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const getDateInTimeZone = (timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const parseDate = (dateString) => {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const toDateString = (date) => date.toISOString().slice(0, 10);

const getMonthRange = (dateString) => {
  const date = parseDate(dateString);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: toDateString(start), end: toDateString(end) };
};

const getQuarterRange = (dateString) => {
  const date = parseDate(dateString);
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth + 3, 0));
  return { start: toDateString(start), end: toDateString(end) };
};

const getYearRange = (dateString) => {
  const date = parseDate(dateString);
  return {
    start: `${date.getUTCFullYear()}-01-01`,
    end: `${date.getUTCFullYear()}-12-31`,
  };
};

const shiftPeriodStart = (periodStart, mode, direction) => {
  const date = parseDate(periodStart);
  const months = mode === "quarter" ? 3 : 1;
  return toDateString(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months * direction, 1)),
  );
};

const formatDate = (dateString) => {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-");
  return `${day}.${month}.${year}`;
};

const formatMonth = (dateString, language) => {
  if (!dateString) return "—";
  const locale = String(language).startsWith("en")
    ? "en-GB"
    : String(language).startsWith("ru")
      ? "ru-RU"
      : "uk-UA";

  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateString}T00:00:00Z`));
};

const formatTaxPeriodLabel = (periodStart, mode, language, t) => {
  if (mode === "month") return formatMonth(periodStart, language);
  const date = parseDate(periodStart);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const quarterLabel = String(language).startsWith("en")
    ? quarter
    : ["I", "II", "III", "IV"][quarter - 1];
  return t("teacherFinance.quarterLabel", {
    quarter: quarterLabel,
    year: date.getUTCFullYear(),
  });
};

export default TeacherFinance;
