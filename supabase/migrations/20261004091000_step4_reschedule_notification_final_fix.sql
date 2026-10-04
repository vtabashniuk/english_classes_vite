-- Step 4 final fix: keep student reschedule requests in Requests only and
-- include the actual lesson price snapshot in notifications after a move.
--
-- The final price is read from UPDATE ... RETURNING after the Step 3
-- reschedule-price trigger has applied keep_original / target_date_tariff.

create or replace function public.create_lesson_reschedule_request(
  p_lesson_id uuid,
  p_requested_starts_at timestamptz,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_lesson public.lessons%rowtype;
  v_notice_hours smallint := 6;
  v_minutes_before_start integer;
  v_request_id uuid;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  select l.* into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.student_id = v_student_id
  for update;

  if not found then raise exception 'LESSON_NOT_FOUND'; end if;
  if v_lesson.status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;
  if v_lesson.starts_at <= now() then raise exception 'LESSON_ALREADY_STARTED'; end if;

  select coalesce(ts.free_cancellation_hours, 6)
  into v_notice_hours
  from public.teacher_settings ts
  where ts.teacher_id = v_lesson.teacher_id;
  v_notice_hours := coalesce(v_notice_hours, 6);

  v_minutes_before_start := greatest(
    floor(extract(epoch from (v_lesson.starts_at - now())) / 60)::integer,
    0
  );
  if v_minutes_before_start < v_notice_hours::integer * 60 then
    raise exception 'RESCHEDULE_WINDOW_CLOSED';
  end if;

  if exists (
    select 1 from public.lesson_cancellation_requests r
    where r.lesson_id = v_lesson.id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_PENDING';
  end if;

  if exists (
    select 1 from public.lesson_requests r
    where r.request_type = 'reschedule'::public.lesson_request_type
      and r.lesson_id = v_lesson.id
      and r.status = 'pending'::public.lesson_request_status
  ) then
    raise exception 'RESCHEDULE_REQUEST_PENDING';
  end if;

  if not public.is_lesson_reschedule_target_available(
    v_lesson.id,
    p_requested_starts_at
  ) then
    raise exception 'RESCHEDULE_TARGET_UNAVAILABLE';
  end if;

  insert into public.lesson_requests (
    request_type,
    lesson_id,
    original_starts_at,
    reschedule_notice_hours_snapshot,
    student_id,
    teacher_id,
    requested_starts_at,
    duration_minutes,
    message,
    status
  ) values (
    'reschedule'::public.lesson_request_type,
    v_lesson.id,
    v_lesson.starts_at,
    v_notice_hours,
    v_lesson.student_id,
    v_lesson.teacher_id,
    p_requested_starts_at,
    v_lesson.duration_minutes,
    nullif(btrim(p_message), ''),
    'pending'::public.lesson_request_status
  ) returning id into v_request_id;


  return v_request_id;
end;
$function$;

revoke all on function public.create_lesson_reschedule_request(uuid, timestamptz, text)
  from public, anon;
grant execute on function public.create_lesson_reschedule_request(uuid, timestamptz, text)
  to authenticated, service_role;

create or replace function public.approve_lesson_reschedule_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_request public.lesson_requests%rowtype;
  v_lesson public.lessons%rowtype;
  v_updated_lesson public.lessons%rowtype;
  v_new_ends_at timestamptz;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select * into v_request
  from public.lesson_requests r
  where r.id = p_request_id
  for update;

  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_request.request_type <> 'reschedule'::public.lesson_request_type then
    raise exception 'INVALID_REQUEST_TYPE';
  end if;
  if v_request.teacher_id <> v_teacher_id then raise exception 'FORBIDDEN'; end if;
  if v_request.status <> 'pending'::public.lesson_request_status then
    raise exception 'REQUEST_ALREADY_RESOLVED';
  end if;

  select l.* into v_lesson
  from public.lessons l
  where l.id = v_request.lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then raise exception 'LESSON_NOT_FOUND'; end if;
  if v_lesson.status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;
  if v_lesson.starts_at <= now() then raise exception 'LESSON_ALREADY_STARTED'; end if;
  if v_lesson.starts_at is distinct from v_request.original_starts_at then
    raise exception 'RESCHEDULE_REQUEST_STALE';
  end if;

  if exists (
    select 1 from public.lesson_cancellation_requests r
    where r.lesson_id = v_lesson.id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_PENDING';
  end if;

  if not public.is_lesson_reschedule_target_available(
    v_lesson.id,
    v_request.requested_starts_at
  ) then
    raise exception 'RESCHEDULE_TARGET_UNAVAILABLE';
  end if;

  v_new_ends_at := v_request.requested_starts_at
    + make_interval(mins => v_lesson.duration_minutes);

  -- Resolve the request first. The lesson-update guard below allows the actual
  -- move because no pending reschedule request remains in this transaction.
  update public.lesson_requests
  set status = 'approved'::public.lesson_request_status,
      resolved_at = now(),
      resolved_by = v_teacher_id
  where id = v_request.id;

  update public.lessons
  set starts_at = v_request.requested_starts_at,
      ends_at = v_new_ends_at,
      updated_at = now()
  where id = v_lesson.id
  returning * into v_updated_lesson;

  insert into public.notifications (
    user_id, type, lesson_id, title_key, body_key, data
  ) values (
    v_lesson.student_id,
    'lesson_rescheduled'::public.notification_type,
    v_lesson.id,
    'notifications.lessonRescheduleRequestApproved.title',
    'notifications.lessonRescheduleRequestApproved.body',
    jsonb_build_object(
      'requestId', v_request.id,
      'lessonId', v_lesson.id,
      'oldStartsAt', v_lesson.starts_at,
      'startsAt', v_request.requested_starts_at,
      'durationMinutes', v_lesson.duration_minutes,
      'oldPriceAmountMinor', v_lesson.price_amount_minor,
      'oldPriceCurrency', v_lesson.price_currency,
      'priceAmountMinor', v_updated_lesson.price_amount_minor,
      'priceCurrency', v_updated_lesson.price_currency,
      'reschedulePricePolicyApplied', v_updated_lesson.reschedule_price_policy_applied
    )
  );

  return v_lesson.id;
exception
  when exclusion_violation then
    raise exception 'RESCHEDULE_TARGET_UNAVAILABLE';
end;
$function$;

revoke all on function public.approve_lesson_reschedule_request(uuid)
  from public, anon;
grant execute on function public.approve_lesson_reschedule_request(uuid)
  to authenticated, service_role;

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
  v_updated_lesson public.lessons%rowtype;
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
  v_target_local_date date;
  v_reserved_any boolean;
  v_reserved_other_series boolean;
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

  if exists (
    select 1
    from public.lesson_cancellation_requests r
    where r.lesson_id = p_lesson_id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_PENDING';
  end if;

  if exists (
    select 1
    from public.lesson_requests r
    where r.request_type = 'reschedule'::public.lesson_request_type
      and r.lesson_id = p_lesson_id
      and r.status = 'pending'::public.lesson_request_status
  ) then
    raise exception 'RESCHEDULE_REQUEST_PENDING';
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

  if v_lesson.starts_at is distinct from v_starts_at then
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

    -- Recurring rules reserve their time even beyond the materialized horizon.
    -- A recurring occurrence may move within its own original occurrence date
    -- (the old slot then becomes an explicit exception), but it may not be
    -- moved onto another occurrence of the same series or onto another series.
    v_reserved_any := public.is_teacher_recurring_lesson_reserved(
      v_teacher_id,
      v_starts_at,
      v_ends_at,
      null
    );

    if v_reserved_any then
      if v_lesson.recurring_lesson_id is null then
        raise exception 'LESSON_TIME_CONFLICT';
      end if;

      v_reserved_other_series := public.is_teacher_recurring_lesson_reserved(
        v_teacher_id,
        v_starts_at,
        v_ends_at,
        v_lesson.recurring_lesson_id
      );

      if v_reserved_other_series then
        raise exception 'LESSON_TIME_CONFLICT';
      end if;

      v_target_local_date := (v_starts_at at time zone v_timezone)::date;

      if v_lesson.occurrence_date is null
         or v_target_local_date <> v_lesson.occurrence_date then
        raise exception 'LESSON_TIME_CONFLICT';
      end if;
    end if;
  end if;

  update public.lessons
  set
    starts_at = v_starts_at,
    ends_at = v_ends_at,
    zoom_url = nullif(btrim(p_zoom_url), ''),
    updated_at = now()
  where id = p_lesson_id
  returning * into v_updated_lesson;

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
        'durationMinutes', v_duration,
        'oldPriceAmountMinor', v_lesson.price_amount_minor,
        'oldPriceCurrency', v_lesson.price_currency,
        'priceAmountMinor', v_updated_lesson.price_amount_minor,
        'priceCurrency', v_updated_lesson.price_currency,
        'reschedulePricePolicyApplied', v_updated_lesson.reschedule_price_policy_applied
      )
    );
  end if;
exception
  when exclusion_violation then
    raise exception 'LESSON_TIME_CONFLICT';
end;
$function$;

revoke all on function public.update_lesson_schedule(
  uuid, date, time without time zone, text
) from public, anon;
grant execute on function public.update_lesson_schedule(
  uuid, date, time without time zone, text
) to authenticated, service_role;
