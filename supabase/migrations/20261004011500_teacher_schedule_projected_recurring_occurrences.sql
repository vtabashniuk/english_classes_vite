begin;

-- Step 3.1: projected recurring occurrences for TeacherSchedule.
-- These functions are read-only. They let the teacher calendar visualize
-- recurring reservations that exist at the series level but have not yet been
-- materialized into concrete lessons / schedule blocks.

create or replace function public.get_teacher_projected_recurring_lessons(
  p_from date,
  p_until date
)
returns table (
  recurring_lesson_id uuid,
  student_id uuid,
  occurrence_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  duration_minutes smallint,
  student_full_name text,
  student_email text
)
language plpgsql
stable
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

  if p_from is null or p_until is null or p_until < p_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if p_until - p_from > 31 then
    raise exception 'DATE_RANGE_TOO_LARGE';
  end if;

  return query
  select
    r.id,
    r.student_id,
    o.occurrence_date,
    x.expected_starts_at,
    x.expected_ends_at,
    r.duration_minutes,
    p.full_name,
    p.email
  from public.recurring_lessons r
  join public.profiles p on p.id = r.student_id
  cross join lateral public.get_recurring_occurrence_dates(
    r.weekday,
    r.anchor_date,
    r.interval_weeks,
    r.valid_from,
    r.valid_until,
    p_from,
    p_until
  ) o
  cross join lateral (
    select
      ((o.occurrence_date::timestamp + r.start_time) at time zone r.timezone)
        as expected_starts_at,
      (((o.occurrence_date::timestamp + r.start_time) at time zone r.timezone)
        + make_interval(mins => r.duration_minutes)) as expected_ends_at
  ) x
  where r.teacher_id = v_teacher_id
    and r.is_active = true
    -- Any concrete occurrence row means this date has already been
    -- materialized or explicitly turned into an exception by cancellation / move.
    and not exists (
      select 1
      from public.lessons l
      where l.recurring_lesson_id = r.id
        and l.occurrence_date = o.occurrence_date
    )
    -- If another concrete item currently occupies the expected slot, the
    -- calendar already has something real to render there.
    and not exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < x.expected_ends_at
        and l.ends_at > x.expected_starts_at
    )
    and not exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.teacher_id = v_teacher_id
        and not b.is_cancelled
        and b.starts_at < x.expected_ends_at
        and b.ends_at > x.expected_starts_at
    )
    and not public.is_teacher_recurring_blocked(
      v_teacher_id,
      x.expected_starts_at,
      x.expected_ends_at,
      null
    )
  order by x.expected_starts_at;
end;
$function$;

create or replace function public.get_teacher_projected_recurring_blocks(
  p_from date,
  p_until date
)
returns table (
  recurring_block_series_id uuid,
  occurrence_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  reason text
)
language plpgsql
stable
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

  if p_from is null or p_until is null or p_until < p_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if p_until - p_from > 31 then
    raise exception 'DATE_RANGE_TOO_LARGE';
  end if;

  return query
  select
    s.id,
    o.occurrence_date,
    x.expected_starts_at,
    x.expected_ends_at,
    s.reason
  from public.teacher_schedule_block_series s
  cross join lateral public.get_recurring_occurrence_dates(
    s.weekday,
    s.anchor_date,
    s.interval_weeks,
    s.valid_from,
    s.valid_until,
    p_from,
    p_until
  ) o
  cross join lateral (
    select
      ((o.occurrence_date::timestamp + s.start_time) at time zone s.timezone)
        as expected_starts_at,
      ((o.occurrence_date::timestamp + s.end_time) at time zone s.timezone)
        as expected_ends_at
  ) x
  where s.teacher_id = v_teacher_id
    and s.is_active = true
    -- A row exists for every materialized occurrence, including an explicitly
    -- cancelled one. The latter is an exception and must not be projected back.
    and not exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.recurring_block_series_id = s.id
        and b.starts_at = x.expected_starts_at
    )
    and not exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.status <> 'cancelled'::public.lesson_status
        and l.starts_at < x.expected_ends_at
        and l.ends_at > x.expected_starts_at
    )
    and not exists (
      select 1
      from public.teacher_schedule_blocks b
      where b.teacher_id = v_teacher_id
        and not b.is_cancelled
        and b.starts_at < x.expected_ends_at
        and b.ends_at > x.expected_starts_at
    )
    and not public.is_teacher_recurring_lesson_reserved(
      v_teacher_id,
      x.expected_starts_at,
      x.expected_ends_at,
      null
    )
  order by x.expected_starts_at;
end;
$function$;

revoke all on function public.get_teacher_projected_recurring_lessons(date, date)
  from public, anon, authenticated;
revoke all on function public.get_teacher_projected_recurring_blocks(date, date)
  from public, anon, authenticated;

grant execute on function public.get_teacher_projected_recurring_lessons(date, date)
  to authenticated, service_role;
grant execute on function public.get_teacher_projected_recurring_blocks(date, date)
  to authenticated, service_role;

commit;
