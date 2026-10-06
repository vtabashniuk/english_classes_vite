-- Financial-policy rounding + short-pause schedule semantics.
--
-- Financial access:
--   * convert all balances with the exact official cached NBU rate;
--   * only when FX is involved, round the final combined balance DOWN in the
--     tariff currency (UAH -> 10 UAH, USD/EUR -> 1 whole currency unit);
--   * blocking/recovery/recommended payment all use that same displayed value.
--
-- Student lifecycle:
--   * pause is explicitly temporary and may last at most 14 calendar days;
--   * recurring series stays active during a short pause, so another recurring
--     series cannot take the regular slot;
--   * concrete lessons inside the pause are materialized then teacher-cancelled
--     without charge, which frees those occurrences for one-time lessons/blocks;
--   * inactive cancels every future scheduled lesson and deactivates recurring
--     series, fully releasing the schedule;
--   * restoring an inactive student does NOT silently restore old series.

begin;

-- ---------------------------------------------------------------------------
-- 1. Financial access: exact conversion first, then explicit approximate
--    round-down in the tariff currency.
-- ---------------------------------------------------------------------------

create or replace function public.finance_policy_round_down_balance_minor(
  p_amount_minor bigint,
  p_currency public.finance_currency
)
returns bigint
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  v_step_minor bigint;
begin
  if p_amount_minor is null or p_currency is null then
    return null;
  end if;

  v_step_minor := case p_currency
    when 'UAH'::public.finance_currency then 1000::bigint -- 10 UAH
    when 'USD'::public.finance_currency then 100::bigint  -- 1 USD
    when 'EUR'::public.finance_currency then 100::bigint  -- 1 EUR
    else 100::bigint
  end;

  -- floor() is intentional. For a negative amount it moves to the next more
  -- negative step, keeping the approximation conservative and truly "down".
  return (
    floor(p_amount_minor::numeric / v_step_minor::numeric)::bigint
      * v_step_minor
  );
end;
$function$;

revoke all on function public.finance_policy_round_down_balance_minor(
  bigint,
  public.finance_currency
) from public, anon, authenticated;
grant execute on function public.finance_policy_round_down_balance_minor(
  bigint,
  public.finance_currency
) to service_role;

create or replace view public.teacher_student_financial_policy_balances
with (security_invoker = false)
as
with converted as (
  select
    h.teacher_id,
    h.student_id,
    h.current_rate_currency as tariff_currency,
    b.currency as balance_currency,
    b.balance_minor,
    case
      when b.balance_minor is null then null
      when b.balance_minor = 0 then 0::bigint
      else public.finance_policy_convert_balance_minor(
        b.balance_minor,
        b.currency,
        h.current_rate_currency,
        public.get_teacher_local_date(h.teacher_id)
      )
    end as converted_minor
  from public.teacher_student_finance_health h
  left join public.student_finance_balances b
    on b.teacher_id = h.teacher_id
   and b.student_id = h.student_id
), aggregated as (
  select
    c.teacher_id,
    c.student_id,
    c.tariff_currency,
    coalesce(
      sum(c.converted_minor) filter (where c.converted_minor is not null),
      0
    )::bigint as exact_balance_minor,
    coalesce(
      bool_or(
        coalesce(c.balance_minor, 0) <> 0
        and c.balance_currency <> c.tariff_currency
      ),
      false
    ) as uses_fx,
    count(*) filter (
      where coalesce(c.balance_minor, 0) <> 0
        and c.balance_currency <> c.tariff_currency
        and c.converted_minor is null
    )::integer as missing_fx_balance_count
  from converted c
  group by c.teacher_id, c.student_id, c.tariff_currency
)
select
  a.teacher_id,
  a.student_id,
  a.tariff_currency,
  a.exact_balance_minor,
  a.uses_fx,
  a.missing_fx_balance_count,
  case
    when a.missing_fx_balance_count > 0 then null::bigint
    when a.uses_fx then public.finance_policy_round_down_balance_minor(
      a.exact_balance_minor,
      a.tariff_currency
    )
    else a.exact_balance_minor
  end as rounded_balance_minor
from aggregated a;

