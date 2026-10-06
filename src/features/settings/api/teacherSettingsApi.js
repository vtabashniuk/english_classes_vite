import { supabase } from "../../../shared/api/supabaseClient";

const teacherScheduleSettingsQuery = () =>
  supabase
    .from("teacher_settings")
    .select(
      `
        schedule_timezone,
        workday_start,
        workday_end,
        lesson_duration_minutes,
        slot_interval_minutes,
        low_balance_threshold_lessons,
        financial_blocking_enabled,
        financial_blocking_debt_threshold_lessons,
        free_cancellation_hours,
        finance_history_page_size,
        reschedule_price_policy,
        allow_open_ended_recurring_lessons,
        recurring_generation_horizon_weeks
      `,
    );

export const getMyTeacherScheduleSettings = () =>
  teacherScheduleSettingsQuery().single();

export const getTeacherScheduleSettings = (teacherId) =>
  teacherScheduleSettingsQuery().eq("teacher_id", teacherId).single();

export const getMyTeacherWorkingHours = () =>
  supabase
    .from("teacher_working_hours")
    .select("weekday, is_working, workday_start, workday_end")
    .order("weekday", { ascending: true });

export const getTeacherTimezone = (teacherId) =>
  supabase
    .from("teacher_settings")
    .select("schedule_timezone")
    .eq("teacher_id", teacherId)
    .maybeSingle();

export const updateMyTeacherSettings = ({
  timezone,
  workdayStart,
  workdayEnd,
  lessonDurationMinutes,
}) =>
  supabase.rpc("update_my_teacher_settings", {
    p_schedule_timezone: timezone,
    p_workday_start: workdayStart,
    p_workday_end: workdayEnd,
    p_lesson_duration_minutes: lessonDurationMinutes,
  });

export const updateMyScheduleSettings = ({
  timezone,
  lessonDurationMinutes,
  workingHours,
  reschedulePricePolicy,
  allowOpenEndedRecurringLessons,
  recurringGenerationHorizonWeeks,
}) =>
  supabase.rpc("update_my_schedule_settings_v2", {
    p_schedule_timezone: timezone,
    p_lesson_duration_minutes: lessonDurationMinutes,
    p_working_hours: workingHours.map((item) => ({
      weekday: item.weekday,
      is_working: item.isWorking,
      workday_start: item.workdayStart,
      workday_end: item.workdayEnd,
    })),
    p_reschedule_price_policy: reschedulePricePolicy,
    p_allow_open_ended_recurring_lessons: allowOpenEndedRecurringLessons,
    p_recurring_generation_horizon_weeks: recurringGenerationHorizonWeeks,
  });

export const updateMyFinancePreferences = ({
  lowBalanceThresholdLessons,
  financialBlockingEnabled,
  financialBlockingDebtThresholdLessons,
  freeCancellationHours,
  historyPageSize,
}) =>
  supabase.rpc("update_my_finance_preferences", {
    p_low_balance_threshold_lessons: lowBalanceThresholdLessons,
    p_financial_blocking_enabled: financialBlockingEnabled,
    p_financial_blocking_debt_threshold_lessons:
      financialBlockingDebtThresholdLessons,
    p_free_cancellation_hours: freeCancellationHours,
    p_finance_history_page_size: historyPageSize,
  });
