-- Reduce the exposed Data API surface.
-- The browser receives only the table privileges and RPC EXECUTE grants it uses.

begin;

-- Anonymous users do not read or mutate application tables.
revoke all on table public.profiles from anon;
revoke all on table public.teacher_settings from anon;
revoke all on table public.teacher_students from anon;
revoke all on table public.lessons from anon;
revoke all on table public.recurring_lessons from anon;
revoke all on table public.lesson_requests from anon;
revoke all on table public.notifications from anon;
revoke all on table public.materials from anon;
revoke all on table public.student_materials from anon;
revoke all on table public.assignments from anon;
revoke all on table public.assignment_materials from anon;

-- Start authenticated clients from a read-only table surface.
revoke all on table public.profiles from authenticated;
revoke all on table public.teacher_settings from authenticated;
revoke all on table public.teacher_students from authenticated;
revoke all on table public.lessons from authenticated;
revoke all on table public.recurring_lessons from authenticated;
revoke all on table public.lesson_requests from authenticated;
revoke all on table public.notifications from authenticated;
revoke all on table public.materials from authenticated;
revoke all on table public.student_materials from authenticated;
revoke all on table public.assignments from authenticated;
revoke all on table public.assignment_materials from authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.teacher_settings to authenticated;
grant select on table public.teacher_students to authenticated;
grant select on table public.lessons to authenticated;
grant select on table public.recurring_lessons to authenticated;
grant select on table public.lesson_requests to authenticated;
grant select on table public.notifications to authenticated;
grant select on table public.materials to authenticated;
grant select on table public.student_materials to authenticated;
grant select on table public.assignments to authenticated;
grant select on table public.assignment_materials to authenticated;

-- Materials are the only current domain object intentionally mutated directly
-- through PostgREST. RLS still limits those writes to the owning teacher.
grant insert, update, delete on table public.materials to authenticated;

-- Revoke browser execution from every application function first. SECURITY
-- DEFINER helpers remain callable by their owning RPCs after this revoke.
revoke execute on function public.approve_lesson_request(uuid)
  from public, anon, authenticated;
revoke execute on function public.cancel_extra_lesson_request(uuid)
  from public, anon, authenticated;
