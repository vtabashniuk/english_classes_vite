begin;

-- ---------------------------------------------------------------------------
-- 1. Weekly teacher availability. Existing teacher_settings workday columns
--    remain temporarily as a deployment/rollback compatibility layer.
-- ---------------------------------------------------------------------------

create table public.teacher_working_hours (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null,
  is_working boolean not null default true,
  workday_start time without time zone not null,
  workday_end time without time zone not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_working_hours_pkey primary key (teacher_id, weekday),
  constraint teacher_working_hours_weekday_check check (weekday between 1 and 7),
  constraint teacher_working_hours_time_check check (workday_end > workday_start)
);

alter table public.teacher_working_hours enable row level security;

create policy "Teacher can view own working hours"
on public.teacher_working_hours
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

revoke all on table public.teacher_working_hours from public, anon, authenticated;
grant select on table public.teacher_working_hours to authenticated;
grant all on table public.teacher_working_hours to service_role;

-- Preserve current behaviour after migration: Mon-Fri enabled, Sat-Sun disabled.
insert into public.teacher_working_hours (
  teacher_id,
  weekday,
  is_working,
  workday_start,
  workday_end
)
select
  ts.teacher_id,
  d.weekday,
  d.weekday between 1 and 5,
  ts.workday_start,
  ts.workday_end
from public.teacher_settings ts
cross join generate_series(1, 7) as d(weekday)
on conflict (teacher_id, weekday) do nothing;

-- Initialize the seven weekday rows whenever a teacher_settings row is added
-- for a future teacher.
create or replace function public.initialize_teacher_working_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.teacher_working_hours (
    teacher_id,
    weekday,
    is_working,
    workday_start,
    workday_end
  )
  select
    new.teacher_id,
    d.weekday,
    d.weekday between 1 and 5,
    new.workday_start,
    new.workday_end
  from generate_series(1, 7) as d(weekday)
  on conflict (teacher_id, weekday) do nothing;

  return new;
end;
$function$;

revoke all on function public.initialize_teacher_working_hours()
  from public, anon, authenticated;
grant execute on function public.initialize_teacher_working_hours() to service_role;

drop trigger if exists teacher_settings_initialize_working_hours
  on public.teacher_settings;
create trigger teacher_settings_initialize_working_hours
after insert on public.teacher_settings
for each row execute function public.initialize_teacher_working_hours();

alter table public.recurring_lessons
  drop constraint if exists recurring_lessons_weekday_check;

alter table public.recurring_lessons
  add constraint recurring_lessons_weekday_check
  check (weekday between 1 and 7);

-- ---------------------------------------------------------------------------
-- 2. New atomic Settings RPC for timezone + duration + all seven weekdays.
-- ---------------------------------------------------------------------------

