import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { FINANCE_CURRENCIES } from "../../constants/finance";
import { useTeacherOverview } from "../../features/dashboard/hooks/useTeacherOverview";
import { buildFinanceReceiptSummary } from "../../features/finance/lib/financeSummary";
import {
  formatLessonTime,
  getDatePartsInTimezone,
} from "../../features/schedule/lib/scheduleUtils";
import { formatFinanceMoney } from "../../utils/formatFinanceMoney";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./TeacherDashboard.module.css";

const TeacherDashboard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const language = i18n.resolvedLanguage || i18n.language;
  const locale = getIntlLocale(language);
  const {
    loading,
    error,
    timezone,
    currentTaxProfile,
    receipts,
    financeHealth,
    upcomingLessons,
  } = useTeacherOverview();

  const actions = [
    {
      to: "/teacher-dashboard/schedule",
      titleKey: "teacherDashboard.actions.schedule.title",
      descriptionKey: "teacherDashboard.actions.schedule.description",
    },
    {
      to: "/teacher-dashboard/students",
      titleKey: "teacherDashboard.actions.students.title",
      descriptionKey: "teacherDashboard.actions.students.description",
    },
    {
      to: "/teacher-dashboard/settings",
      titleKey: "teacherDashboard.actions.settings.title",
      descriptionKey: "teacherDashboard.actions.settings.description",
    },
  ];

  const receiptSummary = useMemo(
    () => buildFinanceReceiptSummary(receipts),
    [receipts],
  );
  const incomeTotals = receiptSummary.totalsByCurrency;
  const visibleCurrencies = FINANCE_CURRENCIES.filter(
    (currency) => Number(incomeTotals[currency] ?? 0) !== 0,
  );
  const isPe = currentTaxProfile?.taxpayer_type === "pe";
  const netIncomeUahMinor = receiptSummary.netIncomeUahMinor;
  const profitabilityPending = receiptSummary.profitabilityPending;
  const totalIncomeUahMinor = receiptSummary.totalIncomeUahMinor;
  const reportingPending = receiptSummary.reportingPending;

  const debtors = useMemo(
    () =>
      financeHealth
        .filter((item) => Number(item.debt_minor ?? 0) > 0)
        .sort((a, b) => {
          const lessonsCompare =
            Number(b.unpaid_lesson_count ?? 0) -
            Number(a.unpaid_lesson_count ?? 0);
          return (
            lessonsCompare ||
            (a.student_name || a.student_email || "").localeCompare(
              b.student_name || b.student_email || "",
              locale,
            )
          );
        }),
    [financeHealth, locale],
  );

  const upcomingLessonDays = useMemo(
    () => groupUpcomingLessonsByDay(upcomingLessons, timezone).slice(0, 3),
    [upcomingLessons, timezone],
  );

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1>{t("teacherDashboard.title")}</h1>
        <p>{t("teacherDashboard.description")}</p>
      </header>

      <div className={styles.actionsGrid}>
        {actions.map((action) => (
          <Link key={action.to} to={action.to} className={styles.actionCard}>
            <div>
              <h2>{t(action.titleKey)}</h2>
              <p>{t(action.descriptionKey)}</p>
            </div>

            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>

      {error ? (
        <section className={styles.stateCard}>
          <p className={styles.error}>{t("teacherDashboard.loadError")}</p>
        </section>
      ) : loading ? (
        <section className={styles.stateCard}>
          <p className={styles.muted}>{t("teacherDashboard.loading")}</p>
        </section>
      ) : (
        <div className={styles.overviewContent}>
          <div className={styles.summaryGrid}>
            <section className={styles.summaryCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2>{t("teacherDashboard.finance.title")}</h2>
                  <p>{t("teacherDashboard.finance.currentMonth")}</p>
                </div>
                <Link className={styles.sectionLink} to="/teacher-dashboard/finance">
                  {t("teacherDashboard.openFinance")}
                </Link>
              </div>

              {visibleCurrencies.length > 0 ? (
                <div className={styles.incomeList}>
                  {visibleCurrencies.map((currency) => (
                    <div key={currency} className={styles.incomeRow}>
                      <span>{currency}</span>
                      <strong>
                        {formatFinanceMoney(incomeTotals[currency], currency, language)}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>{t("teacherDashboard.finance.noIncome")}</p>
              )}

              {visibleCurrencies.length > 0 && (
                <div className={styles.financeTotals}>
                  <div className={styles.totalIncomeRow}>
                    <span>{t("teacherDashboard.finance.totalIncomeUah")}</span>
                    {reportingPending ? (
                      <strong>{t("teacherDashboard.finance.totalIncomePending")}</strong>
                    ) : (
                      <strong>
                        {formatFinanceMoney(totalIncomeUahMinor, "UAH", language)}
                      </strong>
                    )}
                  </div>

                  {isPe && (
                    <div className={styles.netIncomeBox}>
                      <span>{t("teacherDashboard.finance.netIncome")}</span>
                      {profitabilityPending ? (
                        <strong>{t("teacherDashboard.finance.netIncomePending")}</strong>
                      ) : (
                        <strong>
                          {formatFinanceMoney(netIncomeUahMinor, "UAH", language)}
                        </strong>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className={styles.summaryCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2>{t("teacherDashboard.debtors.title")}</h2>
                  <p>{t("teacherDashboard.debtors.description")}</p>
                </div>
                <strong className={styles.countBadge}>{debtors.length}</strong>
              </div>

              {debtors.length > 0 ? (
                <div className={styles.debtorsList}>
                  {debtors.map((item) => (
                    <Link
                      key={item.student_id}
                      className={styles.debtorRow}
                      to={`/teacher-dashboard/students/${item.student_id}`}
                    >
                      <div>
                        <strong>{item.student_name || item.student_email}</strong>
                        <small>
                          {t("teacherDashboard.debtors.unpaidLessons", {
                            count: Number(item.unpaid_lesson_count ?? 0),
                          })}
                        </small>
                      </div>
                      <strong className={styles.debtValue}>
                        −
                        {formatFinanceMoney(
                          item.debt_minor,
                          item.billing_currency,
                          language,
                        )}
                      </strong>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>{t("teacherDashboard.debtors.empty")}</p>
              )}
            </section>
          </div>

          <section className={styles.lessonsSection}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>{t("teacherDashboard.upcomingLessons.title")}</h2>
                <p>{t("teacherDashboard.upcomingLessons.description")}</p>
              </div>
              <Link className={styles.sectionLink} to="/teacher-dashboard/schedule">
                {t("teacherDashboard.openSchedule")}
              </Link>
            </div>

            {upcomingLessonDays.length > 0 ? (
              <div className={styles.daysGrid}>
                {upcomingLessonDays.map((day) => (
                  <article key={day.dateKey} className={styles.dayCard}>
                    <div className={styles.dayHeader}>
                      <strong>{formatDayTitle(day.lessons[0].starts_at, locale, timezone)}</strong>
                      <span>
                        {t("teacherDashboard.upcomingLessons.lessonCount", {
                          count: day.lessons.length,
                        })}
                      </span>
                    </div>

                    <div className={styles.lessonList}>
                      {day.lessons.map((lesson) => (
                        <div key={lesson.id} className={styles.lessonRow}>
                          <button
                            type="button"
                            className={styles.lessonOpenButton}
                            onClick={() =>
                              navigate(`/teacher-dashboard/schedule?lessonId=${lesson.id}`)
                            }
                          >
                            <strong className={styles.lessonTime}>
                              {formatLessonTime(lesson.starts_at, locale, timezone)}
                            </strong>
                            <span className={styles.lessonStudentName}>
                              {lesson.profiles?.full_name ||
                                lesson.profiles?.email ||
                                t("teacherDashboard.upcomingLessons.unknownStudent")}
                            </span>
                          </button>

                          <div className={styles.lessonActions}>
                            <Link
                              to={`/teacher-dashboard/students/${lesson.student_id}`}
                              className={styles.studentCardLink}
                            >
                              {t("teacherDashboard.upcomingLessons.openStudent")}
                            </Link>
                            {lesson.zoom_url && (
                              <a
                                href={lesson.zoom_url}
                                target="_blank"
                                rel="noreferrer"
                                className={styles.zoomLink}
                              >
                                Zoom ↗
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyCard}>
                <p>{t("teacherDashboard.upcomingLessons.empty")}</p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
};


const groupUpcomingLessonsByDay = (lessons, timezone) => {
  const groups = [];
  let current = null;

  lessons.forEach((lesson) => {
    const parts = getDatePartsInTimezone(lesson.starts_at, timezone);
    const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
      parts.day,
    ).padStart(2, "0")}`;

    if (!current || current.dateKey !== dateKey) {
      current = { dateKey, lessons: [] };
      groups.push(current);
    }

    current.lessons.push(lesson);
  });

  return groups;
};

const formatDayTitle = (value, locale, timezone) =>
  new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));

export default TeacherDashboard;
