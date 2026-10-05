import { supabase } from "../../../shared/api/supabaseClient";

export const getRecurringLessonById = (recurringLessonId) =>
  supabase
    .from("recurring_lessons")
    .select("weekday, start_time, interval_weeks, valid_until, meeting_url")
    .eq("id", recurringLessonId)
    .single();

export const createRecurringLessonWithGeneration = (payload) =>
  supabase.rpc("create_recurring_lesson_with_generation", payload);

export const editRecurringSeriesFromLesson = (payload) =>
  supabase.rpc("edit_recurring_series_from_lesson", payload);

export const cancelRecurringSeriesFromLesson = (lessonId) =>
  supabase.rpc("cancel_recurring_series_from_lesson", {
    p_lesson_id: lessonId,
  });

export const listTeacherProjectedRecurringLessonsForRange = ({
  fromDate,
  untilDate,
}) =>
  supabase.rpc("get_teacher_projected_recurring_lessons", {
    p_from: fromDate,
    p_until: untilDate,
  });
