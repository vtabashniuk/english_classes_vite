-- Provider-neutral online lesson links.
-- Existing values are preserved by renaming the columns in place.
-- Zoom, Google Meet, Microsoft Teams and arbitrary HTTPS meeting URLs use the
-- same meeting_url field; provider detection is a presentation concern.

begin;

-- Remove functions whose named RPC arguments change. Dropping before the
-- column rename avoids keeping stale p_zoom_url argument names in PostgREST.
drop function if exists public.create_recurring_lesson_with_generation(
  uuid, smallint, time without time zone, date, date, text, smallint, smallint
);
drop function if exists public.edit_recurring_series_from_lesson(
  uuid, smallint, time without time zone, smallint, date, text, smallint
);
drop function if exists public.create_recurring_lesson(
  uuid, smallint, time without time zone, date, date, text, smallint
);
drop function if exists public.create_lesson(
  uuid, date, time without time zone, text
);
drop function if exists public.update_lesson_schedule(
  uuid, date, time without time zone, text
);
drop function if exists public.update_lesson_zoom(uuid, text);

alter table public.lessons
  rename column zoom_url to meeting_url;

alter table public.recurring_lessons
  rename column zoom_url to meeting_url;

comment on column public.lessons.meeting_url is
  'Provider-neutral URL for joining this concrete lesson (Zoom, Google Meet, Microsoft Teams, or another service).';

comment on column public.recurring_lessons.meeting_url is
  'Default provider-neutral meeting URL copied to materialized lessons in this recurring series.';

-- lessons uses column-level SELECT grants so teacher_note remains private.
-- The rename preserves the existing attribute grant; this makes the new name explicit.
grant select (meeting_url) on public.lessons to authenticated;

create or replace function public.create_lesson(
  p_student_id uuid,
  p_lesson_date date,
  p_start_time time without time zone,
  p_meeting_url text default null::text
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
    meeting_url
  )
  values (
    p_student_id,
    v_teacher_id,
    v_starts_at,
    v_ends_at,
    v_duration,
    'scheduled',
    nullif(trim(p_meeting_url), '')
  )
  returning id into v_lesson_id;

  return v_lesson_id;
exception
  when exclusion_violation then
    raise exception 'LESSON_TIME_CONFLICT';
end;
$function$;

