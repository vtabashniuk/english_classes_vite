import { supabase } from "../../../shared/api/supabaseClient";

const PROFILE_FIELDS =
  "id, email, full_name, role, phone, timezone, is_active";

export const getProfileById = (userId) =>
  supabase
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", userId)
    .single();

export const getLoginProfileById = (userId) =>
  supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .single();

export const listActiveStudents = async ({ includeContact = false } = {}) => {
  const { data, error } = await supabase.rpc("list_teacher_students_lifecycle");

  if (error) return { data: null, error };

  const activeStudents = (data ?? [])
    .filter((student) => student.learning_status === "active")
    .map((student) => ({
      id: student.student_id,
      full_name: student.full_name,
      email: student.email,
      ...(includeContact
        ? { is_active: Boolean(student.profile_is_active) }
        : {}),
    }));

  return { data: activeStudents, error: null };
};

export const listStudents = () =>
  supabase
    .from("profiles")
    .select("id, email, full_name, phone, is_active, created_at")
    .eq("role", "student")
    .order("full_name", { ascending: true });

export const getStudentById = (studentId) =>
  supabase
    .from("profiles")
    .select("id, email, full_name, phone, role, is_active, created_at")
    .eq("id", studentId)
    .eq("role", "student")
    .maybeSingle();

export const getStudentsByIds = (studentIds) =>
  supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", studentIds);

export const updateMyProfile = ({ fullName, phone, timezone }) =>
  supabase.rpc("update_my_profile", {
    new_full_name: fullName,
    new_phone: phone,
    new_timezone: timezone,
  });
