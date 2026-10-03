begin;

-- Step 2.1: recurring teacher schedule blocks.
-- Recurrence math is shared by recurring lessons and recurring blocks.

create or replace function public.get_recurring_occurrence_dates(
  p_weekday smallint,
  p_anchor_date date,
  p_interval_weeks smallint,
  p_valid_from date,
  p_valid_until date,
  p_from date,
  p_until date
)
returns table (occurrence_date date)
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_from date;
  v_until date;
  v_cycle_days integer;
  v_cycles_to_skip integer;
  v_first_date date;
begin
  if p_weekday < 1 or p_weekday > 7 then
    raise exception 'INVALID_WEEKDAY';
  end if;

  if p_interval_weeks < 1 or p_interval_weeks > 52 then
    raise exception 'INVALID_INTERVAL_WEEKS';
  end if;

  if p_anchor_date is null or p_valid_from is null or p_from is null or p_until is null then
    return;
  end if;

  if extract(isodow from p_anchor_date)::integer <> p_weekday then
    raise exception 'INVALID_ANCHOR_DATE';
  end if;

  v_from := greatest(p_from, p_valid_from, p_anchor_date);
  v_until := least(p_until, coalesce(p_valid_until, p_until));

  if v_until < v_from then
    return;
  end if;

  v_cycle_days := p_interval_weeks * 7;
  v_cycles_to_skip := greatest(
    0,
    ((v_from - p_anchor_date) + v_cycle_days - 1) / v_cycle_days
  );
  v_first_date := p_anchor_date + v_cycles_to_skip * v_cycle_days;

  if v_first_date > v_until then
    return;
  end if;

  return query
  select d::date
  from pg_catalog.generate_series(
    v_first_date::timestamp,
    v_until::timestamp,
    make_interval(days => v_cycle_days)
  ) as gs(d)
  order by d;
end;
$function$;

create or replace function public.recurring_patterns_overlap(
  p_weekday_a smallint,
  p_anchor_a date,
  p_interval_a smallint,
  p_valid_until_a date,
  p_start_a time without time zone,
  p_end_a time without time zone,
  p_weekday_b smallint,
  p_anchor_b date,
  p_interval_b smallint,
  p_valid_until_b date,
  p_start_b time without time zone,
  p_end_b time without time zone
)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_from date;
  v_until date;
begin
  if p_weekday_a <> p_weekday_b then
    return false;
  end if;

  if p_start_a >= p_end_b or p_end_a <= p_start_b then
    return false;
  end if;

  v_from := greatest(p_anchor_a, p_anchor_b);
  -- interval_weeks is capped at 52. Looking across 52 * 52 weeks is
  -- sufficient to cover a full alignment cycle for any two supported intervals.
  v_until := least(
    coalesce(p_valid_until_a, v_from + (52 * 52 * 7)),
    coalesce(p_valid_until_b, v_from + (52 * 52 * 7))
  );

  if v_until < v_from then
    return false;
  end if;

  return exists (
    select 1
    from public.get_recurring_occurrence_dates(
      p_weekday_a,
      p_anchor_a,
      p_interval_a,
      p_anchor_a,
      p_valid_until_a,
      v_from,
      v_until
    ) a
    where mod(((a.occurrence_date - p_anchor_b) / 7), p_interval_b) = 0
      and a.occurrence_date >= p_anchor_b
      and (p_valid_until_b is null or a.occurrence_date <= p_valid_until_b)
  );
end;
$function$;

revoke all on function public.get_recurring_occurrence_dates(
  smallint, date, smallint, date, date, date, date
) from public, anon, authenticated;
revoke all on function public.recurring_patterns_overlap(
  smallint, date, smallint, date, time without time zone, time without time zone,
  smallint, date, smallint, date, time without time zone, time without time zone
) from public, anon, authenticated;
grant execute on function public.get_recurring_occurrence_dates(
  smallint, date, smallint, date, date, date, date
) to service_role;
grant execute on function public.recurring_patterns_overlap(
  smallint, date, smallint, date, time without time zone, time without time zone,
  smallint, date, smallint, date, time without time zone, time without time zone
) to service_role;

