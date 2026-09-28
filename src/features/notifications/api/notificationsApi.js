import { supabase } from "../../../shared/api/supabaseClient";

export const listNotifications = () =>
  supabase
    .from("notifications")
    .select(
      "id, type, lesson_id, title_key, body_key, data, is_read, created_at",
    )
    .order("created_at", { ascending: false });

export const hasUnreadNotifications = () =>
  supabase
    .from("notifications")
    .select("id")
    .eq("is_read", false)
    .limit(1);

export const markNotificationRead = (notificationId) =>
  supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });

export const markAllNotificationsRead = () =>
  supabase.rpc("mark_all_notifications_read");
