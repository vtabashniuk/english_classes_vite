import { supabase } from "../../../shared/api/supabaseClient";

export const listTeacherAssignments = () =>
  supabase
    .from("assignments")
    .select(
      "id, student_id, lesson_id, title, description, due_date, status, created_at, profiles:student_id(full_name,email), assignment_materials(materials(id,title,url))",
    )
    .order("created_at", { ascending: false });

export const listStudentAssignments = () =>
  supabase
    .from("assignments")
    .select(
      "id, title, description, due_date, status, completed_at, created_at, assignment_materials(materials(id,title,url,category))",
    )
    .order("created_at", { ascending: false });

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
