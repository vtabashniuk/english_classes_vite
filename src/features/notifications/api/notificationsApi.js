import { supabase } from "../../../shared/api/supabaseClient";
import { getPageRange } from "../../../shared/pagination/pagination";

const reconcileExpiredLearningPauses = async () => {
  const { error } = await supabase.rpc("reconcile_my_expired_learning_pauses");
  if (error) console.warn("Learning pause reconciliation warning:", error);
};

// Hide expired notifications immediately, even if the daily purge has not run yet.
const retentionCutoff = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

export const listNotifications = async ({ page = 0, pageSize = 20, unreadOnly = false } = {}) => {
  await reconcileExpiredLearningPauses();
  const { offset, limit } = getPageRange(page, pageSize);
  let query = supabase.from("notifications")
    .select("id, type, lesson_id, title_key, body_key, data, is_read, created_at", { count: "exact" })
    .gte("created_at", retentionCutoff())
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (unreadOnly) query = query.eq("is_read", false);
  return query;
};

export const countUnreadNotifications = () =>
  supabase.from("notifications").select("id", { head: true, count: "exact" })
    .gte("created_at", retentionCutoff()).eq("is_read", false);

export const hasUnreadNotifications = async () => {
  await reconcileExpiredLearningPauses();
  return supabase.from("notifications").select("id")
    .gte("created_at", retentionCutoff()).eq("is_read", false).limit(1);
};

export const markNotificationRead = (notificationId) =>
  supabase.rpc("mark_notification_read", { p_notification_id: notificationId });

export const markAllNotificationsRead = () =>
  supabase.rpc("mark_all_notifications_read");
