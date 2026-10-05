import { useEffect, useState } from "react";

import {
  getMyCurrentTaxProfile,
  getTeacherFinanceReceipts,
  getTeacherStudentFinanceHealth,
  refreshFinanceFxRates,
} from "../../finance/api/financeApi";
import { listTeacherUpcomingLessons } from "../../lessons/api/lessonsApi";
import { getMyTeacherScheduleSettings } from "../../settings/api/teacherSettingsApi";

const DEFAULT_TIMEZONE = "Europe/Kyiv";
const UPCOMING_LESSON_LIMIT = 500;

export const useTeacherOverview = () => {
  const [state, setState] = useState({
    loading: true,
    error: null,
    timezone: DEFAULT_TIMEZONE,
    today: getBrowserDateString(),
    currentTaxProfile: null,
    receipts: [],
    financeHealth: [],
    upcomingLessons: [],
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setState((current) => ({ ...current, loading: true, error: null }));

        const settingsResult = await getMyTeacherScheduleSettings();
        if (settingsResult.error) throw settingsResult.error;

        const timezone =
          settingsResult.data?.schedule_timezone || DEFAULT_TIMEZONE;
        const today = getDateInTimeZone(timezone);
        const monthRange = getMonthRange(today);

        const fxRefreshResult = await refreshFinanceFxRates(today);
        if (fxRefreshResult.error) {
          console.warn(
            "Refresh finance FX rates on teacher overview warning:",
            fxRefreshResult.error,
          );
        }

        const [taxProfileResult, receiptsResult, healthResult, lessonsResult] =
          await Promise.all([
            getMyCurrentTaxProfile(),
            getTeacherFinanceReceipts({
              dateFrom: monthRange.start,
              dateTo: monthRange.end,
            }),
            getTeacherStudentFinanceHealth(),
            listTeacherUpcomingLessons({
              fromIso: new Date().toISOString(),
              limit: UPCOMING_LESSON_LIMIT,
            }),
          ]);

        const error =
          taxProfileResult.error ||
          receiptsResult.error ||
          healthResult.error ||
          lessonsResult.error;

        if (error) throw error;
        if (cancelled) return;

        setState({
          loading: false,
          error: null,
          timezone,
          today,
          currentTaxProfile: taxProfileResult.data ?? null,
          receipts: receiptsResult.data ?? [],
          financeHealth: healthResult.data ?? [],
          upcomingLessons: lessonsResult.data ?? [],
        });
      } catch (error) {
        console.error("Load teacher overview error:", error);
        if (cancelled) return;

        setState((current) => ({
          ...current,
          loading: false,
          error,
        }));
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};

const getBrowserDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateInTimeZone = (timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
};

const getMonthRange = (dateString) => {
  const [year, month] = dateString.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const paddedMonth = String(month).padStart(2, "0");

  return {
    start: `${year}-${paddedMonth}-01`,
    end: `${year}-${paddedMonth}-${String(lastDay).padStart(2, "0")}`,
  };
};
