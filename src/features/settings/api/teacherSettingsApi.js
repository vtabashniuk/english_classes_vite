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
        free_cancellation_hours,
        finance_history_page_size
      `,
    );

export const getMyTeacherScheduleSettings = () =>
  teacherScheduleSettingsQuery().single();

export const getTeacherScheduleSettings = (teacherId) =>
  teacherScheduleSettingsQuery().eq("teacher_id", teacherId).single();

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

export const updateMyFinancePreferences = ({
  lowBalanceThresholdLessons,
  freeCancellationHours,
  historyPageSize,
}) =>
  supabase.rpc("update_my_finance_preferences", {
    p_low_balance_threshold_lessons: lowBalanceThresholdLessons,
    p_free_cancellation_hours: freeCancellationHours,
    p_finance_history_page_size: historyPageSize,
  });
