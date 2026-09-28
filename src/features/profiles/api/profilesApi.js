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

export const listActiveStudents = ({ includeContact = false } = {}) =>
  supabase
    .from("profiles")
    .select(
      includeContact
        ? "id, full_name, email, is_active"
        : "id, full_name, email",
    )
    .eq("role", "student")
    .eq("is_active", true)
    .order("full_name");

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
