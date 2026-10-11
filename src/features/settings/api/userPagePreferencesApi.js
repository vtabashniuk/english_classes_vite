import { supabase } from "../../../shared/api/supabaseClient";

export const loadPagePreferences = (userId) =>
  supabase.from("user_page_preferences").select("preferences")
    .eq("user_id", userId).maybeSingle();

export const storePagePreferences = (userId, preferences) =>
  supabase.from("user_page_preferences")
    .upsert({ user_id: userId, preferences }, { onConflict: "user_id" });
