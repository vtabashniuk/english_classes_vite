import { getPageRange } from "../../../shared/pagination/pagination";
import { supabase } from "../../../shared/api/supabaseClient";

const TEACHER_FIELDS = "id, student_id, lesson_id, title, description, due_date, status, created_at, assignment_materials(materials(id,title,url,material_resources(id,title,external_url,sort_order)))";
const STUDENT_FIELDS = "id, title, description, due_date, status, completed_at, created_at, assignment_materials(materials(id,title,url,material_resources(id,title,external_url,sort_order)))";

// Same exact-count / limit / offset mechanism as finance transaction history.
// Each completion group is paginated separately on the server.
export const listTeacherStudentAssignments = (studentId, { status = "assigned", page = 0, pageSize = 20 } = {}) => {
  const { offset, limit } = getPageRange(page, pageSize);
  return supabase.from("assignments")
    .select(TEACHER_FIELDS, { count: "exact" })
    .eq("student_id", studentId).eq("status", status)
    .order(status === "completed" ? "completed_at" : "due_date", { ascending: status !== "completed", nullsFirst: false })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + limit - 1);
};

export const listStudentAssignments = ({ status = "assigned", page = 0, pageSize = 20 } = {}) => {
  const { offset, limit } = getPageRange(page, pageSize);
  return supabase.from("assignments")
    .select(STUDENT_FIELDS, { count: "exact" })
    .eq("status", status)
    .order(status === "completed" ? "completed_at" : "due_date", { ascending: status !== "completed", nullsFirst: false })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + limit - 1);
};

export const saveAssignment = ({ editingId, payload }) => {
  if (editingId) {
    return supabase.rpc("update_assignment", {
      ...payload,
      p_assignment_id: editingId,
    });
  }

  return supabase.rpc("create_assignment", payload);
};

export const completeAssignment = (assignmentId) =>
  supabase.rpc("complete_assignment", {
    p_assignment_id: assignmentId,
  });

// Teacher visibility always relies on existing assignments RLS.
export const listAssignedLessonHomework = (lessonId) =>
  supabase.from("assignments")
    .select("id,title,due_date")
    .eq("lesson_id", lessonId)
    .eq("status", "assigned")
    .order("due_date", { ascending: true, nullsFirst: false });

export const listTeacherPendingAssignmentCounts = () =>
  supabase.rpc("teacher_pending_assignment_counts");

// One aggregated, RLS-scoped request per visible calendar week (no per-lesson queries).
export const listPendingHomeworkCountsForSchedule = ({ fromIso, toIso }) =>
  supabase.rpc("teacher_schedule_pending_homework", {
    p_from: fromIso, p_to: toIso,
  });