create table public.teacher_schedule_block_series (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time without time zone not null,
  end_time time without time zone not null,
  timezone text not null,
  valid_from date not null,
  valid_until date,
  anchor_date date not null,
  interval_weeks smallint not null default 1 check (interval_weeks between 1 and 52),
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_schedule_block_series_time_check check (end_time > start_time),
  constraint teacher_schedule_block_series_date_check check (
    valid_until is null or valid_until >= valid_from
  ),
  constraint teacher_schedule_block_series_reason_check check (
    reason is null or char_length(reason) <= 200
  )
);

create index teacher_schedule_block_series_teacher_active_idx
  on public.teacher_schedule_block_series (teacher_id, weekday, start_time)
  where is_active = true;

alter table public.teacher_schedule_block_series enable row level security;

create policy "Teacher can view own schedule block series"
on public.teacher_schedule_block_series
for select
to authenticated
using (teacher_id = auth.uid() and public.is_teacher());

revoke all on table public.teacher_schedule_block_series from public, anon, authenticated;
grant select on table public.teacher_schedule_block_series to authenticated;
grant all on table public.teacher_schedule_block_series to service_role;

alter table public.teacher_schedule_blocks
  add column recurring_block_series_id uuid
    references public.teacher_schedule_block_series(id) on delete set null,
  add column is_cancelled boolean not null default false;

alter table public.teacher_schedule_blocks
  drop constraint teacher_schedule_blocks_no_overlap;

alter table public.teacher_schedule_blocks
  add constraint teacher_schedule_blocks_no_overlap exclude using gist (
    teacher_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (not is_cancelled);

create index teacher_schedule_blocks_recurring_series_idx
  on public.teacher_schedule_blocks (recurring_block_series_id, starts_at)
  where recurring_block_series_id is not null;

create unique index teacher_schedule_blocks_recurring_occurrence_unique_idx
  on public.teacher_schedule_blocks (recurring_block_series_id, starts_at)
  where recurring_block_series_id is not null;

create or replace function public.is_teacher_recurring_blocked(
  p_teacher_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_series_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.teacher_schedule_block_series s
    cross join lateral (
      select
        (p_starts_at at time zone s.timezone)::date as local_date,
        (p_starts_at at time zone s.timezone)::time as local_start,
        (p_ends_at at time zone s.timezone)::time as local_end
    ) x
    where s.teacher_id = p_teacher_id
      and s.is_active = true
      and (p_exclude_series_id is null or s.id <> p_exclude_series_id)
      and x.local_date >= s.anchor_date
      and x.local_date >= s.valid_from
      and (s.valid_until is null or x.local_date <= s.valid_until)
      and extract(isodow from x.local_date)::integer = s.weekday
      and mod(((x.local_date - s.anchor_date) / 7), s.interval_weeks) = 0
      and x.local_start < s.end_time
      and x.local_end > s.start_time
      and not exists (
        select 1
        from public.teacher_schedule_blocks b
        where b.recurring_block_series_id = s.id
          and b.is_cancelled
          and b.starts_at =
            ((x.local_date::timestamp + s.start_time) at time zone s.timezone)
      )
  );
$function$;

revoke all on function public.is_teacher_recurring_blocked(
  uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.is_teacher_recurring_blocked(
  uuid, timestamptz, timestamptz, uuid
) to service_role;

-- One-time block CRUD now respects recurring block rules.
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
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_teacher_id::text, 0)
  );

  if char_length(coalesce(p_reason, '')) > 200 then
    raise exception 'SCHEDULE_BLOCK_REASON_TOO_LONG';
  end if;

  select block_starts_at, block_ends_at
  into v_starts_at, v_ends_at
  from public.resolve_teacher_schedule_block_window(
    v_teacher_id, p_block_date, p_start_time, p_end_time
  );

  if public.is_teacher_recurring_blocked(
    v_teacher_id, v_starts_at, v_ends_at, null
  ) then
    raise exception 'SCHEDULE_BLOCK_CONFLICT';
  end if;

  if exists (
    select 1 from public.lessons l
    where l.teacher_id = v_teacher_id
      and l.status <> 'cancelled'::public.lesson_status
      and l.starts_at < v_ends_at
      and l.ends_at > v_starts_at
  ) then
    raise exception 'SCHEDULE_BLOCK_LESSON_CONFLICT';
  end if;

  begin
    insert into public.teacher_schedule_blocks (
      teacher_id, starts_at, ends_at, reason
    ) values (
      v_teacher_id, v_starts_at, v_ends_at, nullif(btrim(p_reason), '')
    ) returning id into v_block_id;
  exception when exclusion_violation then
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
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_teacher_id::text, 0)
  );

  select * into v_existing
  from public.teacher_schedule_blocks b
  where b.id = p_block_id
    and b.teacher_id = v_teacher_id
    and not b.is_cancelled
  for update;

  if not found then raise exception 'SCHEDULE_BLOCK_NOT_FOUND'; end if;

  if v_existing.recurring_block_series_id is not null then
    raise exception 'RECURRING_BLOCK_REQUIRES_SERIES_EDIT';
  end if;

  if char_length(coalesce(p_reason, '')) > 200 then
    raise exception 'SCHEDULE_BLOCK_REASON_TOO_LONG';
  end if;

  select block_starts_at, block_ends_at
  into v_starts_at, v_ends_at
  from public.resolve_teacher_schedule_block_window(
    v_teacher_id, p_block_date, p_start_time, p_end_time
  );

  if public.is_teacher_recurring_blocked(
    v_teacher_id, v_starts_at, v_ends_at, null
  ) then
    raise exception 'SCHEDULE_BLOCK_CONFLICT';
  end if;

  if exists (
    select 1 from public.lessons l
    where l.teacher_id = v_teacher_id
      and l.status <> 'cancelled'::public.lesson_status
      and l.starts_at < v_ends_at
      and l.ends_at > v_starts_at
  ) then
    raise exception 'SCHEDULE_BLOCK_LESSON_CONFLICT';
  end if;

  begin
    update public.teacher_schedule_blocks
    set starts_at = v_starts_at,
        ends_at = v_ends_at,
        reason = nullif(btrim(p_reason), ''),
        updated_at = now()
    where id = p_block_id;
  exception when exclusion_violation then
    raise exception 'SCHEDULE_BLOCK_CONFLICT';
  end;