create or replace function public.update_my_schedule_settings(
  p_schedule_timezone text,
  p_lesson_duration_minutes smallint,
  p_working_hours jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_enabled_start time;
  v_enabled_end time;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = p_schedule_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  if p_lesson_duration_minutes < 30
     or p_lesson_duration_minutes > 120 then
    raise exception 'INVALID_LESSON_DURATION';
  end if;

  if p_working_hours is null
     or jsonb_typeof(p_working_hours) <> 'array'
     or jsonb_array_length(p_working_hours) <> 7 then
    raise exception 'INVALID_WORKING_HOURS';
  end if;

  if (
    select count(distinct x.weekday)
    from jsonb_to_recordset(p_working_hours) as x(
      weekday smallint,
      is_working boolean,
      workday_start time,
      workday_end time
    )
    where x.weekday between 1 and 7
  ) <> 7 then
    raise exception 'INVALID_WORKING_HOURS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_working_hours) as x(
      weekday smallint,
      is_working boolean,
      workday_start time,
      workday_end time
    )
    where x.is_working is null
       or x.workday_start is null
       or x.workday_end is null
       or x.workday_end <= x.workday_start
       or (
         x.is_working
         and date '2000-01-01' + x.workday_start
             + make_interval(mins => p_lesson_duration_minutes)
             > date '2000-01-01' + x.workday_end
       )
  ) then
    raise exception 'INVALID_WORKING_HOURS';
  end if;

  select
    min(x.workday_start) filter (where x.is_working),
    max(x.workday_end) filter (where x.is_working)
  into
    v_enabled_start,
    v_enabled_end
  from jsonb_to_recordset(p_working_hours) as x(
    weekday smallint,
    is_working boolean,
    workday_start time,
    workday_end time
  );

  update public.teacher_settings ts
  set
    schedule_timezone = p_schedule_timezone,
    lesson_duration_minutes = p_lesson_duration_minutes,
    -- Legacy envelope is retained for compatibility with the previous client.
    workday_start = coalesce(v_enabled_start, ts.workday_start),
    workday_end = coalesce(v_enabled_end, ts.workday_end),
    updated_at = now()
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  insert into public.teacher_working_hours (
    teacher_id,
    weekday,
    is_working,
    workday_start,
    workday_end,
    updated_at
  )
  select
    v_teacher_id,
    x.weekday,
    x.is_working,
    x.workday_start,
    x.workday_end,
    now()
  from jsonb_to_recordset(p_working_hours) as x(
    weekday smallint,
    is_working boolean,
    workday_start time,
    workday_end time
  )
  on conflict (teacher_id, weekday) do update
  set
    is_working = excluded.is_working,
    workday_start = excluded.workday_start,
    workday_end = excluded.workday_end,
    updated_at = now();
end;
$function$;

revoke all on function public.update_my_schedule_settings(text, smallint, jsonb)
  from public, anon;
grant execute on function public.update_my_schedule_settings(text, smallint, jsonb)
  to authenticated, service_role;

