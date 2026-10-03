begin;

-- Step 2: one-time teacher schedule blocks.
-- Blocks are local availability exceptions. They never cancel or move existing
-- lessons; creation/update is rejected when an active lesson already overlaps.

create table public.teacher_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_schedule_blocks_time_check check (ends_at > starts_at),
  constraint teacher_schedule_blocks_reason_check check (
    reason is null or char_length(reason) <= 200
  ),
  constraint teacher_schedule_blocks_no_overlap exclude using gist (
    teacher_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create index teacher_schedule_blocks_teacher_starts_idx
  on public.teacher_schedule_blocks (teacher_id, starts_at);

alter table public.teacher_schedule_blocks enable row level security;

create policy "Teacher can view own schedule blocks"
on public.teacher_schedule_blocks
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

revoke all on table public.teacher_schedule_blocks from public, anon, authenticated;
grant select on table public.teacher_schedule_blocks to authenticated;
grant all on table public.teacher_schedule_blocks to service_role;

-- Resolve and validate a teacher-local block window. This helper is kept
-- internal; only the public CRUD RPCs below are callable by authenticated users.
create or replace function public.resolve_teacher_schedule_block_window(
  p_teacher_id uuid,
  p_block_date date,
  p_start_time time without time zone,
  p_end_time time without time zone
)
returns table (
  block_starts_at timestamptz,
  block_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_timezone text;
  v_slot_interval smallint;
  v_is_working boolean;
  v_workday_start time;
  v_workday_end time;
  v_start_minutes integer;
  v_end_minutes integer;
  v_workday_start_minutes integer;
begin
  if p_block_date is null or p_start_time is null or p_end_time is null then
    raise exception 'SCHEDULE_BLOCK_REQUIRED_FIELDS';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'SCHEDULE_BLOCK_INVALID_RANGE';
  end if;

  select
    ts.schedule_timezone,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = p_teacher_id;

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
  where wh.teacher_id = p_teacher_id
    and wh.weekday = extract(isodow from p_block_date)::integer;

  if not found or not v_is_working then
    raise exception 'NON_WORKING_DAY';
  end if;

  if p_start_time < v_workday_start or p_end_time > v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  if extract(second from p_start_time) <> 0
     or extract(second from p_end_time) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_start_minutes :=
      extract(hour from p_start_time)::integer * 60
    + extract(minute from p_start_time)::integer;
  v_end_minutes :=
      extract(hour from p_end_time)::integer * 60
    + extract(minute from p_end_time)::integer;
  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_start_minutes - v_workday_start_minutes, v_slot_interval) <> 0
     or (
       p_end_time <> v_workday_end
       and mod(v_end_minutes - v_workday_start_minutes, v_slot_interval) <> 0
     ) then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  block_starts_at :=
    (p_block_date::timestamp + p_start_time) at time zone v_timezone;
  block_ends_at :=
    (p_block_date::timestamp + p_end_time) at time zone v_timezone;

  if block_starts_at <= now() then
    raise exception 'SCHEDULE_BLOCK_IN_PAST';
  end if;

  return next;
end;
$function$;

revoke all on function public.resolve_teacher_schedule_block_window(
  uuid, date, time without time zone, time without time zone
) from public, anon, authenticated;
grant execute on function public.resolve_teacher_schedule_block_window(
  uuid, date, time without time zone, time without time zone
) to service_role;

create or replace function public.create_teacher_schedule_block(
  p_block_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_block_id uuid;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_teacher_id::text, 0)
  );

  if char_length(coalesce(p_reason, '')) > 200 then
    raise exception 'SCHEDULE_BLOCK_REASON_TOO_LONG';
  end if;

  select block_starts_at, block_ends_at
  into v_starts_at, v_ends_at
  from public.resolve_teacher_schedule_block_window(
    v_teacher_id,
    p_block_date,
    p_start_time,
    p_end_time
  );

  if exists (
    select 1
    from public.lessons l
    where l.teacher_id = v_teacher_id
      and l.status <> 'cancelled'::public.lesson_status
      and l.starts_at < v_ends_at
      and l.ends_at > v_starts_at
  ) then
    raise exception 'SCHEDULE_BLOCK_LESSON_CONFLICT';
  end if;

  begin
    insert into public.teacher_schedule_blocks (
      teacher_id,
      starts_at,
      ends_at,
      reason
    )
    values (
      v_teacher_id,
      v_starts_at,
      v_ends_at,
      nullif(btrim(p_reason), '')
    )
    returning id into v_block_id;
  exception
    when exclusion_violation then
      raise exception 'SCHEDULE_BLOCK_CONFLICT';
  end;

  return v_block_id;
