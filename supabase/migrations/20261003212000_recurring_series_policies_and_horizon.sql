begin;

-- Step 3: unify recurring lesson / recurring block lifecycle.
-- Fixed series materialize fully through valid_until.
-- Open-ended series materialize through a rolling horizon, while the series
-- itself remains the source of truth for DB-level slot reservation.

-- ---------------------------------------------------------------------------
-- 1. Teacher preferences.
-- ---------------------------------------------------------------------------

alter table public.teacher_settings
  add column if not exists reschedule_price_policy text not null default 'keep_original',
  add column if not exists allow_open_ended_recurring_lessons boolean not null default true,
  add column if not exists recurring_generation_horizon_weeks smallint not null default 8;

alter table public.teacher_settings
  drop constraint if exists teacher_settings_reschedule_price_policy_check;
alter table public.teacher_settings
  add constraint teacher_settings_reschedule_price_policy_check
  check (reschedule_price_policy in ('keep_original', 'target_date_tariff'));

alter table public.teacher_settings
  drop constraint if exists teacher_settings_recurring_generation_horizon_check;
alter table public.teacher_settings
  add constraint teacher_settings_recurring_generation_horizon_check
  check (recurring_generation_horizon_weeks between 1 and 52);

comment on column public.teacher_settings.reschedule_price_policy is
  'keep_original preserves the current lesson price when moved; target_date_tariff reprices it using the tariff effective on the destination local date.';
comment on column public.teacher_settings.allow_open_ended_recurring_lessons is
  'When false, new or edited recurring lesson series must have valid_until. Existing open series are not changed.';
comment on column public.teacher_settings.recurring_generation_horizon_weeks is
  'Rolling materialization horizon for open-ended recurring lesson and schedule-block series.';