comment on view public.teacher_student_financial_policy_balances is
  'Combined student balance in current tariff currency. FX is converted using exact official cached NBU rates; when FX is used the final combined amount is approximately rounded down (UAH to 10 UAH, USD/EUR to 1 whole unit).';

revoke all on table public.teacher_student_financial_policy_balances
  from public, anon, authenticated;
grant select on table public.teacher_student_financial_policy_balances
  to service_role;

create or replace view public.teacher_student_financial_access_policy
with (security_invoker = false)
as
select
  h.teacher_id,
  h.student_id,
  h.student_name,
  h.student_email,
  ts.financial_blocking_enabled,
  ts.financial_blocking_debt_threshold_lessons,
  ts.low_balance_threshold_lessons,
  h.current_rate_minor,
  h.current_rate_currency as tariff_currency,
  case
    when coalesce(pb.missing_fx_balance_count, 0) > 0 then null::bigint
    else coalesce(pb.rounded_balance_minor, 0)::bigint
  end as balance_in_tariff_currency_minor,
  coalesce(pb.uses_fx, false) as coverage_uses_fx,
  (coalesce(pb.missing_fx_balance_count, 0) > 0) as coverage_fx_pending,
  case
    when h.current_rate_minor is null or h.current_rate_minor <= 0 then null
    else h.current_rate_minor::bigint
      * ts.financial_blocking_debt_threshold_lessons::bigint
  end as block_debt_threshold_minor,
  (ts.low_balance_threshold_lessons::integer + 1) as recovery_target_lessons,
  case
    when h.current_rate_minor is null or h.current_rate_minor <= 0 then null
    else h.current_rate_minor::bigint
      * (ts.low_balance_threshold_lessons::bigint + 1)
  end as recovery_target_minor,
  case
    when h.current_rate_minor is null or h.current_rate_minor <= 0 then null
    when coalesce(pb.missing_fx_balance_count, 0) > 0 then null
    when coalesce(pb.rounded_balance_minor, 0) >= 0 then 0::bigint
    else greatest(
      h.current_rate_minor::bigint
        * (ts.low_balance_threshold_lessons::bigint + 1)
        - coalesce(pb.rounded_balance_minor, 0)::bigint,
      0::bigint
    )
  end as recommended_payment_minor,
  (
    ts.financial_blocking_enabled
    and h.current_rate_minor is not null
    and h.current_rate_minor > 0
    and coalesce(pb.missing_fx_balance_count, 0) = 0
    and coalesce(pb.rounded_balance_minor, 0)::bigint
      < -(
        h.current_rate_minor::bigint
        * ts.financial_blocking_debt_threshold_lessons::bigint
      )
  ) as block_entry_condition,
  (
    h.current_rate_minor is not null
    and h.current_rate_minor > 0
    and coalesce(pb.missing_fx_balance_count, 0) = 0
    and coalesce(pb.rounded_balance_minor, 0)::bigint
      >= h.current_rate_minor::bigint
        * (ts.low_balance_threshold_lessons::bigint + 1)
  ) as auto_recovery_ready,
  coalesce(s.is_financially_blocked, false) as is_financially_blocked,
  coalesce(s.manual_unlock_active, false) as manual_unlock_active,
  (
    ts.financial_blocking_enabled
    and coalesce(s.is_financially_blocked, false)
    and not coalesce(s.manual_unlock_active, false)
  ) as access_restricted,
  s.blocked_at,
  s.unblocked_at,
  s.manual_unlocked_at,
  s.manual_unlocked_by,
  s.last_finance_transaction_id,
  s.last_evaluated_at
from public.teacher_student_finance_health h
join public.teacher_settings ts
  on ts.teacher_id = h.teacher_id
left join public.teacher_student_financial_policy_balances pb
  on pb.teacher_id = h.teacher_id
 and pb.student_id = h.student_id
left join public.student_financial_access_state s
  on s.teacher_id = h.teacher_id
 and s.student_id = h.student_id;

comment on view public.teacher_student_financial_access_policy is
  'Central student finance access policy. FX balances are converted at exact official NBU rates then approximately rounded down in the current tariff currency; block/recovery/recommended payment use the same rounded value.';

revoke all on table public.teacher_student_financial_access_policy
  from public, anon, authenticated;