end;
$function$;

create or replace function public.update_teacher_schedule_block(
  p_block_id uuid,
  p_block_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_existing public.teacher_schedule_blocks%rowtype;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_teacher_id::text, 0)
  );

  select *
  into v_existing
  from public.teacher_schedule_blocks b
  where b.id = p_block_id
    and b.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'SCHEDULE_BLOCK_NOT_FOUND';
  end if;

  if char_length(coalesce(p_reason, '')) > 200 then
    raise exception 'SCHEDULE_BLOCK_REASON_TOO_LONG';
  end if;

  select block_starts_at, block_ends_at
  into v_starts_at, v_ends_at
  from public.resolve_teacher_schedule_block_window(
    v_teacher_id,
    p_block_date,
    p_start_time,
    p_end_time
  );

  if exists (
    select 1
    from public.lessons l
    where l.teacher_id = v_teacher_id
      and l.status <> 'cancelled'::public.lesson_status
      and l.starts_at < v_ends_at
      and l.ends_at > v_starts_at
  ) then
    raise exception 'SCHEDULE_BLOCK_LESSON_CONFLICT';
  end if;

  begin
    update public.teacher_schedule_blocks
    set
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      reason = nullif(btrim(p_reason), ''),
      updated_at = now()
    where id = p_block_id;
  exception
    when exclusion_violation then
      raise exception 'SCHEDULE_BLOCK_CONFLICT';
  end;
end;
$function$;

create or replace function public.delete_teacher_schedule_block(
  p_block_id uuid
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

  delete from public.teacher_schedule_blocks b
  where b.id = p_block_id
    and b.teacher_id = v_teacher_id;

  if not found then
    raise exception 'SCHEDULE_BLOCK_NOT_FOUND';
  end if;
end;
$function$;

revoke all on function public.create_teacher_schedule_block(
  date, time without time zone, time without time zone, text
) from public, anon;
grant execute on function public.create_teacher_schedule_block(
  date, time without time zone, time without time zone, text
) to authenticated, service_role;

revoke all on function public.update_teacher_schedule_block(
  uuid, date, time without time zone, time without time zone, text
) from public, anon;
grant execute on function public.update_teacher_schedule_block(
  uuid, date, time without time zone, time without time zone, text
) to authenticated, service_role;

revoke all on function public.delete_teacher_schedule_block(uuid)
  from public, anon;
grant execute on function public.delete_teacher_schedule_block(uuid)
  to authenticated, service_role;

-- A block is a hard DB-level availability constraint for every concrete lesson
-- insert/reschedule path. Existing lessons are protected in the opposite
-- direction by the block CRUD RPCs above.
create or replace function public.enforce_teacher_schedule_blocks_on_lessons()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.teacher_id::text, 0)
  );

  if new.status <> 'cancelled'::public.lesson_status
     and exists (
       select 1
       from public.teacher_schedule_blocks b
       where b.teacher_id = new.teacher_id
         and b.starts_at < new.ends_at
         and b.ends_at > new.starts_at
     ) then
    raise exception 'SCHEDULE_BLOCK_CONFLICT';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_teacher_schedule_blocks_on_lessons()
  from public, anon, authenticated;
grant execute on function public.enforce_teacher_schedule_blocks_on_lessons()
  to service_role;

drop trigger if exists lessons_enforce_teacher_schedule_blocks
  on public.lessons;
create trigger lessons_enforce_teacher_schedule_blocks
before insert or update
on public.lessons
for each row
execute function public.enforce_teacher_schedule_blocks_on_lessons();

-- Prevent a student from submitting a new extra-lesson request into a block.
-- A request that was already pending before a later block is created remains
-- pending; approval will fail safely through the lesson trigger above.
create or replace function public.enforce_schedule_blocks_on_extra_lesson_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ends_at timestamptz;
begin
  if new.request_type = 'extra_lesson'::public.lesson_request_type
     and new.status = 'pending'::public.lesson_request_status then
    v_ends_at :=
      new.requested_starts_at + make_interval(mins => new.duration_minutes);

    if exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.teacher_id = new.teacher_id
        and b.starts_at < v_ends_at
        and b.ends_at > new.requested_starts_at
    ) then
      raise exception 'SCHEDULE_BLOCK_CONFLICT';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_schedule_blocks_on_extra_lesson_requests()
  from public, anon, authenticated;
