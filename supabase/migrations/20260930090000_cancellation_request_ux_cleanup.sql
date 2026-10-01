-- Cancellation-request UX cleanup.
--
-- Rules:
--   * cancellation requests live in the Requests workflow, not Notifications;
--   * students can preview whether a cancellation is late before submitting it;
--   * the preview uses server time and the teacher's saved cancellation window,
--     so it matches the classification used by request_lesson_cancellation().

begin;

-- Existing request notifications are redundant because the same actionable item
-- is already available on the teacher Requests page.
delete from public.notifications
where type = 'lesson_cancellation_requested'::public.notification_type;

-- Prevent future cancellation-request workflow notifications from being written.
-- Outcome notifications (lesson_cancelled, lesson_status_changed, etc.) are not
-- affected and remain available in Notifications.
create or replace function public.suppress_lesson_cancellation_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.type = 'lesson_cancellation_requested'::public.notification_type then
    return null;
  end if;

  return new;
end;
$function$;

drop trigger if exists suppress_lesson_cancellation_request_notification
  on public.notifications;

create trigger suppress_lesson_cancellation_request_notification
before insert on public.notifications
for each row
execute function public.suppress_lesson_cancellation_request_notification();

revoke all on function public.suppress_lesson_cancellation_request_notification()
  from public, anon, authenticated;
grant execute on function public.suppress_lesson_cancellation_request_notification()
  to service_role;

-- Read-only server-side preview used by StudentSchedule before the student sends
-- a cancellation request. No data is changed here.
create or replace function public.preview_lesson_cancellation(
  p_lesson_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid;
  v_lesson public.lessons%rowtype;
  v_free_hours smallint := 6;
  v_minutes_before_start integer;
  v_is_late boolean;
begin
  v_student_id := auth.uid();

  if v_student_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if public.is_teacher() then
    raise exception 'STUDENT_REQUIRED';
  end if;

  select l.*
  into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.student_id = v_student_id;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_lesson.status = 'cancelled'::public.lesson_status then
    raise exception 'LESSON_ALREADY_CANCELLED';
  end if;

  if v_lesson.status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;

  if v_lesson.starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_CANCELLED';
  end if;

  if exists (
    select 1
    from public.lesson_cancellation_requests r
    where r.lesson_id = p_lesson_id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_ALREADY_PENDING';
  end if;

  select coalesce(ts.free_cancellation_hours, 6)
  into v_free_hours
  from public.teacher_settings ts
  where ts.teacher_id = v_lesson.teacher_id;

  v_free_hours := coalesce(v_free_hours, 6);
  v_minutes_before_start := greatest(
    floor(extract(epoch from (v_lesson.starts_at - now())) / 60)::integer,
    0
  );
  v_is_late := v_minutes_before_start < (v_free_hours::integer * 60);

  return jsonb_build_object(
    'lessonId', v_lesson.id,
    'startsAt', v_lesson.starts_at,
    'freeCancellationHours', v_free_hours,
    'minutesBeforeStart', v_minutes_before_start,
    'isLate', v_is_late,
    'priceAmountMinor', v_lesson.price_amount_minor,
    'priceCurrency', v_lesson.price_currency
  );
end;
$function$;

revoke all on function public.preview_lesson_cancellation(uuid)
  from public, anon;
grant execute on function public.preview_lesson_cancellation(uuid)
  to authenticated, service_role;

commit;