revoke execute on function public.cancel_lesson(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.cancel_recurring_series_from_lesson(uuid)
  from public, anon, authenticated;
revoke execute on function public.check_recurring_lesson_conflict(uuid, smallint, time, date, date)
  from public, anon, authenticated;
revoke execute on function public.complete_assignment(uuid)
  from public, anon, authenticated;
revoke execute on function public.complete_lesson(uuid)
  from public, anon, authenticated;
revoke execute on function public.create_assignment(uuid, text, text, date, uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.create_extra_lesson_request(timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.create_lesson(uuid, date, time, text)
  from public, anon, authenticated;
revoke execute on function public.create_recurring_lesson(uuid, smallint, time, date, date, text, smallint)
  from public, anon, authenticated;
revoke execute on function public.create_recurring_lesson_with_generation(uuid, smallint, time, date, date, text, smallint, smallint)
  from public, anon, authenticated;
revoke execute on function public.edit_recurring_series_from_lesson(uuid, smallint, time, smallint, date, text, smallint)
  from public, anon, authenticated;
revoke execute on function public.generate_recurring_lessons(uuid, date)
  from public, anon, authenticated;
revoke execute on function public.get_extra_lesson_availability(date)
  from public, anon, authenticated;
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
revoke execute on function public.is_teacher()
  from public, anon, authenticated;
revoke execute on function public.is_my_student(uuid)
  from public, anon, authenticated;
revoke execute on function public.is_my_active_student(uuid)
  from public, anon, authenticated;
revoke execute on function public.is_my_material(uuid)
  from public, anon, authenticated;
revoke execute on function public.mark_all_notifications_read()
  from public, anon, authenticated;
revoke execute on function public.mark_notification_read(uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_lesson_request(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.resolve_my_teacher_id()
  from public, anon, authenticated;
revoke execute on function public.set_lesson_outcome(uuid, public.lesson_status)
  from public, anon, authenticated;
revoke execute on function public.share_material_with_student(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.update_assignment(uuid, uuid, text, text, date, uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.update_lesson_zoom(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.update_my_profile(text, text, text)
  from public, anon, authenticated;
revoke execute on function public.update_my_teacher_settings(text, time, time, smallint)
  from public, anon, authenticated;
revoke execute on function public.validate_teacher_student_relationship()
  from public, anon, authenticated;

-- RLS helper functions need EXECUTE for authenticated users because policies
-- call them while evaluating Data API queries.
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.is_my_student(uuid) to authenticated;
grant execute on function public.is_my_material(uuid) to authenticated;

-- Public application RPC surface used by the current frontend.
grant execute on function public.approve_lesson_request(uuid) to authenticated;
grant execute on function public.cancel_extra_lesson_request(uuid) to authenticated;
grant execute on function public.cancel_lesson(uuid, text) to authenticated;
grant execute on function public.cancel_recurring_series_from_lesson(uuid) to authenticated;
grant execute on function public.complete_assignment(uuid) to authenticated;
grant execute on function public.create_assignment(uuid, text, text, date, uuid, uuid[]) to authenticated;
grant execute on function public.create_extra_lesson_request(timestamptz, text) to authenticated;
grant execute on function public.create_lesson(uuid, date, time, text) to authenticated;
grant execute on function public.create_recurring_lesson_with_generation(uuid, smallint, time, date, date, text, smallint, smallint) to authenticated;
grant execute on function public.edit_recurring_series_from_lesson(uuid, smallint, time, smallint, date, text, smallint) to authenticated;
grant execute on function public.get_extra_lesson_availability(date) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.reject_lesson_request(uuid, text) to authenticated;
grant execute on function public.set_lesson_outcome(uuid, public.lesson_status) to authenticated;
grant execute on function public.share_material_with_student(uuid, uuid) to authenticated;
grant execute on function public.update_assignment(uuid, uuid, text, text, date, uuid, uuid[]) to authenticated;
grant execute on function public.update_lesson_zoom(uuid, text) to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.update_my_teacher_settings(text, time, time, smallint) to authenticated;

-- Keep service-role access explicit for server-side maintenance and Edge Functions.
grant execute on function public.approve_lesson_request(uuid) to service_role;
grant execute on function public.cancel_extra_lesson_request(uuid) to service_role;
grant execute on function public.cancel_lesson(uuid, text) to service_role;
grant execute on function public.cancel_recurring_series_from_lesson(uuid) to service_role;
grant execute on function public.check_recurring_lesson_conflict(uuid, smallint, time, date, date) to service_role;
grant execute on function public.complete_assignment(uuid) to service_role;
grant execute on function public.complete_lesson(uuid) to service_role;
grant execute on function public.create_assignment(uuid, text, text, date, uuid, uuid[]) to service_role;
grant execute on function public.create_extra_lesson_request(timestamptz, text) to service_role;
grant execute on function public.create_lesson(uuid, date, time, text) to service_role;
grant execute on function public.create_recurring_lesson(uuid, smallint, time, date, date, text, smallint) to service_role;
grant execute on function public.create_recurring_lesson_with_generation(uuid, smallint, time, date, date, text, smallint, smallint) to service_role;
grant execute on function public.edit_recurring_series_from_lesson(uuid, smallint, time, smallint, date, text, smallint) to service_role;
grant execute on function public.generate_recurring_lessons(uuid, date) to service_role;
grant execute on function public.get_extra_lesson_availability(date) to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.is_teacher() to service_role;
grant execute on function public.is_my_student(uuid) to service_role;
grant execute on function public.is_my_active_student(uuid) to service_role;
grant execute on function public.is_my_material(uuid) to service_role;
grant execute on function public.mark_all_notifications_read() to service_role;
grant execute on function public.mark_notification_read(uuid) to service_role;
grant execute on function public.reject_lesson_request(uuid, text) to service_role;
grant execute on function public.resolve_my_teacher_id() to service_role;
grant execute on function public.set_lesson_outcome(uuid, public.lesson_status) to service_role;
grant execute on function public.share_material_with_student(uuid, uuid) to service_role;
grant execute on function public.update_assignment(uuid, uuid, text, text, date, uuid, uuid[]) to service_role;
grant execute on function public.update_lesson_zoom(uuid, text) to service_role;
grant execute on function public.update_my_profile(text, text, text) to service_role;
grant execute on function public.update_my_teacher_settings(text, time, time, smallint) to service_role;
grant execute on function public.validate_teacher_student_relationship() to service_role;

-- New database functions created by future migrations are private by default.
-- Explicitly grant EXECUTE only when a function is part of the browser API.
alter default privileges in schema public
  revoke execute on functions from public;

commit;