grant select on table public.teacher_student_financial_access_policy
  to service_role;

-- Re-evaluate persisted states after changing the balance approximation rule.
do $block$
declare
  v_rel record;
begin
  for v_rel in
    select rel.teacher_id, rel.student_id
    from public.teacher_students rel
    where rel.is_active = true
  loop
    perform public.reconcile_student_financial_access(
      v_rel.teacher_id,
      v_rel.student_id,
      false,
      null
    );
  end loop;
end;
$block$;

-- ---------------------------------------------------------------------------
-- 2. Short pause lifecycle.
-- ---------------------------------------------------------------------------

alter table public.teacher_students
  add column if not exists pause_until date;

-- The previous first-pass pause had no end date and did not alter the schedule.
-- Do not retroactively cancel lessons for such rows during migration: safely
-- return them to active and let the teacher create a new explicit dated pause.
update public.teacher_students
set
  learning_status = 'active'::public.student_learning_status,
  pause_until = null,
  status_changed_at = now(),
  updated_at = now()
where learning_status = 'paused'::public.student_learning_status
  and pause_until is null;

alter table public.teacher_students
  drop constraint if exists teacher_students_pause_until_status_check;
alter table public.teacher_students
  add constraint teacher_students_pause_until_status_check
  check (
    (learning_status = 'paused'::public.student_learning_status and pause_until is not null)
    or
    (learning_status <> 'paused'::public.student_learning_status and pause_until is null)
  );

comment on column public.teacher_students.pause_until is
  'Inclusive final local date of a short learning pause. A pause is limited to 14 calendar days at creation.';

comment on column public.recurring_lessons.lifecycle_suspended is
  'Marks a recurring series stopped because the student became inactive. Restoring the student does not automatically reactivate the old series.';

