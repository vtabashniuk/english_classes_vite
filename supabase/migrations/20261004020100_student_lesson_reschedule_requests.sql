begin;

-- Step 4: student request to move an existing lesson.
-- Extra lesson and cancellation flows remain separate.

-- ---------------------------------------------------------------------------
-- 1. Data model.
-- ---------------------------------------------------------------------------

alter table public.lesson_requests
  add column if not exists lesson_id uuid,
  add column if not exists original_starts_at timestamptz,
  add column if not exists reschedule_notice_hours_snapshot smallint;

alter table public.lesson_requests
  drop constraint if exists lesson_requests_lesson_id_fkey;
alter table public.lesson_requests
  add constraint lesson_requests_lesson_id_fkey
  foreign key (lesson_id) references public.lessons(id) on delete cascade;

alter table public.lesson_requests
  drop constraint if exists lesson_requests_reschedule_notice_hours_check;
alter table public.lesson_requests
  add constraint lesson_requests_reschedule_notice_hours_check
  check (
    reschedule_notice_hours_snapshot is null
    or reschedule_notice_hours_snapshot between 1 and 168
  );

alter table public.lesson_requests
  drop constraint if exists lesson_requests_request_shape_check;
alter table public.lesson_requests
  add constraint lesson_requests_request_shape_check
  check (
    (
      request_type = 'extra_lesson'::public.lesson_request_type
      and lesson_id is null
      and original_starts_at is null
      and reschedule_notice_hours_snapshot is null
    )
    or
    (
      request_type = 'reschedule'::public.lesson_request_type
      and lesson_id is not null
      and original_starts_at is not null
      and reschedule_notice_hours_snapshot is not null
      and created_lesson_id is null
    )
  );

create unique index if not exists lesson_requests_one_pending_reschedule_per_lesson_idx
  on public.lesson_requests (lesson_id)
  where request_type = 'reschedule'::public.lesson_request_type
    and status = 'pending'::public.lesson_request_status;

create index if not exists lesson_requests_teacher_type_status_idx
  on public.lesson_requests (teacher_id, request_type, status, created_at desc);

comment on column public.lesson_requests.lesson_id is
  'Existing lesson targeted by a reschedule request. NULL for extra_lesson requests.';
comment on column public.lesson_requests.original_starts_at is
  'Snapshot of the lesson start when the reschedule request was created. Used to detect stale requests.';
comment on column public.lesson_requests.reschedule_notice_hours_snapshot is
  'Minimum notice window that applied when the student created the reschedule request.';

-- ---------------------------------------------------------------------------
-- 2. Shared target-slot validator.
--    This is intentionally internal: public RPCs apply actor / request rules.
-- ---------------------------------------------------------------------------

