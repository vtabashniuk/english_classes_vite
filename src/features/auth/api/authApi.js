import { supabase } from "../../../shared/api/supabaseClient";

export const getSession = () => supabase.auth.getSession();

export const onAuthStateChange = (callback) =>
  supabase.auth.onAuthStateChange(callback);

export const signInWithPassword = ({ email, password }) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = () => supabase.auth.signOut();

export const exchangeCodeForSession = (code) =>
  supabase.auth.exchangeCodeForSession(code);

export const updateCurrentUser = (attributes) =>
  supabase.auth.updateUser(attributes);
