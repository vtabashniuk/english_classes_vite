import { supabase } from "../../../shared/api/supabaseClient";

export const listStudentLessons = () =>
  supabase
    .from("lessons")
    .select(
      "id, starts_at, ends_at, duration_minutes, status, zoom_url, pricing_date, price_amount_minor, price_currency, price_rate_id, cancelled_by, cancelled_at, cancellation_reason, cancellation_request_id, cancellation_charge_mode, cancellation_waiver_reason",
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
        cancellation_request_id,
        cancellation_charge_mode,
        cancellation_waiver_reason,
        recurring_lesson_id,
        pricing_date,
        price_amount_minor,
        price_currency,
        price_rate_id,
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


export const listMyLessonCancellationRequests = () =>
  supabase
    .from("lesson_cancellation_requests")
    .select(
      "id, lesson_id, teacher_id, student_id, status, requested_at, reason, free_cancellation_hours_snapshot, minutes_before_start, is_late, resolved_at, resolved_by, charge_mode, waiver_reason",
    )
    .order("requested_at", { ascending: false });


export const listPendingTeacherLessonCancellationRequests = () =>
  supabase
    .from("lesson_cancellation_requests")
    .select(
      `
        id,
        lesson_id,
        teacher_id,
        student_id,
        status,
        requested_at,
        reason,
        free_cancellation_hours_snapshot,
        minutes_before_start,
        is_late,
        resolved_at,
        resolved_by,
        charge_mode,
        waiver_reason,
        lessons:lesson_id (
          id,
          starts_at,
          ends_at,
          duration_minutes,
          status,
          cancelled_by,
          cancellation_request_id,
          cancellation_charge_mode,
          price_amount_minor,
          price_currency
        )
      `,
    )
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

export const hasPendingLessonCancellationRequests = (teacherId) =>
  supabase
    .from("lesson_cancellation_requests")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("status", "pending")
    .limit(1);

export const previewLessonCancellation = ({ lessonId }) =>
  supabase.rpc("preview_lesson_cancellation", {
    p_lesson_id: lessonId,
  });

export const requestLessonCancellation = ({ lessonId, reason = null }) =>
  supabase.rpc("request_lesson_cancellation", {
    p_lesson_id: lessonId,
    p_reason: reason,
  });

export const resolveLessonCancellationRequest = ({
  requestId,
  action,
  waiverReason = null,
}) =>
  supabase.rpc("resolve_lesson_cancellation_request", {
    p_request_id: requestId,
    p_action: action,
    p_waiver_reason: waiverReason,
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
