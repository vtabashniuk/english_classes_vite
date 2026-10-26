import { supabase } from "../../../shared/api/supabaseClient";

// All requests execute with the signed-in user's access token.
// No teacher/student/email identifiers are accepted from the browser.
export const listMyGoogleInvitations = () =>
  supabase.rpc("list_my_google_invitation_choices");

export const acceptMyGoogleInvitation = (invitationId) =>
  supabase.rpc("accept_my_pending_google_invitation", {
    p_invitation_id: invitationId,
  });

export const getMyActiveTeacherLink = async (studentId) => {
  const { data, error } = await supabase
    .from("teacher_students")
    .select("teacher_id")
    .eq("student_id", studentId)
    .eq("is_active", true)
    .limit(1);
  return { data: (data ?? [])[0] ?? null, error };
};
