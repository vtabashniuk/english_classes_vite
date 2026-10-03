import { supabase } from "../../../shared/api/supabaseClient";

export const listMyScheduleBlocksForRange = ({ startIso, endIso }) =>
  supabase
    .from("teacher_schedule_blocks")
    .select(
      "id, starts_at, ends_at, reason, recurring_block_series_id, created_at, updated_at",
    )
    .eq("is_cancelled", false)
    .lt("starts_at", endIso)
    .gt("ends_at", startIso)
    .order("starts_at", { ascending: true });

export const createScheduleBlock = ({
  blockDate,
  startTime,
  endTime,
  reason,
}) =>
  supabase.rpc("create_teacher_schedule_block", {
    p_block_date: blockDate,
    p_start_time: startTime,
    p_end_time: endTime,
    p_reason: reason,
  });

export const updateScheduleBlock = ({
  blockId,
  blockDate,
  startTime,
  endTime,
  reason,
}) =>
  supabase.rpc("update_teacher_schedule_block", {
    p_block_id: blockId,
    p_block_date: blockDate,
    p_start_time: startTime,
    p_end_time: endTime,
    p_reason: reason,
  });

export const deleteScheduleBlock = (blockId) =>
  supabase.rpc("delete_teacher_schedule_block", {
    p_block_id: blockId,
  });

export const getRecurringScheduleBlockSeriesById = (seriesId) =>
  supabase
    .from("teacher_schedule_block_series")
    .select(
      "weekday, start_time, end_time, interval_weeks, valid_until, reason",
    )
    .eq("id", seriesId)
    .single();

export const createRecurringScheduleBlockWithGeneration = (payload) =>
  supabase.rpc("create_recurring_schedule_block_with_generation", payload);

export const editRecurringScheduleBlockSeriesFromBlock = (payload) =>
  supabase.rpc("edit_recurring_schedule_block_series_from_block", payload);

export const cancelRecurringScheduleBlockSeriesFromBlock = (blockId) =>
  supabase.rpc("cancel_recurring_schedule_block_series_from_block", {
    p_block_id: blockId,
  });

export const listTeacherProjectedRecurringBlocksForRange = ({
  fromDate,
  untilDate,
}) =>
  supabase.rpc("get_teacher_projected_recurring_blocks", {
    p_from: fromDate,
    p_until: untilDate,
  });
