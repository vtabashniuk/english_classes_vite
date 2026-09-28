import { supabase } from "../../../shared/api/supabaseClient";

export const listStudentLessons = () =>
  supabase
    .from("lessons")
    .select(
      "id, starts_at, ends_at, duration_minutes, status, zoom_url, cancelled_by, cancelled_at, cancellation_reason",
    )
    .order("starts_at", { ascending: true });

export const listTeacherLessonsForRange = ({ startIso, endIso }) =>
  supabase
    .from("lessons")
    .select(
      `
        id,
        teacher_id,
        student_id,
        starts_at,
        ends_at,
        duration_minutes,
        status,
        zoom_url,
        completed_at,
        missed_at,
        cancelled_by,
        cancelled_at,
        cancellation_reason,
        recurring_lesson_id,
        profiles:student_id (
          id,
          full_name,
          email
        )
      `,
    )
    .gte("starts_at", startIso)
    .lt("starts_at", endIso)
    .order("starts_at", { ascending: true });

export const listStudentLessonsForAssignment = ({ studentId, fromIso, toIso }) =>
  supabase
    .from("lessons")
    .select("id, starts_at, status")
    .eq("student_id", studentId)
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true });

export const createLesson = ({ studentId, lessonDate, startTime, zoomUrl }) =>
  supabase.rpc("create_lesson", {
    p_student_id: studentId,
    p_lesson_date: lessonDate,
    p_start_time: startTime,
    p_zoom_url: zoomUrl,
  });

export const cancelLesson = ({ lessonId, reason = null }) =>
  supabase.rpc("cancel_lesson", {
    p_lesson_id: lessonId,
    p_reason: reason,
  });

export const setLessonOutcome = ({ lessonId, status }) =>
  supabase.rpc("set_lesson_outcome", {
    p_lesson_id: lessonId,
    p_status: status,
  });

export const updateLessonZoom = ({ lessonId, zoomUrl }) =>
  supabase.rpc("update_lesson_zoom", {
    p_lesson_id: lessonId,
    p_zoom_url: zoomUrl,
  });