create or replace function public.is_lesson_reschedule_target_available(
  p_lesson_id uuid,
  p_requested_starts_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_lesson public.lessons%rowtype;
  v_timezone text;
  v_slot_interval smallint;
  v_is_working boolean;
  v_workday_start time;
  v_workday_end time;
  v_local_start timestamp;
  v_local_date date;
  v_local_time time;
  v_requested_end timestamptz;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
  v_reserved_any boolean;
  v_reserved_other_series boolean;
begin
  select l.* into v_lesson
  from public.lessons l
  where l.id = p_lesson_id;

  if not found
     or v_lesson.status <> 'scheduled'::public.lesson_status
     or p_requested_starts_at is null
     or p_requested_starts_at <= now()
     or p_requested_starts_at = v_lesson.starts_at then
    return false;
  end if;

  select ts.schedule_timezone, ts.slot_interval_minutes
  into v_timezone, v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_lesson.teacher_id;

  if not found then return false; end if;

  v_local_start := p_requested_starts_at at time zone v_timezone;
  v_local_date := v_local_start::date;
  v_local_time := v_local_start::time;
  v_requested_end := p_requested_starts_at
    + make_interval(mins => v_lesson.duration_minutes);

  select wh.is_working, wh.workday_start, wh.workday_end
  into v_is_working, v_workday_start, v_workday_end
  from public.teacher_working_hours wh
  where wh.teacher_id = v_lesson.teacher_id
    and wh.weekday = extract(isodow from v_local_date)::integer;

  if not found or not v_is_working then return false; end if;

  if v_local_time < v_workday_start
     or v_local_date + v_local_time + make_interval(mins => v_lesson.duration_minutes)
        > v_local_date + v_workday_end then
    return false;
  end if;

  v_minutes_from_midnight :=
      extract(hour from v_local_time)::integer * 60
    + extract(minute from v_local_time)::integer;
  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0
     or extract(second from v_local_time) <> 0 then
    return false;
  end if;

  if exists (
    select 1
    from public.lessons l
    where l.id <> v_lesson.id
      and l.status <> 'cancelled'::public.lesson_status
      and (l.teacher_id = v_lesson.teacher_id or l.student_id = v_lesson.student_id)
      and l.starts_at < v_requested_end
      and l.ends_at > p_requested_starts_at
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.teacher_schedule_blocks b
    where b.teacher_id = v_lesson.teacher_id
      and not b.is_cancelled
      and b.starts_at < v_requested_end
      and b.ends_at > p_requested_starts_at
  ) or public.is_teacher_recurring_blocked(
    v_lesson.teacher_id,
    p_requested_starts_at,
    v_requested_end,
    null
  ) then
    return false;
  end if;

  -- Recurring lessons reserve their rule even beyond the materialized horizon.
  -- The occurrence being moved may overlap its OWN original rule on the same
  -- occurrence date; after the move that original occurrence becomes an
  -- explicit exception. Other recurring-series reservations still block it.
  v_reserved_any := public.is_teacher_recurring_lesson_reserved(
    v_lesson.teacher_id,
    p_requested_starts_at,
    v_requested_end,
    null
  );

  if v_reserved_any then
    if v_lesson.recurring_lesson_id is null then
      return false;
    end if;

    v_reserved_other_series := public.is_teacher_recurring_lesson_reserved(
      v_lesson.teacher_id,
      p_requested_starts_at,
      v_requested_end,
      v_lesson.recurring_lesson_id
    );

    if v_reserved_other_series then
      return false;
    end if;

    if v_lesson.occurrence_date is null
       or v_local_date <> v_lesson.occurrence_date then
      return false;
    end if;
  end if;

  -- A student's own pending requests should not be allowed to overlap each
  -- other. Competing requests from different students remain soft requests;
  -- teacher approval performs the final availability check.
  if exists (
    select 1
    from public.lesson_requests r
    where r.student_id = v_lesson.student_id
      and r.status = 'pending'::public.lesson_request_status
      and not (
        r.request_type = 'reschedule'::public.lesson_request_type
        and r.lesson_id = v_lesson.id
      )
      and r.requested_starts_at < v_requested_end
      and r.requested_starts_at + make_interval(mins => r.duration_minutes)
          > p_requested_starts_at
  ) then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function public.is_lesson_reschedule_target_available(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.is_lesson_reschedule_target_available(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Student preview + target availability.
-- ---------------------------------------------------------------------------

create or replace function public.preview_lesson_reschedule(p_lesson_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_lesson public.lessons%rowtype;
  v_notice_hours smallint := 6;
  v_minutes_before_start integer;
  v_reason text := null;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  select l.* into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.student_id = v_student_id;

  if not found then raise exception 'LESSON_NOT_FOUND'; end if;

  select coalesce(ts.free_cancellation_hours, 6)
  into v_notice_hours
  from public.teacher_settings ts
  where ts.teacher_id = v_lesson.teacher_id;
  v_notice_hours := coalesce(v_notice_hours, 6);

  v_minutes_before_start := greatest(
    floor(extract(epoch from (v_lesson.starts_at - now())) / 60)::integer,
    0
  );

  if v_lesson.status <> 'scheduled'::public.lesson_status then
    v_reason := 'LESSON_NOT_SCHEDULED';
  elsif v_lesson.starts_at <= now() then
    v_reason := 'LESSON_ALREADY_STARTED';
  elsif v_minutes_before_start < v_notice_hours::integer * 60 then
    v_reason := 'RESCHEDULE_WINDOW_CLOSED';
  elsif exists (
    select 1 from public.lesson_cancellation_requests r
    where r.lesson_id = v_lesson.id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    v_reason := 'CANCELLATION_REQUEST_PENDING';
  elsif exists (
    select 1 from public.lesson_requests r
    where r.request_type = 'reschedule'::public.lesson_request_type
      and r.lesson_id = v_lesson.id
      and r.status = 'pending'::public.lesson_request_status
  ) then
    v_reason := 'RESCHEDULE_REQUEST_PENDING';
  end if;

  return jsonb_build_object(
    'canRequest', v_reason is null,
    'reason', v_reason,
    'noticeHours', v_notice_hours,
    'minutesBeforeStart', v_minutes_before_start,
    'startsAt', v_lesson.starts_at,
    'durationMinutes', v_lesson.duration_minutes
  );
end;
$function$;

revoke all on function public.preview_lesson_reschedule(uuid) from public, anon;
grant execute on function public.preview_lesson_reschedule(uuid)
  to authenticated, service_role;

create or replace function public.get_lesson_reschedule_availability(
  p_lesson_id uuid,
  p_date date
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  schedule_timezone text,
  duration_minutes smallint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_lesson public.lessons%rowtype;
  v_timezone text;
  v_slot_interval smallint;
  v_is_working boolean;
  v_workday_start time;
  v_workday_end time;
  v_local_day_start timestamp;
  v_local_last_start timestamp;
  v_notice_hours smallint := 6;
  v_minutes_before_start integer;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  select l.* into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.student_id = v_student_id;

  if not found then raise exception 'LESSON_NOT_FOUND'; end if;
  if v_lesson.status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;
  if v_lesson.starts_at <= now() then raise exception 'LESSON_ALREADY_STARTED'; end if;

  select
    ts.schedule_timezone,
    ts.slot_interval_minutes,
    coalesce(ts.free_cancellation_hours, 6)
  into v_timezone, v_slot_interval, v_notice_hours
  from public.teacher_settings ts
  where ts.teacher_id = v_lesson.teacher_id;

  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;

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

  select wh.is_working, wh.workday_start, wh.workday_end
  into v_is_working, v_workday_start, v_workday_end
  from public.teacher_working_hours wh
  where wh.teacher_id = v_lesson.teacher_id
    and wh.weekday = extract(isodow from p_date)::integer;

  if not found or not v_is_working then return; end if;

  v_local_day_start := p_date + v_workday_start;
  v_local_last_start := p_date + v_workday_end
    - make_interval(mins => v_lesson.duration_minutes);
  if v_local_last_start < v_local_day_start then return; end if;

  return query
  select
    slot.slot_local at time zone v_timezone,
    (slot.slot_local at time zone v_timezone)
      + make_interval(mins => v_lesson.duration_minutes),
    v_timezone,
    v_lesson.duration_minutes
  from pg_catalog.generate_series(
    v_local_day_start,
    v_local_last_start,
    make_interval(mins => v_slot_interval)
  ) as slot(slot_local)
  where public.is_lesson_reschedule_target_available(
    v_lesson.id,
    slot.slot_local at time zone v_timezone
  )
  order by 1;
end;
$function$;

revoke all on function public.get_lesson_reschedule_availability(uuid, date)
  from public, anon;
grant execute on function public.get_lesson_reschedule_availability(uuid, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Student creates / withdraws a reschedule request.
-- ---------------------------------------------------------------------------

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
  v_student_name text;
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

  select coalesce(nullif(btrim(p.full_name), ''), p.email)
  into v_student_name
  from public.profiles p
  where p.id = v_lesson.student_id;

  insert into public.notifications (
    user_id, type, lesson_id, title_key, body_key, data
  ) values (
    v_lesson.teacher_id,
    'lesson_reschedule_requested'::public.notification_type,
    v_lesson.id,
    'notifications.lessonRescheduleRequest.title',
    'notifications.lessonRescheduleRequest.body',
    jsonb_build_object(
      'requestId', v_request_id,
      'lessonId', v_lesson.id,
      'studentName', v_student_name,
      'oldStartsAt', v_lesson.starts_at,
      'startsAt', p_requested_starts_at,
      'durationMinutes', v_lesson.duration_minutes,
      'message', nullif(btrim(p_message), '')
    )
  );

  return v_request_id;
end;
$function$;

revoke all on function public.create_lesson_reschedule_request(uuid, timestamptz, text)
  from public, anon;
grant execute on function public.create_lesson_reschedule_request(uuid, timestamptz, text)
  to authenticated, service_role;

create or replace function public.cancel_lesson_reschedule_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_request public.lesson_requests%rowtype;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  select * into v_request
  from public.lesson_requests r
  where r.id = p_request_id
    and r.student_id = v_student_id
    and r.request_type = 'reschedule'::public.lesson_request_type
  for update;

  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_request.status <> 'pending'::public.lesson_request_status then
    raise exception 'REQUEST_ALREADY_RESOLVED';
  end if;

  update public.lesson_requests
  set status = 'cancelled'::public.lesson_request_status,
      resolved_at = now(),
      resolved_by = v_student_id
  where id = v_request.id;
end;
$function$;

revoke all on function public.cancel_lesson_reschedule_request(uuid)
  from public, anon;
grant execute on function public.cancel_lesson_reschedule_request(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Teacher approves / rejects the request.
-- ---------------------------------------------------------------------------

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
  where id = v_lesson.id;

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
      'durationMinutes', v_lesson.duration_minutes
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

create or replace function public.reject_lesson_reschedule_request(
  p_request_id uuid,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_request public.lesson_requests%rowtype;
  v_comment text := nullif(btrim(p_comment), '');
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'COMMENT_TOO_LONG';
  end if;

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

  update public.lesson_requests
  set status = 'rejected'::public.lesson_request_status,
      resolution_comment = v_comment,
      resolved_at = now(),
      resolved_by = v_teacher_id
  where id = v_request.id;

  insert into public.notifications (
    user_id, type, lesson_id, title_key, body_key, data
  ) values (
    v_request.student_id,
    'lesson_request_rejected'::public.notification_type,
    v_request.lesson_id,
    'notifications.lessonRescheduleRequestRejected.title',
    'notifications.lessonRescheduleRequestRejected.body',
    jsonb_build_object(
      'requestId', v_request.id,
      'lessonId', v_request.lesson_id,
      'oldStartsAt', v_request.original_starts_at,
      'startsAt', v_request.requested_starts_at,
      'comment', v_comment
    )
  );
end;
$function$;

revoke all on function public.reject_lesson_reschedule_request(uuid, text)
  from public, anon;
grant execute on function public.reject_lesson_reschedule_request(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Keep cancellation and teacher-side schedule updates mutually exclusive
--    with a pending student reschedule request.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_no_pending_reschedule_on_cancellation_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.lesson_requests r
    where r.request_type = 'reschedule'::public.lesson_request_type
      and r.lesson_id = new.lesson_id
      and r.status = 'pending'::public.lesson_request_status
  ) then
    raise exception 'RESCHEDULE_REQUEST_PENDING';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_no_pending_reschedule_on_cancellation_request()
  from public, anon, authenticated;
grant execute on function public.enforce_no_pending_reschedule_on_cancellation_request()
  to service_role;

drop trigger if exists cancellation_requests_block_pending_reschedule
  on public.lesson_cancellation_requests;
create trigger cancellation_requests_block_pending_reschedule
before insert on public.lesson_cancellation_requests
for each row
execute function public.enforce_no_pending_reschedule_on_cancellation_request();

create or replace function public.prevent_manual_lesson_move_with_pending_reschedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.starts_at is distinct from old.starts_at
     and exists (
       select 1
       from public.lesson_requests r
       where r.request_type = 'reschedule'::public.lesson_request_type
         and r.lesson_id = old.id
         and r.status = 'pending'::public.lesson_request_status
     ) then
    raise exception 'RESCHEDULE_REQUEST_PENDING';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_manual_lesson_move_with_pending_reschedule()
  from public, anon, authenticated;
grant execute on function public.prevent_manual_lesson_move_with_pending_reschedule()
  to service_role;

drop trigger if exists lessons_block_manual_move_with_pending_reschedule
  on public.lessons;
create trigger lessons_block_manual_move_with_pending_reschedule
before update of starts_at on public.lessons
for each row
execute function public.prevent_manual_lesson_move_with_pending_reschedule();

-- ---------------------------------------------------------------------------
-- 7. Pending requests expire when the original lesson starts/changes, ceases
--    to be scheduled, or the requested target time passes. The lesson itself
--    remains unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.expire_lesson_reschedule_requests_for_lesson(
  p_lesson_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request record;
  v_count integer := 0;
begin
  for v_request in
    update public.lesson_requests r
    set status = 'expired'::public.lesson_request_status,
        resolved_at = now(),
        resolved_by = null
    from public.lessons l
    where r.request_type = 'reschedule'::public.lesson_request_type
      and r.status = 'pending'::public.lesson_request_status
      and r.lesson_id = p_lesson_id
      and l.id = r.lesson_id
      and (
        l.status <> 'scheduled'::public.lesson_status
        or l.starts_at <= now()
        or r.requested_starts_at <= now()
        or l.starts_at is distinct from r.original_starts_at
      )
    returning r.id, r.student_id, r.lesson_id, r.original_starts_at,
              r.requested_starts_at, r.duration_minutes
  loop
    insert into public.notifications (
      user_id, type, lesson_id, title_key, body_key, data
    ) values (
      v_request.student_id,
      'lesson_request_rejected'::public.notification_type,
      v_request.lesson_id,
      'notifications.lessonRescheduleRequestExpired.title',
      'notifications.lessonRescheduleRequestExpired.body',
      jsonb_build_object(
        'requestId', v_request.id,
        'lessonId', v_request.lesson_id,
        'oldStartsAt', v_request.original_starts_at,
        'startsAt', v_request.requested_starts_at,
        'durationMinutes', v_request.duration_minutes
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.expire_lesson_reschedule_requests_for_lesson(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_lesson_reschedule_requests_for_lesson(uuid)
  to service_role;

create or replace function public.expire_pending_lesson_reschedule_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lesson_id uuid;
  v_count integer := 0;
begin
  for v_lesson_id in
    select distinct r.lesson_id
    from public.lesson_requests r
    join public.lessons l on l.id = r.lesson_id
    where r.request_type = 'reschedule'::public.lesson_request_type
      and r.status = 'pending'::public.lesson_request_status
      and (
        l.status <> 'scheduled'::public.lesson_status
        or l.starts_at <= now()
        or r.requested_starts_at <= now()
        or l.starts_at is distinct from r.original_starts_at
      )
  loop
    v_count := v_count
      + public.expire_lesson_reschedule_requests_for_lesson(v_lesson_id);
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.expire_pending_lesson_reschedule_requests()
  from public, anon, authenticated;
grant execute on function public.expire_pending_lesson_reschedule_requests()
  to service_role;

create or replace function public.expire_reschedule_request_after_lesson_state_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status is distinct from old.status then
    perform public.expire_lesson_reschedule_requests_for_lesson(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function public.expire_reschedule_request_after_lesson_state_change()
  from public, anon, authenticated;
grant execute on function public.expire_reschedule_request_after_lesson_state_change()
  to service_role;

drop trigger if exists lessons_expire_reschedule_request_after_state_change
  on public.lessons;
create trigger lessons_expire_reschedule_request_after_state_change
after update of status on public.lessons
for each row
execute function public.expire_reschedule_request_after_lesson_state_change();

select cron.schedule(
  'lesson-reschedule-request-expiry',
  '* * * * *',
  'select public.expire_pending_lesson_reschedule_requests();'
);

commit;
