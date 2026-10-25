import { recordPasswordAuthEvent } from "../lib/passwordFlowState";
import { clearGoogleOAuthStart, rememberGoogleOAuthStart } from "../lib/googleOAuthFlow";
import { GOOGLE_OAUTH_UI_ENABLED } from "../lib/googleOAuthConfig";
import { supabase } from "../../../shared/api/supabaseClient";

// Register early enough to capture one-time email-link auth events.
supabase.auth.onAuthStateChange((event, session) => {
  recordPasswordAuthEvent(event, session);
});

export const getSession = () => supabase.auth.getSession();

export const getAuthenticatedUser = () => supabase.auth.getUser();

export const onAuthStateChange = (callback) =>
  supabase.auth.onAuthStateChange(callback);

export const signInWithPassword = ({ email, password }) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = (options) => supabase.auth.signOut(options);

// Prevent development StrictMode effect replay from consuming an email code twice.
let lastCode = null;
let lastExchange = null;
export const exchangeCodeForSession = (code) => {
  if (code !== lastCode) {
    lastCode = code;
    lastExchange = supabase.auth.exchangeCodeForSession(code);
  }
  return lastExchange;
};

export const updateCurrentUser = (attributes) =>
  supabase.auth.updateUser(attributes);

export const requestPasswordReset = ({ email, redirectTo }) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo });

// Supabase redirects to the CRM's *separate* Google callback.
// The existing /auth/callback stays reserved for email invitation links.
export const signInWithGoogle = async () => {
  if (!GOOGLE_OAUTH_UI_ENABLED) {
    return { data: null, error: new Error("GOOGLE_OAUTH_DISABLED") };
  }
  try {
    rememberGoogleOAuthStart();
  } catch {
    return { data: null, error: new Error("GOOGLE_OAUTH_STORAGE_UNAVAILABLE") };
  }
  try {
    const result = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/google/callback` },
    });
    if (result.error) clearGoogleOAuthStart();
    return result;
  } catch (error) {
    clearGoogleOAuthStart();
    return { data: null, error };
  }
};