-- Keep the previous Settings RPC for staggered deployments and add a v2 RPC
-- that atomically saves schedule + recurring preferences.
create or replace function public.update_my_schedule_settings_v2(
  p_schedule_timezone text,
  p_lesson_duration_minutes smallint,
  p_working_hours jsonb,
  p_reschedule_price_policy text,
  p_allow_open_ended_recurring_lessons boolean,
  p_recurring_generation_horizon_weeks smallint
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
    select 1 from pg_catalog.pg_timezone_names tz
    where tz.name = p_schedule_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  if p_lesson_duration_minutes < 30 or p_lesson_duration_minutes > 120 then
    raise exception 'INVALID_LESSON_DURATION';
  end if;

  if p_reschedule_price_policy not in ('keep_original', 'target_date_tariff') then
    raise exception 'INVALID_RESCHEDULE_PRICE_POLICY';
  end if;

  if p_allow_open_ended_recurring_lessons is null then
    raise exception 'INVALID_OPEN_ENDED_RECURRING_POLICY';
  end if;

  if p_recurring_generation_horizon_weeks is null
     or p_recurring_generation_horizon_weeks < 1
     or p_recurring_generation_horizon_weeks > 52 then
    raise exception 'INVALID_RECURRING_HORIZON';
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
  into v_enabled_start, v_enabled_end
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
    workday_start = coalesce(v_enabled_start, ts.workday_start),
    workday_end = coalesce(v_enabled_end, ts.workday_end),
    reschedule_price_policy = p_reschedule_price_policy,
    allow_open_ended_recurring_lessons = p_allow_open_ended_recurring_lessons,
    recurring_generation_horizon_weeks = p_recurring_generation_horizon_weeks,
    updated_at = now()
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  insert into public.teacher_working_hours (
    teacher_id, weekday, is_working, workday_start, workday_end, updated_at
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

revoke all on function public.update_my_schedule_settings_v2(
  text, smallint, jsonb, text, boolean, smallint
) from public, anon;
grant execute on function public.update_my_schedule_settings_v2(
  text, smallint, jsonb, text, boolean, smallint
) to authenticated, service_role;

-- Enforce the open-ended lesson-series preference at the table boundary too,
-- so direct RPC/table insert paths cannot bypass Settings. Existing open series
-- remain untouched when the preference is later disabled.
create or replace function public.enforce_recurring_lesson_open_ended_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_allow_open boolean;
begin
  if new.valid_until is null then
    select ts.allow_open_ended_recurring_lessons
    into v_allow_open
    from public.teacher_settings ts
    where ts.teacher_id = new.teacher_id;

    if not coalesce(v_allow_open, true) then
      raise exception 'END_DATE_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_recurring_lesson_open_ended_policy()
  from public, anon, authenticated;
grant execute on function public.enforce_recurring_lesson_open_ended_policy()
  to service_role;

drop trigger if exists recurring_lessons_enforce_open_ended_policy
  on public.recurring_lessons;
create trigger recurring_lessons_enforce_open_ended_policy
before insert on public.recurring_lessons
for each row
execute function public.enforce_recurring_lesson_open_ended_policy();

-- ---------------------------------------------------------------------------
-- 2. Stable recurring occurrence identity + reschedule price policy.
-- ---------------------------------------------------------------------------

alter table public.lessons
  add column if not exists occurrence_date date,
  add column if not exists reschedule_price_policy_applied text;

alter table public.lessons
  drop constraint if exists lessons_reschedule_price_policy_applied_check;
alter table public.lessons
  add constraint lessons_reschedule_price_policy_applied_check
  check (
    reschedule_price_policy_applied is null
    or reschedule_price_policy_applied in ('keep_original', 'target_date_tariff')
  );

-- Before Step 3, recurring reschedules always preserved pricing_date, so it is
-- the best source for backfilling the original recurrence date.
update public.lessons l
set occurrence_date = coalesce(
  l.pricing_date,
  (l.starts_at at time zone coalesce(r.timezone, 'Europe/Kyiv'))::date
)
from public.recurring_lessons r
where l.recurring_lesson_id = r.id
  and l.occurrence_date is null;

create unique index if not exists lessons_recurring_occurrence_unique_idx
  on public.lessons (recurring_lesson_id, occurrence_date)
  where recurring_lesson_id is not null and occurrence_date is not null;

comment on column public.lessons.occurrence_date is
  'Stable original local recurrence date. It is preserved when the concrete lesson is rescheduled and prevents the recurring generator from recreating the original occurrence.';
comment on column public.lessons.reschedule_price_policy_applied is
  'Teacher reschedule price policy used on the most recent starts_at change.';

create or replace function public.assign_recurring_occurrence_date_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_timezone text;
begin
  if new.recurring_lesson_id is not null and new.occurrence_date is null then
    select r.timezone into v_timezone
    from public.recurring_lessons r
    where r.id = new.recurring_lesson_id;

    new.occurrence_date :=
      (new.starts_at at time zone coalesce(v_timezone, 'Europe/Kyiv'))::date;
  end if;

  return new;
end;
$function$;

create or replace function public.preserve_recurring_occurrence_date_on_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.recurring_lesson_id is not null
     and new.recurring_lesson_id = old.recurring_lesson_id
     and old.occurrence_date is not null then
    new.occurrence_date := old.occurrence_date;
  end if;

  return new;
end;
$function$;

revoke all on function public.assign_recurring_occurrence_date_on_insert()
  from public, anon, authenticated;
revoke all on function public.preserve_recurring_occurrence_date_on_update()
  from public, anon, authenticated;
grant execute on function public.assign_recurring_occurrence_date_on_insert()
  to service_role;
grant execute on function public.preserve_recurring_occurrence_date_on_update()
  to service_role;

drop trigger if exists lessons_assign_recurring_occurrence_date_before_insert
  on public.lessons;
create trigger lessons_assign_recurring_occurrence_date_before_insert
before insert on public.lessons
for each row
execute function public.assign_recurring_occurrence_date_on_insert();

drop trigger if exists lessons_preserve_recurring_occurrence_date_before_update
  on public.lessons;
create trigger lessons_preserve_recurring_occurrence_date_before_update
before update on public.lessons
for each row
execute function public.preserve_recurring_occurrence_date_on_update();

-- Replace the old unconditional price-preservation trigger with the teacher's
-- selected policy. The existing pricing_date remains the source date used by
-- future tariff refreshes.
create or replace function public.preserve_lesson_price_on_reschedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_timezone text;
  v_policy text;
  v_target_pricing_date date;
  v_rate public.student_lesson_rates%rowtype;
begin
  if new.starts_at is distinct from old.starts_at then
    select
      ts.schedule_timezone,
      ts.reschedule_price_policy
    into
      v_timezone,
      v_policy
    from public.teacher_settings ts
    where ts.teacher_id = new.teacher_id;

    v_policy := coalesce(v_policy, 'keep_original');

    if v_policy = 'target_date_tariff' then
      v_target_pricing_date :=
        (new.starts_at at time zone coalesce(v_timezone, 'Europe/Kyiv'))::date;

      new.pricing_date := v_target_pricing_date;

      select r.*
      into v_rate
      from public.student_lesson_rates r
      where r.teacher_id = new.teacher_id
        and r.student_id = new.student_id
        and r.effective_from <= v_target_pricing_date
        and (r.effective_to is null or v_target_pricing_date < r.effective_to)
      order by r.effective_from desc
      limit 1;

      if found then
        new.price_rate_id := v_rate.id;
        new.price_amount_minor := v_rate.amount_minor;
        new.price_currency := v_rate.currency;
      else
        new.price_rate_id := null;
        new.price_amount_minor := null;
        new.price_currency := null;
      end if;
    else
      new.pricing_date := old.pricing_date;
      new.price_rate_id := old.price_rate_id;
      new.price_amount_minor := old.price_amount_minor;
      new.price_currency := old.price_currency;
    end if;

    new.reschedule_price_policy_applied := v_policy;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Rule-based recurring lesson reservation beyond materialized horizon.
-- ---------------------------------------------------------------------------

create or replace function public.is_teacher_recurring_lesson_reserved(
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
    from public.recurring_lessons r
    cross join lateral (
      select
        (p_starts_at at time zone r.timezone)::date as local_date,
        (p_starts_at at time zone r.timezone)::time as local_start,
        (p_ends_at at time zone r.timezone)::time as local_end,
        ((p_starts_at at time zone r.timezone)::date::timestamp + r.start_time)
          at time zone r.timezone as expected_starts_at
    ) x
    where r.teacher_id = p_teacher_id
      and r.is_active = true
      and (p_exclude_series_id is null or r.id <> p_exclude_series_id)
      and x.local_date >= r.anchor_date
      and x.local_date >= r.valid_from
      and (r.valid_until is null or x.local_date <= r.valid_until)
      and extract(isodow from x.local_date)::integer = r.weekday
      and mod(((x.local_date - r.anchor_date) / 7), r.interval_weeks) = 0
      and x.local_start < r.start_time + make_interval(mins => r.duration_minutes)
      and x.local_end > r.start_time
      -- A materialized occurrence that was cancelled or moved away is an
      -- explicit exception for its original recurring slot.
      and not exists (
        select 1
        from public.lessons l
        where l.recurring_lesson_id = r.id
          and l.occurrence_date = x.local_date
          and (
            l.status = 'cancelled'::public.lesson_status
            or l.starts_at is distinct from x.expected_starts_at
          )
      )
  );
$function$;

revoke all on function public.is_teacher_recurring_lesson_reserved(
  uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.is_teacher_recurring_lesson_reserved(
  uuid, timestamptz, timestamptz, uuid
) to service_role;

-- Concrete lesson writes must respect recurring lesson reservations too.
-- A generated / moved occurrence excludes its own series but not other series.
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
      select 1
      from public.teacher_schedule_blocks b
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

  if new.status <> 'cancelled'::public.lesson_status
     and public.is_teacher_recurring_lesson_reserved(
       new.teacher_id,
       new.starts_at,
       new.ends_at,
       new.recurring_lesson_id
     ) then
    raise exception 'LESSON_TIME_CONFLICT';
  end if;

  return new;
end;
$function$;

-- Every block write must also respect recurring lesson reservations beyond the
-- materialized lesson horizon.
create or replace function public.enforce_recurring_lesson_reservations_on_schedule_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not new.is_cancelled
     and public.is_teacher_recurring_lesson_reserved(
       new.teacher_id, new.starts_at, new.ends_at, null
     ) then
    raise exception 'SCHEDULE_BLOCK_LESSON_CONFLICT';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_recurring_lesson_reservations_on_schedule_blocks()
  from public, anon, authenticated;
grant execute on function public.enforce_recurring_lesson_reservations_on_schedule_blocks()
  to service_role;

drop trigger if exists schedule_blocks_enforce_recurring_lessons
  on public.teacher_schedule_blocks;
create trigger schedule_blocks_enforce_recurring_lessons
before insert or update of starts_at, ends_at, is_cancelled
on public.teacher_schedule_blocks
for each row
execute function public.enforce_recurring_lesson_reservations_on_schedule_blocks();

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

    if public.is_teacher_recurring_lesson_reserved(
      new.teacher_id, new.requested_starts_at, v_ends_at, null
    ) then
      raise exception 'LESSON_TIME_CONFLICT';
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Internal materializers. Public wrappers keep the existing API contract;
--    cron uses the internal functions without an auth session.
-- ---------------------------------------------------------------------------

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
        zoom_url
      ) values (
        v_rule.student_id,
        v_rule.teacher_id,
        v_rule.id,
        v_date,
        v_starts_at,
        v_ends_at,
        v_rule.duration_minutes,
        'scheduled',
        v_rule.zoom_url
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
  v_teacher_id uuid := auth.uid();
  v_owner_id uuid;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select r.teacher_id into v_owner_id
  from public.recurring_lessons r
  where r.id = p_recurring_lesson_id;

  if not found then raise exception 'RECURRING_LESSON_NOT_FOUND'; end if;
  if v_owner_id <> v_teacher_id then raise exception 'FORBIDDEN'; end if;

  return query
  select * from public.materialize_recurring_lessons_internal(
    p_recurring_lesson_id,
    p_until
  );
end;
$function$;

create or replace function public.materialize_recurring_schedule_blocks_internal(
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
  if p_until is null then raise exception 'UNTIL_REQUIRED'; end if;

  select * into v_rule
  from public.teacher_schedule_block_series s
  where s.id = p_series_id
  for update;

  if not found then raise exception 'RECURRING_BLOCK_SERIES_NOT_FOUND'; end if;
  if not v_rule.is_active then raise exception 'RECURRING_BLOCK_SERIES_INACTIVE'; end if;

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
    v_ends_at := (v_date::timestamp + v_rule.end_time) at time zone v_rule.timezone;

    if v_starts_at <= now() then
      v_past := v_past + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.recurring_block_series_id = v_rule.id
        and b.starts_at = v_starts_at
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_rule.teacher_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) or public.is_teacher_recurring_lesson_reserved(
      v_rule.teacher_id,
      v_starts_at,
      v_ends_at,
      null
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.teacher_id = v_rule.teacher_id
        and not b.is_cancelled
        and b.starts_at < v_ends_at
        and b.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    begin
      insert into public.teacher_schedule_blocks (
        teacher_id,
        starts_at,
        ends_at,
        reason,
        recurring_block_series_id
      ) values (
        v_rule.teacher_id,
        v_starts_at,
        v_ends_at,
        v_rule.reason,
        v_rule.id
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
  v_owner_id uuid;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select s.teacher_id into v_owner_id
  from public.teacher_schedule_block_series s
  where s.id = p_series_id;

  if not found then raise exception 'RECURRING_BLOCK_SERIES_NOT_FOUND'; end if;
  if v_owner_id <> v_teacher_id then raise exception 'FORBIDDEN'; end if;

  return query
  select * from public.materialize_recurring_schedule_blocks_internal(
    p_series_id,
    p_until
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Fixed vs open-ended generation policy.
-- ---------------------------------------------------------------------------

create or replace function public.create_recurring_lesson_with_generation(
  p_student_id uuid,
  p_weekday smallint,
  p_start_time time without time zone,
  p_valid_from date,
  p_valid_until date default null,
  p_zoom_url text default null,
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
    p_zoom_url,
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
  p_zoom_url text default null,
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
    p_zoom_url => nullif(trim(p_zoom_url), ''),
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
  v_timezone text;
  v_horizon_weeks smallint;
  v_today date;
  v_generate_until date;
  v_series_id uuid;
  v_result record;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select ts.schedule_timezone, ts.recurring_generation_horizon_weeks
  into v_timezone, v_horizon_weeks
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;

  v_series_id := public.create_recurring_schedule_block(
    p_weekday,
    p_start_time,
    p_end_time,
    p_valid_from,
    p_valid_until,
    p_reason,
    p_interval_weeks
  );

  v_today := (now() at time zone v_timezone)::date;
  v_generate_until := case
    when p_valid_until is not null then p_valid_until
    else v_today + (coalesce(v_horizon_weeks, 8) * 7)
  end;

  select * into v_result
  from public.materialize_recurring_schedule_blocks_internal(
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
  if v_block.recurring_block_series_id is null then raise exception 'NOT_RECURRING_BLOCK'; end if;
  if v_block.starts_at <= now() then raise exception 'PAST_BLOCK_CANNOT_BE_EDITED'; end if;

  select * into v_old_series
  from public.teacher_schedule_block_series s
  where s.id = v_block.recurring_block_series_id
    and s.teacher_id = v_teacher_id
  for update;

  if not found then raise exception 'RECURRING_BLOCK_SERIES_NOT_FOUND'; end if;

  v_selected_local_date := (v_block.starts_at at time zone v_old_series.timezone)::date;
  v_cutoff_date := v_selected_local_date - 1;

  if p_valid_until is not null and p_valid_until < v_selected_local_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if v_selected_local_date <= v_old_series.anchor_date then
    update public.teacher_schedule_block_series
    set is_active = false, updated_at = now()
    where id = v_old_series.id;
  else
    update public.teacher_schedule_block_series
    set
      valid_until = case
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

-- ---------------------------------------------------------------------------
-- 6. Student extra availability sees recurring lesson reservations too.
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
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'student' and is_active = true
  ) then raise exception 'STUDENT_REQUIRED'; end if;

  v_teacher_id := public.resolve_my_teacher_id();

  select ts.schedule_timezone, ts.lesson_duration_minutes, ts.slot_interval_minutes
  into v_timezone, v_duration, v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

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
    and not public.is_teacher_recurring_lesson_reserved(
      v_teacher_id,
      slot.slot_local at time zone v_timezone,
      (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration),
      null
    )
  order by 1;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Rolling horizon maintenance for open-ended series.
-- ---------------------------------------------------------------------------

create or replace function public.process_recurring_series_horizons()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rule record;
  v_until date;
  v_result record;
  v_lesson_series integer := 0;
  v_lesson_created integer := 0;
  v_block_series integer := 0;
  v_block_created integer := 0;
begin
  for v_rule in
    select
      r.id,
      r.teacher_id,
      r.timezone,
      r.valid_until,
      coalesce(ts.recurring_generation_horizon_weeks, 8) as horizon_weeks
    from public.recurring_lessons r
    join public.teacher_settings ts on ts.teacher_id = r.teacher_id
    where r.is_active = true
  loop
    begin
      v_until := coalesce(
        v_rule.valid_until,
        (now() at time zone v_rule.timezone)::date
          + (v_rule.horizon_weeks * 7)
      );
      select * into v_result
      from public.materialize_recurring_lessons_internal(v_rule.id, v_until);
      v_lesson_series := v_lesson_series + 1;
      v_lesson_created := v_lesson_created + coalesce(v_result.created_count, 0);
    exception when others then
      raise warning 'Recurring lesson horizon skipped series %: %', v_rule.id, sqlerrm;
    end;
  end loop;

  for v_rule in
    select
      s.id,
      s.teacher_id,
      s.timezone,
      s.valid_until,
      coalesce(ts.recurring_generation_horizon_weeks, 8) as horizon_weeks
    from public.teacher_schedule_block_series s
    join public.teacher_settings ts on ts.teacher_id = s.teacher_id
    where s.is_active = true
  loop
    begin
      v_until := coalesce(
        v_rule.valid_until,
        (now() at time zone v_rule.timezone)::date
          + (v_rule.horizon_weeks * 7)
      );
      select * into v_result
      from public.materialize_recurring_schedule_blocks_internal(v_rule.id, v_until);
      v_block_series := v_block_series + 1;
      v_block_created := v_block_created + coalesce(v_result.created_count, 0);
    exception when others then
      raise warning 'Recurring block horizon skipped series %: %', v_rule.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'lessonSeriesProcessed', v_lesson_series,
    'lessonOccurrencesCreated', v_lesson_created,
    'blockSeriesProcessed', v_block_series,
    'blockOccurrencesCreated', v_block_created,
    'processedAt', now()
  );
end;
$function$;

revoke all on function public.materialize_recurring_lessons_internal(uuid, date)
  from public, anon, authenticated;
revoke all on function public.materialize_recurring_schedule_blocks_internal(uuid, date)
  from public, anon, authenticated;
revoke all on function public.process_recurring_series_horizons()
  from public, anon, authenticated;
grant execute on function public.materialize_recurring_lessons_internal(uuid, date)
  to service_role;
grant execute on function public.materialize_recurring_schedule_blocks_internal(uuid, date)
  to service_role;
grant execute on function public.process_recurring_series_horizons()
  to service_role;

-- Re-apply public wrapper privileges after CREATE OR REPLACE.
revoke all on function public.generate_recurring_lessons(uuid, date)
  from public, anon;
grant execute on function public.generate_recurring_lessons(uuid, date)
  to authenticated, service_role;

revoke all on function public.generate_recurring_schedule_blocks(uuid, date)
  from public, anon;
grant execute on function public.generate_recurring_schedule_blocks(uuid, date)
  to authenticated, service_role;

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

revoke all on function public.create_recurring_schedule_block_with_generation(
  smallint, time without time zone, time without time zone, date, date, text, smallint
) from public, anon;
grant execute on function public.create_recurring_schedule_block_with_generation(
  smallint, time without time zone, time without time zone, date, date, text, smallint
) to authenticated, service_role;

revoke all on function public.edit_recurring_schedule_block_series_from_block(
  uuid, smallint, time without time zone, time without time zone, smallint, date, text
) from public, anon;
grant execute on function public.edit_recurring_schedule_block_series_from_block(
  uuid, smallint, time without time zone, time without time zone, smallint, date, text
) to authenticated, service_role;

-- pg_cron is already used by lesson outcome automation. Keep the rolling horizon
-- fresh daily; the 8-week default leaves ample safety margin between runs.
select cron.schedule(
  'recurring-series-horizon-maintenance',
  '20 2 * * *',
  'select public.process_recurring_series_horizons();'
);

commit;