create or replace function public.reconcile_expired_student_pauses(
  p_teacher_id uuid default null,
  p_student_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer := 0;
begin
  update public.teacher_students rel
  set
    learning_status = 'active'::public.student_learning_status,
    pause_until = null,
    status_changed_at = now(),
    updated_at = now()
  where rel.is_active = true
    and rel.learning_status = 'paused'::public.student_learning_status
    and rel.pause_until is not null
    and rel.pause_until < public.get_teacher_local_date(rel.teacher_id)
    and (p_teacher_id is null or rel.teacher_id = p_teacher_id)
    and (p_student_id is null or rel.student_id = p_student_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.reconcile_expired_student_pauses(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_expired_student_pauses(uuid, uuid)
  to service_role;

-- Existing helper means "eligible for NEW learning activity". An expired pause
-- is treated as active even before a read endpoint lazily persists that state.
create or replace function public.is_my_active_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.teacher_students rel
    join public.profiles student
      on student.id = rel.student_id
    where rel.teacher_id = auth.uid()
      and rel.student_id = p_student_id
      and rel.is_active = true
      and (
        rel.learning_status = 'active'::public.student_learning_status
        or (
          rel.learning_status = 'paused'::public.student_learning_status
          and rel.pause_until is not null
          and rel.pause_until < public.get_teacher_local_date(rel.teacher_id)
        )
      )
      and student.role = 'student'
      and student.is_active = true
  );
$function$;

revoke execute on function public.is_my_active_student(uuid)
  from public, anon, authenticated;
grant execute on function public.is_my_active_student(uuid)
  to service_role;

-- Return shapes change to expose pause_until, so recreate these RPCs.
drop function if exists public.list_teacher_students_lifecycle();
create function public.list_teacher_students_lifecycle()
returns table (
  student_id uuid,
  email text,
  full_name text,
  phone text,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  created_at timestamptz,
  status_changed_at timestamptz,
  pause_until date
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  perform public.reconcile_expired_student_pauses(auth.uid(), null);

  return query
  select
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.is_active,
    rel.learning_status,
    p.created_at,
    rel.status_changed_at,
    rel.pause_until
  from public.teacher_students rel
  join public.profiles p
    on p.id = rel.student_id
  where rel.teacher_id = auth.uid()
    and rel.is_active = true
    and p.role = 'student'
  order by p.full_name nulls last, p.email;
end;
$function$;

revoke all on function public.list_teacher_students_lifecycle()
  from public, anon;
grant execute on function public.list_teacher_students_lifecycle()
  to authenticated, service_role;

drop function if exists public.get_teacher_student_lifecycle(uuid);
create function public.get_teacher_student_lifecycle(
  p_student_id uuid
)
returns table (
  student_id uuid,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  status_changed_at timestamptz,
  pause_until date
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  perform public.reconcile_expired_student_pauses(auth.uid(), p_student_id);

  return query
  select
    rel.student_id,
    p.is_active,
    rel.learning_status,
    rel.status_changed_at,
    rel.pause_until
  from public.teacher_students rel
  join public.profiles p
    on p.id = rel.student_id
  where rel.teacher_id = auth.uid()
    and rel.student_id = p_student_id
    and rel.is_active = true
    and p.role = 'student';
end;
$function$;

revoke all on function public.get_teacher_student_lifecycle(uuid)
  from public, anon;
grant execute on function public.get_teacher_student_lifecycle(uuid)
  to authenticated, service_role;

drop function if exists public.get_my_student_lifecycle();
create function public.get_my_student_lifecycle()
returns table (
  teacher_id uuid,
  learning_status public.student_learning_status,
  status_changed_at timestamptz,
  pause_until date
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_teacher_id uuid;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  v_teacher_id := public.resolve_my_teacher_id();
  perform public.reconcile_expired_student_pauses(v_teacher_id, v_student_id);

  return query
  select
    rel.teacher_id,
    rel.learning_status,
    rel.status_changed_at,
    rel.pause_until
  from public.teacher_students rel
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true
  limit 1;
end;
$function$;

revoke all on function public.get_my_student_lifecycle()
  from public, anon;
grant execute on function public.get_my_student_lifecycle()
  to authenticated, service_role;

-- Replace the old two-argument lifecycle mutation RPC with a dated-pause form.
drop function if exists public.set_teacher_student_learning_status(
  uuid,
  public.student_learning_status
);

create function public.set_teacher_student_learning_status(
  p_student_id uuid,
  p_status public.student_learning_status,
  p_pause_until date default null
)
returns table (
  student_id uuid,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  status_changed_at timestamptz,
  pause_until date
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_now timestamptz := now();
  v_today date;
  v_timezone text;
  v_lesson record;
  v_series record;
  v_request record;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  if p_status is null then raise exception 'INVALID_STUDENT_STATUS'; end if;

  if not exists (
    select 1
    from public.teacher_students rel
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true
  ) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  select ts.schedule_timezone
  into v_timezone
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;
  v_today := public.get_teacher_local_date(v_teacher_id);

  if p_status = 'paused'::public.student_learning_status then
    if p_pause_until is null then raise exception 'PAUSE_UNTIL_REQUIRED'; end if;
    if p_pause_until < v_today then raise exception 'PAUSE_END_IN_PAST'; end if;
    if p_pause_until > v_today + 14 then raise exception 'PAUSE_TOO_LONG'; end if;

    -- Ensure every recurring occurrence in the short pause exists as a concrete
    -- row. Cancelling it creates an explicit occurrence exception: the active
    -- series still blocks another recurring series, while the cancelled slot is
    -- free for a one-time lesson or one-time schedule block.
    for v_series in
      select r.id
      from public.recurring_lessons r
      where r.teacher_id = v_teacher_id
        and r.student_id = p_student_id
        and r.is_active = true
        and (r.valid_until is null or r.valid_until >= v_today)
    loop
      perform 1
      from public.materialize_recurring_lessons_internal(
        v_series.id,
        p_pause_until
      );
    end loop;

    update public.teacher_students rel
    set
      learning_status = 'paused'::public.student_learning_status,
      pause_until = p_pause_until,
      status_changed_at = v_now,
      status_changed_by = v_teacher_id,
      updated_at = v_now
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true;

    update public.profiles p
    set is_active = true
    where p.id = p_student_id
      and p.role = 'student';

    for v_lesson in
      select l.id
      from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.student_id = p_student_id
        and l.status = 'scheduled'::public.lesson_status
        and l.starts_at > v_now
        and (l.starts_at at time zone v_timezone)::date <= p_pause_until
      order by l.starts_at
    loop
      perform public.cancel_lesson(v_lesson.id, null);
    end loop;

    -- Pending extra-lesson requests are incompatible with a learning pause.
    for v_request in
      select r.id
      from public.lesson_requests r
      where r.teacher_id = v_teacher_id
        and r.student_id = p_student_id
        and r.status = 'pending'::public.lesson_request_status
        and r.request_type = 'extra_lesson'::public.lesson_request_type
        and (r.requested_starts_at at time zone v_timezone)::date <= p_pause_until
    loop
      perform public.reject_lesson_request(v_request.id, null);
    end loop;

  elsif p_status = 'inactive'::public.student_learning_status then
    update public.teacher_students rel
    set
      learning_status = 'inactive'::public.student_learning_status,
      pause_until = null,
      status_changed_at = v_now,
      status_changed_by = v_teacher_id,
      updated_at = v_now
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true;

    update public.profiles p
    set is_active = false
    where p.id = p_student_id
      and p.role = 'student';

    -- Release all future recurring reservations. Keep the series rows as
    -- history, but restoring the student will not silently reactivate them.
    update public.recurring_lessons r
    set
      is_active = false,
      lifecycle_suspended = true,
      updated_at = v_now
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.is_active = true;

    for v_lesson in
      select l.id
      from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.student_id = p_student_id
        and l.status = 'scheduled'::public.lesson_status
        and l.starts_at > v_now
      order by l.starts_at
    loop
      perform public.cancel_lesson(v_lesson.id, null);
    end loop;

    for v_request in
      select r.id
      from public.lesson_requests r
      where r.teacher_id = v_teacher_id
        and r.student_id = p_student_id
        and r.status = 'pending'::public.lesson_request_status
        and r.request_type = 'extra_lesson'::public.lesson_request_type
    loop
      perform public.reject_lesson_request(v_request.id, null);
    end loop;

  else
    -- Resume a short pause or restore an inactive student. Old series that were
    -- released by inactive status deliberately stay inactive; the teacher may
    -- create a new regular schedule if/when the student returns.
    update public.teacher_students rel
    set
      learning_status = 'active'::public.student_learning_status,
      pause_until = null,
      status_changed_at = v_now,
      status_changed_by = v_teacher_id,
      updated_at = v_now
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true;

    update public.profiles p
    set is_active = true
    where p.id = p_student_id
      and p.role = 'student';
  end if;

  return query
  select
    rel.student_id,
    p.is_active,
    rel.learning_status,
    rel.status_changed_at,
    rel.pause_until
  from public.teacher_students rel
  join public.profiles p
    on p.id = rel.student_id
  where rel.teacher_id = v_teacher_id
    and rel.student_id = p_student_id
    and rel.is_active = true;
end;
$function$;

revoke all on function public.set_teacher_student_learning_status(
  uuid,
  public.student_learning_status,
  date
) from public, anon;
grant execute on function public.set_teacher_student_learning_status(
  uuid,
  public.student_learning_status,
  date
) to authenticated, service_role;

-- Student-side guard lazily expires a dated pause before enforcing it.
create or replace function public.assert_current_student_learning_active()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_teacher_id uuid;
  v_status public.student_learning_status;
  v_profile_active boolean;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  v_teacher_id := public.resolve_my_teacher_id();
  perform public.reconcile_expired_student_pauses(v_teacher_id, v_student_id);

  select rel.learning_status, p.is_active
  into v_status, v_profile_active
  from public.teacher_students rel
  join public.profiles p on p.id = rel.student_id
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true;

  if not found then raise exception 'STUDENT_NOT_ASSIGNED'; end if;

  if v_status = 'paused'::public.student_learning_status then
    raise exception 'STUDENT_LEARNING_PAUSED';
  end if;

  if v_status = 'inactive'::public.student_learning_status
     or not coalesce(v_profile_active, false) then
    raise exception 'STUDENT_LEARNING_INACTIVE';
  end if;
end;
$function$;

revoke all on function public.assert_current_student_learning_active()
  from public, anon, authenticated;
grant execute on function public.assert_current_student_learning_active()
  to service_role;

commit;
