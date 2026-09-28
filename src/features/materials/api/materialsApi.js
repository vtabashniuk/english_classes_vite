import { supabase } from "../../../shared/api/supabaseClient";

export const listTeacherMaterialsWithAssignments = () =>
  supabase
    .from("materials")
    .select(
      "id, title, description, url, category, created_at, student_materials(student_id)",
    )
    .order("created_at", { ascending: false });

export const listMaterialsForAssignment = () =>
  supabase.from("materials").select("id, title, category").order("title");

export const createMaterial = ({ teacherId, payload }) =>
  supabase.from("materials").insert({ ...payload, teacher_id: teacherId });

export const updateMaterial = ({ materialId, payload }) =>
  supabase
    .from("materials")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", materialId);

export const deleteMaterial = (materialId) =>
  supabase.from("materials").delete().eq("id", materialId);

export const shareMaterialWithStudent = ({ materialId, studentId }) =>
  supabase.rpc("share_material_with_student", {
    p_material_id: materialId,
    p_student_id: studentId,
  });

export const listStudentMaterials = () =>
  supabase
    .from("student_materials")
    .select(
      "id, assigned_at, materials(id, title, description, url, category)",
    )
    .order("assigned_at", { ascending: false });