create or replace function public.create_recurring_lesson(
  p_student_id uuid,
  p_weekday smallint,
  p_start_time time without time zone,
  p_valid_from date,
  p_valid_until date default null::date,
  p_meeting_url text default null::text,
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
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  if not public.is_my_active_student(p_student_id) then raise exception 'STUDENT_NOT_FOUND'; end if;

  select ts.schedule_timezone, ts.lesson_duration_minutes, ts.slot_interval_minutes
  into v_timezone, v_duration, v_slot_interval
  from public.teacher_settings ts where ts.teacher_id = v_teacher_id;
  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = v_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  if p_weekday < 1 or p_weekday > 7 then raise exception 'INVALID_WEEKDAY'; end if;

  select wh.is_working, wh.workday_start, wh.workday_end
  into v_is_working, v_workday_start, v_workday_end
  from public.teacher_working_hours wh
  where wh.teacher_id = v_teacher_id and wh.weekday = p_weekday;
  if not found or not v_is_working then raise exception 'NON_WORKING_DAY'; end if;

  if p_interval_weeks < 1 or p_interval_weeks > 52 then raise exception 'INVALID_INTERVAL_WEEKS'; end if;
  if extract(second from p_start_time) <> 0 then raise exception 'INVALID_TIME_SLOT'; end if;

  v_local_today := (now() at time zone v_timezone)::date;
  if p_valid_from < v_local_today then raise exception 'VALID_FROM_IN_PAST'; end if;
  if p_valid_until is not null and p_valid_until < p_valid_from then raise exception 'INVALID_DATE_RANGE'; end if;

  v_anchor_date := p_valid_from
    + ((p_weekday - extract(isodow from p_valid_from)::integer + 7) % 7);
  if p_valid_until is not null and v_anchor_date > p_valid_until then
    raise exception 'NO_OCCURRENCE_IN_DATE_RANGE';
  end if;

  if p_start_time < v_workday_start then raise exception 'OUTSIDE_WORKING_HOURS'; end if;
  v_end_time := p_start_time + make_interval(mins => v_duration);
  if date '2000-01-01' + p_start_time + make_interval(mins => v_duration)
       > date '2000-01-01' + v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_minutes_from_midnight := extract(hour from p_start_time)::integer * 60
    + extract(minute from p_start_time)::integer;
  v_workday_start_minutes := extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;
  if mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  if exists (
    select 1 from public.recurring_lessons r
    where r.teacher_id = v_teacher_id
      and r.is_active = true
      and public.recurring_patterns_overlap(
        p_weekday, v_anchor_date, p_interval_weeks, p_valid_until,
        p_start_time, v_end_time,
        r.weekday, r.anchor_date, r.interval_weeks, r.valid_until,
        r.start_time, r.start_time + make_interval(mins => r.duration_minutes)
      )
  ) then
    raise exception 'RECURRING_TEACHER_CONFLICT';
  end if;

  if exists (
    select 1 from public.teacher_schedule_block_series s
    where s.teacher_id = v_teacher_id
      and s.is_active = true
      and public.recurring_patterns_overlap(
        p_weekday, v_anchor_date, p_interval_weeks, p_valid_until,
        p_start_time, v_end_time,
        s.weekday, s.anchor_date, s.interval_weeks, s.valid_until,
        s.start_time, s.end_time
      )
  ) then
    raise exception 'RECURRING_BLOCK_SERIES_CONFLICT';
  end if;

  insert into public.recurring_lessons (
    student_id, teacher_id, weekday, start_time, timezone,
    duration_minutes, valid_from, valid_until, anchor_date,
    interval_weeks, meeting_url, is_active
  ) values (
    p_student_id, v_teacher_id, p_weekday, p_start_time, v_timezone,
    v_duration, p_valid_from, p_valid_until, v_anchor_date,
    p_interval_weeks, nullif(trim(p_meeting_url), ''), true
  ) returning id into v_recurring_lesson_id;

  return v_recurring_lesson_id;
end;
$function$;

create or replace function public.materialize_recurring_lessons_internal(
  p_recurring_lesson_id uuid,
  p_until date
)
returns table (
  created_count integer,
  existing_count integer,
  conflict_count integer,
  past_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rule public.recurring_lessons%rowtype;
  v_today date;
  v_date date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_created integer := 0;
  v_existing integer := 0;
  v_conflicts integer := 0;
  v_past integer := 0;
begin
  if p_until is null then raise exception 'UNTIL_REQUIRED'; end if;

  select * into v_rule
  from public.recurring_lessons r
  where r.id = p_recurring_lesson_id
  for update;

  if not found then raise exception 'RECURRING_LESSON_NOT_FOUND'; end if;
  if not v_rule.is_active then raise exception 'RECURRING_LESSON_INACTIVE'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_rule.teacher_id::text, 0)
  );

  v_today := (now() at time zone v_rule.timezone)::date;

  for v_date in
    select occurrence_date
    from public.get_recurring_occurrence_dates(
      v_rule.weekday,
      v_rule.anchor_date,
      v_rule.interval_weeks,
      v_rule.valid_from,
      v_rule.valid_until,
      greatest(v_today, v_rule.valid_from),
      p_until
    )
  loop
    v_starts_at := (v_date::timestamp + v_rule.start_time) at time zone v_rule.timezone;
    v_ends_at := v_starts_at + make_interval(mins => v_rule.duration_minutes);

    if v_starts_at <= now() then
      v_past := v_past + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.recurring_lesson_id = v_rule.id
        and l.occurrence_date = v_date
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.teacher_id = v_rule.teacher_id
        and not b.is_cancelled
        and b.starts_at < v_ends_at
        and b.ends_at > v_starts_at
    ) or public.is_teacher_recurring_blocked(
      v_rule.teacher_id, v_starts_at, v_ends_at, null
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if public.is_teacher_recurring_lesson_reserved(
      v_rule.teacher_id,
      v_starts_at,
      v_ends_at,
      v_rule.id
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_rule.teacher_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) or exists (
      select 1
      from public.lessons l
      where l.student_id = v_rule.student_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    begin
      insert into public.lessons (
        student_id,
        teacher_id,
        recurring_lesson_id,
        occurrence_date,
        starts_at,
        ends_at,
        duration_minutes,
        status,
        meeting_url
      ) values (
        v_rule.student_id,
        v_rule.teacher_id,
        v_rule.id,
        v_date,
        v_starts_at,
        v_ends_at,
        v_rule.duration_minutes,
        'scheduled',
        v_rule.meeting_url
      );
      v_created := v_created + 1;
    exception
      when exclusion_violation or unique_violation then
        v_conflicts := v_conflicts + 1;
    end;
  end loop;

  return query select v_created, v_existing, v_conflicts, v_past;
end;
$function$;

create or replace function public.create_recurring_lesson_with_generation(
  p_student_id uuid,
  p_weekday smallint,
  p_start_time time without time zone,
  p_valid_from date,
  p_valid_until date default null,
  p_meeting_url text default null,
  p_interval_weeks smallint default 1,
  p_generate_weeks smallint default 8
)
returns table (
  recurring_lesson_id uuid,
  created_count integer,
  existing_count integer,
  conflict_count integer,
  past_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_timezone text;
  v_allow_open boolean;
  v_horizon_weeks smallint;
  v_today date;
  v_generate_until date;
  v_series_id uuid;
  v_result record;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select
    ts.schedule_timezone,
    ts.allow_open_ended_recurring_lessons,
    ts.recurring_generation_horizon_weeks
  into
    v_timezone,
    v_allow_open,
    v_horizon_weeks
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;
  if p_valid_until is null and not v_allow_open then
    raise exception 'END_DATE_REQUIRED';
  end if;

  v_series_id := public.create_recurring_lesson(
    p_student_id,
    p_weekday,
    p_start_time,
    p_valid_from,
    p_valid_until,
    p_meeting_url,
    p_interval_weeks
  );

  v_today := (now() at time zone v_timezone)::date;
  v_generate_until := case
    when p_valid_until is not null then p_valid_until
    else v_today + (coalesce(v_horizon_weeks, 8) * 7)
  end;

  select * into v_result
  from public.materialize_recurring_lessons_internal(
    v_series_id,
    v_generate_until
  );

  return query select
    v_series_id,
    coalesce(v_result.created_count, 0),
    coalesce(v_result.existing_count, 0),
    coalesce(v_result.conflict_count, 0),
    coalesce(v_result.past_count, 0);
end;
$function$;

create or replace function public.edit_recurring_series_from_lesson(
  p_lesson_id uuid,
  p_weekday smallint,
  p_start_time time without time zone,
  p_interval_weeks smallint,
  p_valid_until date default null,
  p_meeting_url text default null,
  p_generate_weeks smallint default 8
)
returns table (
  new_recurring_lesson_id uuid,
  created_count integer,
  conflict_count integer,
  cancelled_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_student_id uuid;
  v_old_recurring_lesson_id uuid;
  v_starts_at timestamptz;
  v_duration_minutes smallint;
  v_status public.lesson_status;
  v_timezone text;
  v_anchor_date date;
  v_selected_local_date date;
  v_cutoff_date date;
  v_allow_open boolean;
  v_create_result record;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select
    l.student_id,
    l.recurring_lesson_id,
    l.starts_at,
    l.duration_minutes,
    l.status
  into
    v_student_id,
    v_old_recurring_lesson_id,
    v_starts_at,
    v_duration_minutes,
    v_status
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then raise exception 'LESSON_NOT_FOUND'; end if;
  if v_old_recurring_lesson_id is null then raise exception 'NOT_RECURRING_LESSON'; end if;
  if v_status <> 'scheduled'::public.lesson_status then raise exception 'LESSON_NOT_SCHEDULED'; end if;
  if v_starts_at <= now() then raise exception 'PAST_LESSON_CANNOT_BE_EDITED'; end if;

  select r.timezone, r.anchor_date
  into v_timezone, v_anchor_date
  from public.recurring_lessons r
  where r.id = v_old_recurring_lesson_id
    and r.teacher_id = v_teacher_id
  for update;

  if not found then raise exception 'RECURRING_LESSON_NOT_FOUND'; end if;

  select ts.allow_open_ended_recurring_lessons
  into v_allow_open
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if p_valid_until is null and not coalesce(v_allow_open, true) then
    raise exception 'END_DATE_REQUIRED';
  end if;

  v_selected_local_date := coalesce(
    (select l.occurrence_date from public.lessons l where l.id = p_lesson_id),
    (v_starts_at at time zone v_timezone)::date
  );
  v_cutoff_date := v_selected_local_date - 1;

  if p_valid_until is not null and p_valid_until < v_selected_local_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if v_selected_local_date <= v_anchor_date then
    update public.recurring_lessons
    set is_active = false, updated_at = now()
    where id = v_old_recurring_lesson_id;
  else
    update public.recurring_lessons
    set
      valid_until = case
        when valid_until is null then v_cutoff_date
        else least(valid_until, v_cutoff_date)
      end,
      updated_at = now()
    where id = v_old_recurring_lesson_id;
  end if;

  update public.lessons
  set
    status = 'cancelled',
    cancelled_by = 'teacher',
    cancelled_at = now(),
    cancellation_reason = null,
    updated_at = now()
  where recurring_lesson_id = v_old_recurring_lesson_id
    and occurrence_date >= v_selected_local_date
    and status = 'scheduled'::public.lesson_status;

  get diagnostics cancelled_count = row_count;

  select * into v_create_result
  from public.create_recurring_lesson_with_generation(
    p_student_id => v_student_id,
    p_weekday => p_weekday,
    p_start_time => p_start_time,
    p_valid_from => v_selected_local_date,
    p_valid_until => p_valid_until,
    p_meeting_url => nullif(trim(p_meeting_url), ''),
    p_interval_weeks => p_interval_weeks,
    p_generate_weeks => p_generate_weeks
  );

  new_recurring_lesson_id := v_create_result.recurring_lesson_id;
  created_count := coalesce(v_create_result.created_count, 0);
  conflict_count := coalesce(v_create_result.conflict_count, 0);

  insert into public.notifications (
    user_id, type, lesson_id, title_key, body_key, data
  ) values (
    v_student_id,
    'recurring_series_changed',
    p_lesson_id,
    'notifications.recurringSeriesChanged.title',
    'notifications.recurringSeriesChanged.body',
    jsonb_build_object(
      'lessonId', p_lesson_id,
      'startsAt', v_starts_at,
      'durationMinutes', v_duration_minutes,
      'oldRecurringLessonId', v_old_recurring_lesson_id,
      'newRecurringLessonId', new_recurring_lesson_id
    )
  );

  return next;
end;
$function$;

create or replace function public.update_lesson_schedule(
  p_lesson_id uuid,
  p_lesson_date date,
  p_start_time time without time zone,
  p_meeting_url text default null
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
    meeting_url = nullif(btrim(p_meeting_url), ''),
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

CREATE OR REPLACE FUNCTION public.update_lesson_meeting_url (
  p_lesson_id uuid,
  p_meeting_url  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid;
  v_status public.lesson_status;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select l.status
  into v_status
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_status = 'cancelled' then
    raise exception 'LESSON_CANCELLED';
  end if;

  update public.lessons
  set
    meeting_url = nullif(trim(p_meeting_url), ''),
    updated_at = now()
  where id = p_lesson_id;
end;
$function$;

-- Restore least-privilege execution grants after recreating functions.
revoke all on function public.create_lesson(
  uuid, date, time without time zone, text
) from public, anon, authenticated;
grant execute on function public.create_lesson(
  uuid, date, time without time zone, text
) to authenticated, service_role;

revoke all on function public.create_recurring_lesson(
  uuid, smallint, time without time zone, date, date, text, smallint
) from public, anon, authenticated;
grant execute on function public.create_recurring_lesson(
  uuid, smallint, time without time zone, date, date, text, smallint
) to service_role;

revoke all on function public.materialize_recurring_lessons_internal(uuid, date)
  from public, anon, authenticated;
grant execute on function public.materialize_recurring_lessons_internal(uuid, date)
  to service_role;

revoke all on function public.create_recurring_lesson_with_generation(
  uuid, smallint, time without time zone, date, date, text, smallint, smallint
) from public, anon;
grant execute on function public.create_recurring_lesson_with_generation(
  uuid, smallint, time without time zone, date, date, text, smallint, smallint
) to authenticated, service_role;

revoke all on function public.edit_recurring_series_from_lesson(
  uuid, smallint, time without time zone, smallint, date, text, smallint
) from public, anon;
grant execute on function public.edit_recurring_series_from_lesson(
  uuid, smallint, time without time zone, smallint, date, text, smallint
) to authenticated, service_role;

revoke all on function public.update_lesson_schedule(
  uuid, date, time without time zone, text
) from public, anon;
grant execute on function public.update_lesson_schedule(
  uuid, date, time without time zone, text
) to authenticated, service_role;

revoke all on function public.update_lesson_meeting_url(uuid, text)
  from public, anon, authenticated;
grant execute on function public.update_lesson_meeting_url(uuid, text)
  to authenticated, service_role;

commit;
