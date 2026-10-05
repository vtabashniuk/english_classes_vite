import { supabase } from "../../../shared/api/supabaseClient";

export const listTeacherStudentRecurringLessons = ({ studentId, today }) =>
  supabase
    .from("recurring_lessons")
    .select(
      "id, weekday, start_time, timezone, duration_minutes, valid_from, valid_until, interval_weeks, is_active",
    )
    .eq("student_id", studentId)
    .eq("is_active", true)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

export const getTeacherStudentNextLesson = ({ studentId, fromIso }) =>
  supabase
    .from("lessons")
    .select("id, starts_at, ends_at, duration_minutes, status, meeting_url")
    .eq("student_id", studentId)
    .eq("status", "scheduled")
    .gte("starts_at", fromIso)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

export const listTeacherStudentAssignments = (studentId) =>
  supabase
    .from("assignments")
    .select("id, lesson_id, title, description, due_date, status, created_at")
    .eq("student_id", studentId)
    .eq("status", "assigned")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(5);

export const getTeacherStudentPrivateNote = (studentId) =>
  supabase
    .from("teacher_student_private_notes")
    .select("note, updated_at")
    .eq("student_id", studentId)
    .maybeSingle();

export const saveTeacherStudentPrivateNote = ({ studentId, note }) =>
  supabase.rpc("save_my_student_private_note", {
    p_student_id: studentId,
    p_note: note,
  });
