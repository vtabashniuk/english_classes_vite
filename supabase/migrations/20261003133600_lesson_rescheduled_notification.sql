-- Notify a student when a one-off scheduled lesson is actually moved.
-- Price snapshot fields are intentionally untouched. A Zoom-only edit does not
-- create a reschedule notification because starts_at remains unchanged.

create or replace function public.update_lesson_schedule(
  p_lesson_id uuid,
  p_lesson_date date,
  p_start_time time without time zone,
  p_zoom_url text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_lesson public.lessons%rowtype;
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_is_working boolean;
  v_slot_interval integer;
  v_duration integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select l.*
  into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_lesson.status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;

  if v_lesson.starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_EDITED';
  end if;

  if v_lesson.recurring_lesson_id is not null then
    raise exception 'RECURRING_LESSON_REQUIRES_SERIES_EDIT';
  end if;

  if exists (
    select 1
    from public.lesson_cancellation_requests r
    where r.lesson_id = p_lesson_id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_PENDING';
  end if;

  select
    ts.schedule_timezone,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  select
    wh.is_working,
    wh.workday_start,
    wh.workday_end
  into
    v_is_working,
    v_workday_start,
    v_workday_end
  from public.teacher_working_hours wh
  where wh.teacher_id = v_teacher_id
    and wh.weekday = extract(isodow from p_lesson_date)::integer;

  if not found or not v_is_working then
    raise exception 'NON_WORKING_DAY';
  end if;

  v_duration := v_lesson.duration_minutes;

  v_minutes_from_midnight :=
      extract(hour from p_start_time)::integer * 60
    + extract(minute from p_start_time)::integer;

  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0
     or extract(second from p_start_time) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  if p_start_time < v_workday_start
     or p_lesson_date + p_start_time + make_interval(mins => v_duration)
        > p_lesson_date + v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_starts_at := (p_lesson_date::timestamp + p_start_time) at time zone v_timezone;
  v_ends_at := v_starts_at + make_interval(mins => v_duration);

  if v_starts_at <= now() then
    raise exception 'LESSON_IN_PAST';
  end if;

  if exists (
    select 1
    from public.lessons l
    where l.id <> p_lesson_id
      and l.status <> 'cancelled'::public.lesson_status
      and (l.teacher_id = v_teacher_id or l.student_id = v_lesson.student_id)
      and l.starts_at < v_ends_at
      and l.ends_at > v_starts_at
  ) then
    raise exception 'LESSON_TIME_CONFLICT';
  end if;

  update public.lessons
  set
    starts_at = v_starts_at,
    ends_at = v_ends_at,
    zoom_url = nullif(btrim(p_zoom_url), ''),
    updated_at = now()
  where id = p_lesson_id;

  if v_lesson.starts_at is distinct from v_starts_at then
    insert into public.notifications (
      user_id,
      type,
      lesson_id,
      title_key,
      body_key,
      data
    )
    values (
      v_lesson.student_id,
      'lesson_rescheduled'::public.notification_type,
      p_lesson_id,
      'notifications.lessonRescheduled.title',
      'notifications.lessonRescheduled.body',
      jsonb_build_object(
        'lessonId', p_lesson_id,
        'oldStartsAt', v_lesson.starts_at,
        'startsAt', v_starts_at,
        'durationMinutes', v_duration
      )
    );
  end if;
exception
  when exclusion_violation then
    raise exception 'LESSON_TIME_CONFLICT';
end;
$function$;
