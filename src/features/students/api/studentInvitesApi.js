import { supabase } from "../../../shared/api/supabaseClient";

export const inviteStudent = ({ email, fullName }) =>
  supabase.functions.invoke("invite-student", {
    body: { email, fullName },
  });