end;
$function$;

create or replace function public.delete_teacher_schedule_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_block public.teacher_schedule_blocks%rowtype;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select * into v_block
  from public.teacher_schedule_blocks b
  where b.id = p_block_id
    and b.teacher_id = v_teacher_id
    and not b.is_cancelled
  for update;

  if not found then raise exception 'SCHEDULE_BLOCK_NOT_FOUND'; end if;

  if v_block.recurring_block_series_id is not null then
    update public.teacher_schedule_blocks
    set is_cancelled = true, updated_at = now()
    where id = p_block_id;
  else
    delete from public.teacher_schedule_blocks where id = p_block_id;
  end if;
end;
$function$;

-- Generic lesson protection includes both materialized and rule-based blocks.
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

  if new.status <> 'cancelled'::public.lesson_status and (
    exists (
      select 1 from public.teacher_schedule_blocks b
      where b.teacher_id = new.teacher_id
        and not b.is_cancelled
        and b.starts_at < new.ends_at
        and b.ends_at > new.starts_at
    )
    or public.is_teacher_recurring_blocked(
      new.teacher_id, new.starts_at, new.ends_at, null
    )
  ) then
    raise exception 'SCHEDULE_BLOCK_CONFLICT';
  end if;

  return new;
end;
$function$;

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
    v_ends_at := new.requested_starts_at
      + make_interval(mins => new.duration_minutes);

    if exists (
      select 1 from public.teacher_schedule_blocks b
      where b.teacher_id = new.teacher_id
        and not b.is_cancelled
        and b.starts_at < v_ends_at
        and b.ends_at > new.requested_starts_at
    ) or public.is_teacher_recurring_blocked(
      new.teacher_id, new.requested_starts_at, v_ends_at, null
    ) then
      raise exception 'SCHEDULE_BLOCK_CONFLICT';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.create_recurring_schedule_block(
  p_weekday smallint,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_valid_from date,
  p_valid_until date default null,
  p_reason text default null,
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
  v_slot_interval smallint;
  v_is_working boolean;
  v_workday_start time;
  v_workday_end time;
  v_local_today date;
  v_anchor_date date;
  v_start_minutes integer;
  v_end_minutes integer;
  v_workday_start_minutes integer;
  v_series_id uuid;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_teacher_id::text, 0)
  );

  select ts.schedule_timezone, ts.slot_interval_minutes
  into v_timezone, v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = v_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;
  if p_weekday < 1 or p_weekday > 7 then raise exception 'INVALID_WEEKDAY'; end if;
  if p_interval_weeks < 1 or p_interval_weeks > 52 then
    raise exception 'INVALID_INTERVAL_WEEKS';
  end if;
  if p_end_time <= p_start_time then raise exception 'SCHEDULE_BLOCK_INVALID_RANGE'; end if;
  if char_length(coalesce(p_reason, '')) > 200 then
    raise exception 'SCHEDULE_BLOCK_REASON_TOO_LONG';
  end if;

  select wh.is_working, wh.workday_start, wh.workday_end
  into v_is_working, v_workday_start, v_workday_end
  from public.teacher_working_hours wh
  where wh.teacher_id = v_teacher_id and wh.weekday = p_weekday;

  if not found or not v_is_working then raise exception 'NON_WORKING_DAY'; end if;
  if p_start_time < v_workday_start or p_end_time > v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;
  if extract(second from p_start_time) <> 0 or extract(second from p_end_time) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_start_minutes := extract(hour from p_start_time)::integer * 60
    + extract(minute from p_start_time)::integer;
  v_end_minutes := extract(hour from p_end_time)::integer * 60
    + extract(minute from p_end_time)::integer;
  v_workday_start_minutes := extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_start_minutes - v_workday_start_minutes, v_slot_interval) <> 0
     or (p_end_time <> v_workday_end
         and mod(v_end_minutes - v_workday_start_minutes, v_slot_interval) <> 0) then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_local_today := (now() at time zone v_timezone)::date;
  if p_valid_from < v_local_today then raise exception 'VALID_FROM_IN_PAST'; end if;
  if p_valid_until is not null and p_valid_until < p_valid_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  v_anchor_date := p_valid_from
    + ((p_weekday - extract(isodow from p_valid_from)::integer + 7) % 7);

  if p_valid_until is not null and v_anchor_date > p_valid_until then
    raise exception 'NO_OCCURRENCE_IN_DATE_RANGE';
  end if;

  if exists (
    select 1
    from public.teacher_schedule_block_series s
    where s.teacher_id = v_teacher_id
      and s.is_active = true
      and public.recurring_patterns_overlap(
        p_weekday, v_anchor_date, p_interval_weeks, p_valid_until,
        p_start_time, p_end_time,
        s.weekday, s.anchor_date, s.interval_weeks, s.valid_until,
        s.start_time, s.end_time
      )
  ) then
    raise exception 'RECURRING_BLOCK_SERIES_CONFLICT';
  end if;

  if exists (
    select 1
    from public.recurring_lessons r
    where r.teacher_id = v_teacher_id
      and r.is_active = true
      and public.recurring_patterns_overlap(
        p_weekday, v_anchor_date, p_interval_weeks, p_valid_until,
        p_start_time, p_end_time,
        r.weekday, r.anchor_date, r.interval_weeks, r.valid_until,
        r.start_time,
        r.start_time + make_interval(mins => r.duration_minutes)
      )
  ) then
    raise exception 'RECURRING_BLOCK_LESSON_SERIES_CONFLICT';
  end if;

  insert into public.teacher_schedule_block_series (
    teacher_id, weekday, start_time, end_time, timezone,
    valid_from, valid_until, anchor_date, interval_weeks, reason, is_active
  ) values (
    v_teacher_id, p_weekday, p_start_time, p_end_time, v_timezone,
    p_valid_from, p_valid_until, v_anchor_date, p_interval_weeks,
    nullif(btrim(p_reason), ''), true
  ) returning id into v_series_id;

  return v_series_id;
