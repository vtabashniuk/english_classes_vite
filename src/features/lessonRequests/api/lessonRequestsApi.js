import { supabase } from "../../../shared/api/supabaseClient";

export const listStudentLessonRequests = () =>
  supabase
    .from("lesson_requests")
    .select(
      "id, request_type, lesson_id, original_starts_at, requested_starts_at, duration_minutes, message, status, created_at",
    )
    .order("created_at", { ascending: false });

export const listPendingTeacherLessonRequests = () =>
  supabase
    .from("lesson_requests")
    .select(
      "id, request_type, lesson_id, original_starts_at, student_id, requested_starts_at, duration_minutes, message, status, created_at",
    )
    .eq("status", "pending")
    .order("requested_starts_at", { ascending: true });

export const listTeacherLessonRequests = (teacherId) =>
  supabase
    .from("lesson_requests")
    .select(
      "id, request_type, lesson_id, original_starts_at, student_id, requested_starts_at, duration_minutes, message, status, created_at",
    )
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

export const hasPendingLessonRequests = (teacherId) =>
  supabase
    .from("lesson_requests")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("status", "pending")
    .limit(1);

export const getExtraLessonAvailability = (date) =>
  supabase.rpc("get_extra_lesson_availability", { p_date: date });

export const createExtraLessonRequest = ({ startsAt, message }) =>
  supabase.rpc("create_extra_lesson_request", {
    p_requested_starts_at: startsAt,
    p_message: message,
  });

export const cancelExtraLessonRequest = (requestId) =>
  supabase.rpc("cancel_extra_lesson_request", {
    p_request_id: requestId,
  });

export const approveLessonRequest = (requestId) =>
  supabase.rpc("approve_lesson_request", {
    p_request_id: requestId,
  });

export const rejectLessonRequest = ({ requestId, comment }) =>
  supabase.rpc("reject_lesson_request", {
    p_request_id: requestId,
    p_comment: comment,
  });

export const previewLessonReschedule = (lessonId) =>
  supabase.rpc("preview_lesson_reschedule", {
    p_lesson_id: lessonId,
  });

export const getLessonRescheduleAvailability = ({ lessonId, date }) =>
  supabase.rpc("get_lesson_reschedule_availability", {
    p_lesson_id: lessonId,
    p_date: date,
  });

export const createLessonRescheduleRequest = ({
  lessonId,
  requestedStartsAt,
  message,
}) =>
  supabase.rpc("create_lesson_reschedule_request", {
    p_lesson_id: lessonId,
    p_requested_starts_at: requestedStartsAt,
    p_message: message,
  });

export const cancelLessonRescheduleRequest = (requestId) =>
  supabase.rpc("cancel_lesson_reschedule_request", {
    p_request_id: requestId,
  });

export const approveLessonRescheduleRequest = (requestId) =>
  supabase.rpc("approve_lesson_reschedule_request", {
    p_request_id: requestId,
  });

export const rejectLessonRescheduleRequest = ({ requestId, comment }) =>
  supabase.rpc("reject_lesson_reschedule_request", {
    p_request_id: requestId,
    p_comment: comment,
  });
