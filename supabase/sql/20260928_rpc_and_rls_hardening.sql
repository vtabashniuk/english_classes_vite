-- Review/apply after the refactored frontend has been deployed and smoke-tested.
-- This does not change data. It narrows client mutation paths and RPC exposure.

begin;

-- Business-critical schedule mutations already go through SECURITY DEFINER RPCs.
-- Keep client reads through RLS, but prevent bypassing RPC business rules with
-- direct PostgREST INSERT/UPDATE calls.
drop policy if exists "Teacher can create lessons" on public.lessons;
drop policy if exists "Teacher can update lessons" on public.lessons;

drop policy if exists "Teacher can create recurring lessons" on public.recurring_lessons;
drop policy if exists "Teacher can update recurring lessons" on public.recurring_lessons;

-- Settings are updated through update_my_teacher_settings().
drop policy if exists "Teacher can update own settings" on public.teacher_settings;

-- Anonymous users do not need application RPC execution. Authenticated callers
-- remain explicitly authorized by grants plus each function's own checks.
revoke execute on function public.approve_lesson_request(uuid) from anon;
revoke execute on function public.cancel_extra_lesson_request(uuid) from anon;
revoke execute on function public.cancel_lesson(uuid, text) from anon;
revoke execute on function public.cancel_recurring_series_from_lesson(uuid) from anon;
revoke execute on function public.complete_assignment(uuid) from anon;
revoke execute on function public.complete_lesson(uuid) from anon;
revoke execute on function public.create_assignment(uuid, text, text, date, uuid, uuid[]) from anon;
revoke execute on function public.create_extra_lesson_request(timestamptz, text) from anon;
revoke execute on function public.create_lesson(uuid, date, time, text) from anon;
revoke execute on function public.create_recurring_lesson(uuid, smallint, time, date, date, text, smallint) from anon;
revoke execute on function public.create_recurring_lesson_with_generation(uuid, smallint, time, date, date, text, smallint, smallint) from anon;
revoke execute on function public.edit_recurring_series_from_lesson(uuid, smallint, time, smallint, date, text, smallint) from anon;
revoke execute on function public.generate_recurring_lessons(uuid, date) from anon;
revoke execute on function public.get_extra_lesson_availability(date) from anon;
revoke execute on function public.mark_all_notifications_read() from anon;
revoke execute on function public.mark_notification_read(uuid) from anon;
revoke execute on function public.reject_lesson_request(uuid, text) from anon;
revoke execute on function public.resolve_my_teacher_id() from anon;
revoke execute on function public.set_lesson_outcome(uuid, public.lesson_status) from anon;
revoke execute on function public.share_material_with_student(uuid, uuid) from anon;
revoke execute on function public.update_assignment(uuid, uuid, text, text, date, uuid, uuid[]) from anon;
revoke execute on function public.update_lesson_zoom(uuid, text) from anon;
revoke execute on function public.update_my_profile(text, text, text) from anon;
revoke execute on function public.update_my_teacher_settings(text, time, time, smallint) from anon;

-- Internal helpers are not called by the frontend. Their owning SECURITY DEFINER
-- functions can call them without exposing them as public client RPC endpoints.
revoke execute on function public.check_recurring_lesson_conflict(uuid, smallint, time, date, date) from anon, authenticated;
revoke execute on function public.create_recurring_lesson(uuid, smallint, time, date, date, text, smallint) from authenticated;
revoke execute on function public.generate_recurring_lessons(uuid, date) from authenticated;
revoke execute on function public.resolve_my_teacher_id() from authenticated;

commit;
