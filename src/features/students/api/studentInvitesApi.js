import { supabase } from "../../../shared/api/supabaseClient";

export const inviteStudent = async ({ email, fullName }) => {
  const { data, error } = await supabase.functions.invoke("invite-student", {
    body: { email, fullName },
  });

  if (!error) {
    return { data, error: null };
  }

  let message = error.message || "INVITE_FAILED";

  // FunctionsHttpError keeps the original HTTP Response in context.
  // Surface the JSON error returned by the Edge Function instead of losing it
  // behind the generic "non-2xx status code" message.
  if (error.context) {
    try {
      const payload = await error.context.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Keep the original FunctionsHttpError message if the body is not JSON.
    }
  }

  return {
    data,
    error: new Error(message, { cause: error }),
  };
};
