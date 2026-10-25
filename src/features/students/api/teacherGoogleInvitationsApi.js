import { supabase } from "../../../shared/api/supabaseClient";

// Both functions are SECURITY DEFINER RPCs that derive the teacher from auth.uid().
// The browser cannot choose a teacher or query crm_private directly.
export const listMyPendingGoogleStudentInvitations = () =>
  supabase.rpc("list_my_pending_google_invitations");

export const cancelMyPendingGoogleStudentInvitation = (invitationId) =>
  supabase.rpc("cancel_my_pending_google_invitation", { p_id: invitationId });