-- Keep the previous RPC usable during a staggered deployment. It continues to
-- represent the old Mon-Fri global-hours model and synchronizes those five rows.
create or replace function public.update_my_teacher_settings(
  p_schedule_timezone text,
  p_workday_start time without time zone,
  p_workday_end time without time zone,
  p_lesson_duration_minutes smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = p_schedule_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  if p_workday_end <= p_workday_start then
    raise exception 'INVALID_WORKDAY';
  end if;

  if p_lesson_duration_minutes < 30
     or p_lesson_duration_minutes > 120 then
    raise exception 'INVALID_LESSON_DURATION';
  end if;

  if date '2000-01-01' + p_workday_start
       + make_interval(mins => p_lesson_duration_minutes)
       > date '2000-01-01' + p_workday_end then
    raise exception 'WORKDAY_TOO_SHORT';
  end if;

  update public.teacher_settings
  set
    schedule_timezone = p_schedule_timezone,
    workday_start = p_workday_start,
    workday_end = p_workday_end,
    lesson_duration_minutes = p_lesson_duration_minutes,
    updated_at = now()
  where teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  update public.teacher_working_hours
  set
    is_working = true,
    workday_start = p_workday_start,
    workday_end = p_workday_end,
    updated_at = now()
  where teacher_id = v_teacher_id
    and weekday between 1 and 5;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. One-off lesson creation uses weekday-specific availability.
-- ---------------------------------------------------------------------------

create or replace function public.create_lesson(
  p_student_id uuid,
  p_lesson_date date,
  p_start_time time without time zone,
  p_zoom_url text default null::text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_is_working boolean;
  v_duration integer;
  v_slot_interval integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_lesson_id uuid;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  select
    ts.schedule_timezone,
    ts.lesson_duration_minutes,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_duration,
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

  insert into public.lessons (
    student_id,
    teacher_id,
    starts_at,
    ends_at,
    duration_minutes,
    status,
    zoom_url
  )
  values (
    p_student_id,
    v_teacher_id,
    v_starts_at,
    v_ends_at,
    v_duration,
    'scheduled',
    nullif(trim(p_zoom_url), '')
  )
  returning id into v_lesson_id;

  return v_lesson_id;
exception
  when exclusion_violation then
    raise exception 'LESSON_TIME_CONFLICT';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. One-off rescheduling uses weekday-specific availability while preserving
--    the existing lesson price snapshot behaviour from 20261002235900.
-- ---------------------------------------------------------------------------

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
exception
  when exclusion_violation then
    raise exception 'LESSON_TIME_CONFLICT';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Recurring rule creation supports any configured weekday 1..7.
-- ---------------------------------------------------------------------------

create or replace function public.create_recurring_lesson(
  p_student_id uuid,
  p_weekday smallint,
  p_start_time time without time zone,
  p_valid_from date,
  p_valid_until date default null::date,
  p_zoom_url text default null::text,
  p_interval_weeks smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_is_working boolean;
  v_duration smallint;
  v_slot_interval smallint;
  v_local_today date;
  v_anchor_date date;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
  v_end_time time;
  v_recurring_lesson_id uuid;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  select
    ts.schedule_timezone,
    ts.lesson_duration_minutes,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_duration,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = v_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  if p_weekday < 1 or p_weekday > 7 then
    raise exception 'INVALID_WEEKDAY';
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
    and wh.weekday = p_weekday;

  if not found or not v_is_working then
    raise exception 'NON_WORKING_DAY';
  end if;

  if p_interval_weeks < 1 or p_interval_weeks > 52 then
    raise exception 'INVALID_INTERVAL_WEEKS';
  end if;

  if extract(second from p_start_time) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_local_today := (now() at time zone v_timezone)::date;

  if p_valid_from < v_local_today then
    raise exception 'VALID_FROM_IN_PAST';
  end if;

  if p_valid_until is not null and p_valid_until < p_valid_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  v_anchor_date :=
    p_valid_from
    + ((p_weekday - extract(isodow from p_valid_from)::integer + 7) % 7);

  if p_valid_until is not null and v_anchor_date > p_valid_until then
    raise exception 'NO_OCCURRENCE_IN_DATE_RANGE';
  end if;

  if p_start_time < v_workday_start then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_end_time := p_start_time + make_interval(mins => v_duration);

  if date '2000-01-01' + p_start_time + make_interval(mins => v_duration)
       > date '2000-01-01' + v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_minutes_from_midnight :=
      extract(hour from p_start_time)::integer * 60
    + extract(minute from p_start_time)::integer;

  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  if exists (
    select 1
    from public.recurring_lessons r
    cross join lateral generate_series(
      greatest(v_anchor_date, r.anchor_date)::timestamp,
      least(
        coalesce(p_valid_until, v_anchor_date + 730),
        coalesce(r.valid_until, v_anchor_date + 730)
      )::timestamp,
      interval '1 day'
    ) d(day)
    where r.teacher_id = v_teacher_id
      and r.is_active = true
      and extract(isodow from d.day)::integer = p_weekday
      and extract(isodow from d.day)::integer = r.weekday
      and d.day::date >= v_anchor_date
      and d.day::date >= r.anchor_date
      and mod(((d.day::date - v_anchor_date) / 7), p_interval_weeks) = 0
      and mod(((d.day::date - r.anchor_date) / 7), r.interval_weeks) = 0
      and r.start_time < v_end_time
      and r.start_time + make_interval(mins => r.duration_minutes) > p_start_time
  ) then
    raise exception 'RECURRING_TEACHER_CONFLICT';
  end if;

  insert into public.recurring_lessons (
    student_id,
    teacher_id,
    weekday,
    start_time,
    timezone,
    duration_minutes,
    valid_from,
    valid_until,
    anchor_date,
    interval_weeks,
    zoom_url,
    is_active
  )
  values (
    p_student_id,
    v_teacher_id,
    p_weekday,
    p_start_time,
    v_timezone,
    v_duration,
    p_valid_from,
    p_valid_until,
    v_anchor_date,
    p_interval_weeks,
    nullif(trim(p_zoom_url), ''),
    true
  )
  returning id into v_recurring_lesson_id;

  return v_recurring_lesson_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Student extra-lesson availability follows the teacher's configured day.
-- ---------------------------------------------------------------------------

create or replace function public.get_extra_lesson_availability(p_date date)
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
  v_user_id uuid := auth.uid();
  v_teacher_id uuid;
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_is_working boolean;
  v_duration smallint;
  v_slot_interval smallint;
  v_local_day_start timestamp;
  v_local_last_start timestamp;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'student'
      and is_active = true
  ) then
    raise exception 'STUDENT_REQUIRED';
  end if;

  v_teacher_id := public.resolve_my_teacher_id();

  select
    ts.schedule_timezone,
    ts.lesson_duration_minutes,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_duration,
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
    and wh.weekday = extract(isodow from p_date)::integer;

  if not found or not v_is_working then
    return;
  end if;

  v_local_day_start := p_date + v_workday_start;
  v_local_last_start := p_date + v_workday_end - make_interval(mins => v_duration);

  if v_local_last_start < v_local_day_start then
    return;
  end if;

  return query
  select
    slot.slot_local at time zone v_timezone,
    (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration),
    v_timezone,
    v_duration
  from generate_series(
    v_local_day_start,
    v_local_last_start,
    make_interval(mins => v_slot_interval)
  ) as slot(slot_local)
  where (slot.slot_local at time zone v_timezone) > now()
    and not exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.status <> 'cancelled'
        and l.starts_at < (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration)
        and l.ends_at > (slot.slot_local at time zone v_timezone)
    )
  order by 1;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Student request creation validates weekday-specific availability.
-- ---------------------------------------------------------------------------

create or replace function public.create_extra_lesson_request(
  p_requested_starts_at timestamptz,
  p_message text default null::text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_teacher_id uuid;
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_is_working boolean;
  v_duration smallint;
  v_slot_interval smallint;
  v_local_start timestamp;
  v_local_day_start timestamp;
  v_local_day_end timestamp;
  v_requested_end timestamptz;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
  v_request_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'student'
      and is_active = true
  ) then
    raise exception 'STUDENT_REQUIRED';
  end if;

  v_teacher_id := public.resolve_my_teacher_id();

  select
    ts.schedule_timezone,
    ts.lesson_duration_minutes,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_duration,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  v_local_start := p_requested_starts_at at time zone v_timezone;

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
    and wh.weekday = extract(isodow from v_local_start::date)::integer;

  if not found or not v_is_working then
    raise exception 'NON_WORKING_DAY';
  end if;

  if p_requested_starts_at <= now() then
    raise exception 'LESSON_MUST_BE_IN_FUTURE';
  end if;

  v_local_day_start := v_local_start::date + v_workday_start;
  v_local_day_end := v_local_start::date + v_workday_end;

  if v_local_start < v_local_day_start
     or v_local_start + make_interval(mins => v_duration) > v_local_day_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_minutes_from_midnight :=
      extract(hour from v_local_start)::integer * 60
    + extract(minute from v_local_start)::integer;

  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0
     or extract(second from v_local_start) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_requested_end := p_requested_starts_at + make_interval(mins => v_duration);

  if exists (
    select 1
    from public.lessons l
    where l.teacher_id = v_teacher_id
      and l.status <> 'cancelled'
      and l.starts_at < v_requested_end
      and l.ends_at > p_requested_starts_at
  ) then
    raise exception 'LESSON_TIME_CONFLICT';
  end if;

  if exists (
    select 1
    from public.lesson_requests r
    where r.student_id = v_user_id
      and r.status = 'pending'
      and r.requested_starts_at < v_requested_end
      and r.requested_starts_at + make_interval(mins => r.duration_minutes) > p_requested_starts_at
  ) then
    raise exception 'REQUEST_TIME_CONFLICT';
  end if;

  insert into public.lesson_requests (
    request_type,
    student_id,
    teacher_id,
    requested_starts_at,
    duration_minutes,
    message,
    status
  )
  values (
    'extra_lesson',
    v_user_id,
    v_teacher_id,
    p_requested_starts_at,
    v_duration,
    nullif(trim(p_message), ''),
    'pending'
  )
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Approval rechecks current weekly availability as well as lesson conflicts.
-- ---------------------------------------------------------------------------

create or replace function public.approve_lesson_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request public.lesson_requests%rowtype;
  v_timezone text;
  v_slot_interval smallint;
  v_local_start timestamp;
  v_workday_start time;
  v_workday_end time;
  v_is_working boolean;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
  v_ends_at timestamptz;
  v_lesson_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select *
  into v_request
  from public.lesson_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_request.teacher_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'REQUEST_ALREADY_RESOLVED';
  end if;

  if v_request.requested_starts_at <= now() then
    raise exception 'REQUEST_TIME_PASSED';
  end if;

  select
    ts.schedule_timezone,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_user_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  v_local_start := v_request.requested_starts_at at time zone v_timezone;

  select
    wh.is_working,
    wh.workday_start,
    wh.workday_end
  into
    v_is_working,
    v_workday_start,
    v_workday_end
  from public.teacher_working_hours wh
  where wh.teacher_id = v_user_id
    and wh.weekday = extract(isodow from v_local_start::date)::integer;

  if not found or not v_is_working then
    raise exception 'NON_WORKING_DAY';
  end if;

  if v_local_start::time < v_workday_start
     or v_local_start + make_interval(mins => v_request.duration_minutes)
        > v_local_start::date + v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_minutes_from_midnight :=
      extract(hour from v_local_start)::integer * 60
    + extract(minute from v_local_start)::integer;

  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0
     or extract(second from v_local_start) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_ends_at :=
    v_request.requested_starts_at
    + make_interval(mins => v_request.duration_minutes);

  if exists (
    select 1
    from public.lessons l
    where l.teacher_id = v_request.teacher_id
      and l.status <> 'cancelled'
      and l.starts_at < v_ends_at
      and l.ends_at > v_request.requested_starts_at
  ) then
    raise exception 'LESSON_TIME_CONFLICT';
  end if;

  begin
    insert into public.lessons (
      student_id,
      teacher_id,
      starts_at,
      ends_at,
      duration_minutes,
      status
    )
    values (
      v_request.student_id,
      v_request.teacher_id,
      v_request.requested_starts_at,
      v_ends_at,
      v_request.duration_minutes,
      'scheduled'
    )
    returning id into v_lesson_id;
  exception
    when exclusion_violation then
      raise exception 'LESSON_TIME_CONFLICT';
  end;

  update public.lesson_requests
  set
    status = 'approved',
    created_lesson_id = v_lesson_id,
    resolved_at = now(),
    resolved_by = v_user_id
  where id = p_request_id;

  insert into public.notifications (
    user_id,
    type,
    lesson_id,
    title_key,
    body_key,
    data
  )
  values (
    v_request.student_id,
    'lesson_request_approved',
    v_lesson_id,
    'notifications.lessonRequestApproved.title',
    'notifications.lessonRequestApproved.body',
    jsonb_build_object(
      'startsAt', v_request.requested_starts_at,
      'durationMinutes', v_request.duration_minutes,
      'requestId', v_request.id,
      'lessonId', v_lesson_id
    )
  );

  return v_lesson_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Explicit privileges for the new table/RPC; existing RPC signatures keep
--    their previous grants after CREATE OR REPLACE.
-- ---------------------------------------------------------------------------

revoke all on function public.update_my_schedule_settings(text, smallint, jsonb)
  from public, anon;
grant execute on function public.update_my_schedule_settings(text, smallint, jsonb)
  to authenticated, service_role;

commit;
