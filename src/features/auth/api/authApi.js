import { recordPasswordAuthEvent } from "../lib/passwordFlowState";
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

export const signOut = () => supabase.auth.signOut();

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