grant execute on function public.enforce_schedule_blocks_on_extra_lesson_requests()
  to service_role;

drop trigger if exists lesson_requests_enforce_schedule_blocks
  on public.lesson_requests;
create trigger lesson_requests_enforce_schedule_blocks
before insert or update
on public.lesson_requests
for each row
execute function public.enforce_schedule_blocks_on_extra_lesson_requests();

-- Recurring rules themselves remain valid when one particular date is blocked.
-- The generator skips that occurrence and counts it as a conflict.
CREATE OR REPLACE FUNCTION public.generate_recurring_lessons (
  p_recurring_lesson_id uuid,
  p_until               date
)
  RETURNS TABLE (
    created_count  integer,
    existing_count integer,
    conflict_count integer,
    past_count     integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_rule public.recurring_lessons%rowtype;

  v_today date;
  v_start_date date;
  v_end_date date;
  v_date date;

  v_starts_at timestamptz;
  v_ends_at timestamptz;

  v_created integer := 0;
  v_existing integer := 0;
  v_conflicts integer := 0;
  v_past integer := 0;

  v_weeks_from_anchor integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select *
  into v_rule
  from public.recurring_lessons
  where id = p_recurring_lesson_id;

  if not found then
    raise exception 'RECURRING_LESSON_NOT_FOUND';
  end if;

  if v_rule.teacher_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_rule.teacher_id::text, 0)
  );

  if not v_rule.is_active then
    raise exception 'RECURRING_LESSON_INACTIVE';
  end if;

  if p_until is null then
    raise exception 'UNTIL_REQUIRED';
  end if;

  v_today :=
    (now() at time zone v_rule.timezone)::date;

  v_start_date :=
    greatest(
      v_rule.valid_from,
      v_rule.anchor_date,
      v_today
    );

  if v_rule.valid_until is null then
    v_end_date := p_until;
  else
    v_end_date :=
      least(
        p_until,
        v_rule.valid_until
      );
  end if;

  if v_end_date < v_start_date then
    return query
    select 0, 0, 0, 0;

    return;
  end if;

  for v_date in
    select d::date
    from generate_series(
      v_start_date::timestamp,
      v_end_date::timestamp,
      interval '1 day'
    ) as gs(d)
  loop

    /*
     * Правильний weekday.
     */
    if extract(isodow from v_date)::integer
         <> v_rule.weekday
    then
      continue;
    end if;

    /*
     * Скільки повних тижнів минуло
     * від anchor_date.
     */
    v_weeks_from_anchor :=
      (v_date - v_rule.anchor_date) / 7;

    /*
     * interval_weeks = 1:
     * 0,1,2,3... → усі тижні.
     *
     * interval_weeks = 2:
     * 0,2,4,6... → через тиждень.
     */
    if mod(
         v_weeks_from_anchor,
         v_rule.interval_weeks
       ) <> 0
    then
      continue;
    end if;

    v_starts_at :=
      (
        v_date + v_rule.start_time
      )
      at time zone v_rule.timezone;

    v_ends_at :=
      v_starts_at
      + make_interval(
          mins => v_rule.duration_minutes
        );

    if v_starts_at <= now() then
      v_past := v_past + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.recurring_lesson_id = v_rule.id
        and l.starts_at = v_starts_at
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.teacher_id = v_rule.teacher_id
        and b.starts_at < v_ends_at
        and b.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_rule.teacher_id
        and l.status <> 'cancelled'
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.student_id = v_rule.student_id
        and l.status <> 'cancelled'
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
        starts_at,
        ends_at,
        duration_minutes,
        status,
        zoom_url
      )
      values (
        v_rule.student_id,
        v_rule.teacher_id,
        v_rule.id,
        v_starts_at,
        v_ends_at,
        v_rule.duration_minutes,
        'scheduled',
        v_rule.zoom_url
      );

      v_created := v_created + 1;

    exception
      when exclusion_violation
        or unique_violation
      then
        v_conflicts := v_conflicts + 1;
    end;

  end loop;

  return query
  select
    v_created,
    v_existing,
    v_conflicts,
    v_past;
end;
$function$;

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
    and not exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.teacher_id = v_teacher_id
        and b.starts_at < (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration)
        and b.ends_at > (slot.slot_local at time zone v_timezone)
    )
  order by 1;
end;
$function$;

-- get_extra_lesson_availability now hides intervals overlapping teacher blocks.

commit;