end;
$function$;

create or replace function public.generate_recurring_schedule_blocks(
  p_series_id uuid,
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
  v_teacher_id uuid := auth.uid();
  v_rule public.teacher_schedule_block_series%rowtype;
  v_today date;
  v_date date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_created integer := 0;
  v_existing integer := 0;
  v_conflicts integer := 0;
  v_past integer := 0;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  if p_until is null then raise exception 'UNTIL_REQUIRED'; end if;

  select * into v_rule
  from public.teacher_schedule_block_series s
  where s.id = p_series_id and s.teacher_id = v_teacher_id
  for update;

  if not found then raise exception 'RECURRING_BLOCK_SERIES_NOT_FOUND'; end if;
  if not v_rule.is_active then raise exception 'RECURRING_BLOCK_SERIES_INACTIVE'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_teacher_id::text, 0)
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
    v_ends_at := (v_date::timestamp + v_rule.end_time) at time zone v_rule.timezone;

    if v_starts_at <= now() then
      v_past := v_past + 1;
      continue;
    end if;

    if exists (
      select 1 from public.teacher_schedule_blocks b
      where b.recurring_block_series_id = v_rule.id
        and b.starts_at = v_starts_at
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if exists (
      select 1 from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if exists (
      select 1 from public.teacher_schedule_blocks b
      where b.teacher_id = v_teacher_id
        and not b.is_cancelled
        and b.starts_at < v_ends_at
        and b.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    begin
      insert into public.teacher_schedule_blocks (
        teacher_id, starts_at, ends_at, reason, recurring_block_series_id
      ) values (
        v_teacher_id, v_starts_at, v_ends_at, v_rule.reason, v_rule.id
      );
      v_created := v_created + 1;
    exception when exclusion_violation or unique_violation then
      v_conflicts := v_conflicts + 1;
    end;
  end loop;

  return query select v_created, v_existing, v_conflicts, v_past;
end;
$function$;

create or replace function public.create_recurring_schedule_block_with_generation(
  p_weekday smallint,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_valid_from date,
  p_valid_until date,
  p_reason text default null,
  p_interval_weeks smallint default 1
)
returns table (
  recurring_block_series_id uuid,
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
  v_series_id uuid;
  v_result record;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  if p_valid_until is null then raise exception 'END_DATE_REQUIRED'; end if;

  v_series_id := public.create_recurring_schedule_block(
    p_weekday, p_start_time, p_end_time, p_valid_from,
    p_valid_until, p_reason, p_interval_weeks
  );

  select * into v_result
  from public.generate_recurring_schedule_blocks(v_series_id, p_valid_until);

  return query select
    v_series_id,
    coalesce(v_result.created_count, 0),
    coalesce(v_result.existing_count, 0),
    coalesce(v_result.conflict_count, 0),
    coalesce(v_result.past_count, 0);
end;
$function$;

create or replace function public.edit_recurring_schedule_block_series_from_block(
  p_block_id uuid,
  p_weekday smallint,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_interval_weeks smallint,
  p_valid_until date,
  p_reason text default null
)
returns table (
  new_recurring_block_series_id uuid,
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
  v_block public.teacher_schedule_blocks%rowtype;
  v_old_series public.teacher_schedule_block_series%rowtype;
  v_selected_local_date date;
  v_cutoff_date date;
  v_result record;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select * into v_block
  from public.teacher_schedule_blocks b
  where b.id = p_block_id
    and b.teacher_id = v_teacher_id
    and not b.is_cancelled
  for update;

  if not found then raise exception 'SCHEDULE_BLOCK_NOT_FOUND'; end if;
  if v_block.recurring_block_series_id is null then
    raise exception 'NOT_RECURRING_BLOCK';
  end if;
  if v_block.starts_at <= now() then
    raise exception 'PAST_BLOCK_CANNOT_BE_EDITED';
  end if;

  select * into v_old_series
  from public.teacher_schedule_block_series s
  where s.id = v_block.recurring_block_series_id
    and s.teacher_id = v_teacher_id
  for update;

  if not found then raise exception 'RECURRING_BLOCK_SERIES_NOT_FOUND'; end if;

  v_selected_local_date := (v_block.starts_at at time zone v_old_series.timezone)::date;
  v_cutoff_date := v_selected_local_date - 1;

  if p_valid_until is null then
    raise exception 'END_DATE_REQUIRED';
  end if;
  if p_valid_until < v_selected_local_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if v_selected_local_date <= v_old_series.anchor_date then
    update public.teacher_schedule_block_series
    set is_active = false, updated_at = now()
    where id = v_old_series.id;
  else
    update public.teacher_schedule_block_series
    set valid_until = case
          when valid_until is null then v_cutoff_date
          else least(valid_until, v_cutoff_date)
        end,
        updated_at = now()
    where id = v_old_series.id;
  end if;

  update public.teacher_schedule_blocks
  set is_cancelled = true, updated_at = now()
  where recurring_block_series_id = v_old_series.id
    and starts_at >= v_block.starts_at
    and not is_cancelled;
  get diagnostics cancelled_count = row_count;

  select * into v_result
  from public.create_recurring_schedule_block_with_generation(
    p_weekday,
    p_start_time,
    p_end_time,
    v_selected_local_date,
    p_valid_until,
    p_reason,
    p_interval_weeks
  );

  new_recurring_block_series_id := v_result.recurring_block_series_id;
  created_count := coalesce(v_result.created_count, 0);
  conflict_count := coalesce(v_result.conflict_count, 0);
  return next;
end;
$function$;

create or replace function public.cancel_recurring_schedule_block_series_from_block(
  p_block_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_block public.teacher_schedule_blocks%rowtype;
  v_series public.teacher_schedule_block_series%rowtype;
  v_selected_local_date date;
  v_cutoff_date date;
  v_cancelled_count integer := 0;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select * into v_block
  from public.teacher_schedule_blocks b
  where b.id = p_block_id
    and b.teacher_id = v_teacher_id
    and not b.is_cancelled
  for update;

  if not found then raise exception 'SCHEDULE_BLOCK_NOT_FOUND'; end if;
  if v_block.recurring_block_series_id is null then
    raise exception 'NOT_RECURRING_BLOCK';
  end if;
  if v_block.starts_at <= now() then
    raise exception 'PAST_BLOCK_CANNOT_BE_CANCELLED';
  end if;

  select * into v_series
  from public.teacher_schedule_block_series s
  where s.id = v_block.recurring_block_series_id
    and s.teacher_id = v_teacher_id
  for update;

  if not found then raise exception 'RECURRING_BLOCK_SERIES_NOT_FOUND'; end if;

  v_selected_local_date := (v_block.starts_at at time zone v_series.timezone)::date;
  v_cutoff_date := v_selected_local_date - 1;

  if v_selected_local_date <= v_series.anchor_date then
    update public.teacher_schedule_block_series
    set is_active = false, updated_at = now()
    where id = v_series.id;
  else
    update public.teacher_schedule_block_series
    set valid_until = case
          when valid_until is null then v_cutoff_date
          else least(valid_until, v_cutoff_date)
        end,
        updated_at = now()
    where id = v_series.id;
  end if;

  update public.teacher_schedule_blocks
  set is_cancelled = true, updated_at = now()
  where recurring_block_series_id = v_series.id
    and starts_at >= v_block.starts_at
    and not is_cancelled;
  get diagnostics v_cancelled_count = row_count;

  return v_cancelled_count;
end;
$function$;

-- New recurring lessons cannot be created inside an active recurring block rule.
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
    interval_weeks, zoom_url, is_active
  ) values (
    p_student_id, v_teacher_id, p_weekday, p_start_time, v_timezone,
    v_duration, p_valid_from, p_valid_until, v_anchor_date,
    p_interval_weeks, nullif(trim(p_zoom_url), ''), true
  ) returning id into v_recurring_lesson_id;

  return v_recurring_lesson_id;
end;
$function$;

-- Refactor recurring lesson generation to the shared occurrence-date helper.
create or replace function public.generate_recurring_lessons(
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
  v_user_id uuid := auth.uid();
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
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select * into v_rule from public.recurring_lessons where id = p_recurring_lesson_id;
  if not found then raise exception 'RECURRING_LESSON_NOT_FOUND'; end if;
  if v_rule.teacher_id <> v_user_id then raise exception 'FORBIDDEN'; end if;
  if not v_rule.is_active then raise exception 'RECURRING_LESSON_INACTIVE'; end if;
  if p_until is null then raise exception 'UNTIL_REQUIRED'; end if;

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
    v_starts_at := (v_date + v_rule.start_time) at time zone v_rule.timezone;
    v_ends_at := v_starts_at + make_interval(mins => v_rule.duration_minutes);

    if v_starts_at <= now() then v_past := v_past + 1; continue; end if;

    if exists (
      select 1 from public.lessons l
      where l.recurring_lesson_id = v_rule.id and l.starts_at = v_starts_at
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if exists (
      select 1 from public.teacher_schedule_blocks b
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

    if exists (
      select 1 from public.lessons l
      where l.teacher_id = v_rule.teacher_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) or exists (
      select 1 from public.lessons l
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
        student_id, teacher_id, recurring_lesson_id, starts_at, ends_at,
        duration_minutes, status, zoom_url
      ) values (
        v_rule.student_id, v_rule.teacher_id, v_rule.id, v_starts_at, v_ends_at,
        v_rule.duration_minutes, 'scheduled', v_rule.zoom_url
      );
      v_created := v_created + 1;
    exception when exclusion_violation or unique_violation then
      v_conflicts := v_conflicts + 1;
    end;
  end loop;

  return query select v_created, v_existing, v_conflicts, v_past;
end;
$function$;

-- Availability checks the recurring rule itself, not only 8-week materialized blocks.
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
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'student' and is_active = true
  ) then raise exception 'STUDENT_REQUIRED'; end if;

  v_teacher_id := public.resolve_my_teacher_id();

  select ts.schedule_timezone, ts.lesson_duration_minutes, ts.slot_interval_minutes
  into v_timezone, v_duration, v_slot_interval
  from public.teacher_settings ts where ts.teacher_id = v_teacher_id;
  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;

  select wh.is_working, wh.workday_start, wh.workday_end
  into v_is_working, v_workday_start, v_workday_end
  from public.teacher_working_hours wh
  where wh.teacher_id = v_teacher_id
    and wh.weekday = extract(isodow from p_date)::integer;

  if not found or not v_is_working then return; end if;

  v_local_day_start := p_date + v_workday_start;
  v_local_last_start := p_date + v_workday_end - make_interval(mins => v_duration);
  if v_local_last_start < v_local_day_start then return; end if;

  return query
  select
    slot.slot_local at time zone v_timezone,
    (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration),
    v_timezone,
    v_duration
  from pg_catalog.generate_series(
    v_local_day_start,
    v_local_last_start,
    make_interval(mins => v_slot_interval)
  ) as slot(slot_local)
  where (slot.slot_local at time zone v_timezone) > now()
    and not exists (
      select 1 from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration)
        and l.ends_at > (slot.slot_local at time zone v_timezone)
    )
    and not exists (
      select 1 from public.teacher_schedule_blocks b
      where b.teacher_id = v_teacher_id
        and not b.is_cancelled
        and b.starts_at < (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration)
        and b.ends_at > (slot.slot_local at time zone v_timezone)
    )
    and not public.is_teacher_recurring_blocked(
      v_teacher_id,
      slot.slot_local at time zone v_timezone,
      (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration),
      null
    )
  order by 1;
end;
$function$;

-- RPC privileges.
revoke all on function public.create_recurring_schedule_block(
  smallint, time without time zone, time without time zone, date, date, text, smallint
) from public, anon;
revoke all on function public.generate_recurring_schedule_blocks(uuid, date)
  from public, anon, authenticated;
revoke all on function public.create_recurring_schedule_block_with_generation(
  smallint, time without time zone, time without time zone, date, date, text, smallint
) from public, anon;
revoke all on function public.edit_recurring_schedule_block_series_from_block(
  uuid, smallint, time without time zone, time without time zone, smallint, date, text
) from public, anon;
revoke all on function public.cancel_recurring_schedule_block_series_from_block(uuid)
  from public, anon;

grant execute on function public.create_recurring_schedule_block(
  smallint, time without time zone, time without time zone, date, date, text, smallint
) to service_role;
grant execute on function public.generate_recurring_schedule_blocks(uuid, date)
  to service_role;
grant execute on function public.create_recurring_schedule_block_with_generation(
  smallint, time without time zone, time without time zone, date, date, text, smallint
) to authenticated, service_role;
grant execute on function public.edit_recurring_schedule_block_series_from_block(
  uuid, smallint, time without time zone, time without time zone, smallint, date, text
) to authenticated, service_role;
grant execute on function public.cancel_recurring_schedule_block_series_from_block(uuid)
  to authenticated, service_role;

commit;
