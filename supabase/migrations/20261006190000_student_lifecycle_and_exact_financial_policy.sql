-- Student lifecycle + exact FX financial access policy.
--
-- 1) Financial blocking/recommended payment is calculated in the CURRENT
--    tariff currency using the official cached NBU rate without the conservative
--    +/-1% coverage adjustment used by the low-balance dashboard.
-- 2) Teacher/student lifecycle is explicit: active / paused / inactive.
--    The teacher_students relationship itself remains active so history,
--    finance, notes and debts never disappear when learning stops.

begin;

-- ---------------------------------------------------------------------------
-- Exact NBU conversion for access-policy decisions.
-- Low-balance coverage keeps its existing conservative conversion separately.
-- ---------------------------------------------------------------------------

create or replace function public.finance_policy_convert_balance_minor(
  p_amount_minor bigint,
  p_from_currency public.finance_currency,
  p_to_currency public.finance_currency,
  p_on_date date
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_source_rate numeric;
  v_target_rate numeric;
begin
  if p_amount_minor is null then
    return null;
  end if;

  if p_amount_minor = 0 then
    return 0;
  end if;

  if p_from_currency is null or p_to_currency is null or p_on_date is null then
    return null;
  end if;

  if p_from_currency = p_to_currency then
    return p_amount_minor;
  end if;

  v_source_rate := public.finance_nbu_rate(p_from_currency, p_on_date);
  v_target_rate := public.finance_nbu_rate(p_to_currency, p_on_date);

  if v_source_rate is null or v_target_rate is null or v_target_rate <= 0 then
    return null;
  end if;

  -- All supported currencies currently use two minor decimal places, so the
  -- cross-rate can be applied directly to minor units. Round only the final
  -- minor-unit result; do not round the FX rate itself.
  return round(
    p_amount_minor::numeric * v_source_rate / v_target_rate
  )::bigint;
end;
$function$;

revoke all on function public.finance_policy_convert_balance_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) from public, anon;
grant execute on function public.finance_policy_convert_balance_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) to authenticated, service_role;

create or replace view public.teacher_student_financial_policy_balances
with (security_invoker = false)
as
select
  h.teacher_id,
  h.student_id,
  h.current_rate_currency as tariff_currency,
  coalesce(
    sum(
      case
        when b.balance_minor = 0 then 0::bigint
        else public.finance_policy_convert_balance_minor(
          b.balance_minor,
          b.currency,
          h.current_rate_currency,
          public.get_teacher_local_date(h.teacher_id)
        )
      end
    ) filter (
      where b.balance_minor = 0
         or public.finance_policy_convert_balance_minor(
              b.balance_minor,
              b.currency,
              h.current_rate_currency,
              public.get_teacher_local_date(h.teacher_id)
            ) is not null
    ),
    0
  )::bigint as exact_balance_minor,
  coalesce(
    bool_or(
      b.balance_minor <> 0
      and b.currency <> h.current_rate_currency
    ),
    false
  ) as uses_fx,
  count(*) filter (
    where b.balance_minor <> 0
      and b.currency <> h.current_rate_currency
      and public.finance_policy_convert_balance_minor(
            b.balance_minor,
            b.currency,
            h.current_rate_currency,
            public.get_teacher_local_date(h.teacher_id)
          ) is null
  )::integer as missing_fx_balance_count
from public.teacher_student_finance_health h
left join public.student_finance_balances b
  on b.teacher_id = h.teacher_id
 and b.student_id = h.student_id
group by
  h.teacher_id,
  h.student_id,
  h.current_rate_currency;

comment on view public.teacher_student_financial_policy_balances is
  'Exact combined student balance in the current tariff currency for access-policy decisions. Uses official cached NBU rates with no conservative +/-1% adjustment and no whole-UAH FX-rate rounding.';

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
  coalesce(pb.exact_balance_minor, 0)::bigint as balance_in_tariff_currency_minor,
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
    else greatest(
      h.current_rate_minor::bigint
        * (ts.low_balance_threshold_lessons::bigint + 1)
        - coalesce(pb.exact_balance_minor, 0)::bigint,
      0::bigint
    )
  end as recommended_payment_minor,
  (
    ts.financial_blocking_enabled
    and h.current_rate_minor is not null
    and h.current_rate_minor > 0
    and coalesce(pb.missing_fx_balance_count, 0) = 0
    and coalesce(pb.exact_balance_minor, 0)::bigint
      < -(
        h.current_rate_minor::bigint
        * ts.financial_blocking_debt_threshold_lessons::bigint
      )
  ) as block_entry_condition,
  (
    h.current_rate_minor is not null
    and h.current_rate_minor > 0
    and coalesce(pb.missing_fx_balance_count, 0) = 0
    and coalesce(pb.exact_balance_minor, 0)::bigint
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
  'Central student finance access policy. Block/recovery/recommended payment are expressed in the current tariff currency using exact official NBU conversion. Low-balance coverage keeps its separate conservative conversion model.';

revoke all on table public.teacher_student_financial_access_policy
  from public, anon, authenticated;
grant select on table public.teacher_student_financial_access_policy
  to service_role;

-- Reset any state that may have been entered under the previous conservative
-- FX formula, then evaluate everyone once with the corrected exact policy.
update public.student_financial_access_state
set
  is_financially_blocked = false,
  manual_unlock_active = false,
  unblocked_at = case
    when is_financially_blocked then now()
    else unblocked_at
  end,
  manual_unlocked_at = null,
  manual_unlocked_by = null,
  updated_at = now();

-- Reconcile existing persistent states against the corrected balance formula.
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
-- Student lifecycle.
-- ---------------------------------------------------------------------------

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'student_learning_status'
  ) then
    create type public.student_learning_status as enum (
      'active',
      'paused',
      'inactive'
    );
  end if;
end;
$block$;

alter table public.teacher_students
  add column if not exists learning_status public.student_learning_status
    not null default 'active'::public.student_learning_status,
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists status_changed_by uuid references public.profiles(id);

-- Preserve already-disabled student profiles as inactive lifecycle records.
update public.teacher_students rel
set
  learning_status = 'inactive'::public.student_learning_status,
  status_changed_at = now()
from public.profiles p
where p.id = rel.student_id
  and p.role = 'student'
  and p.is_active = false
  and rel.learning_status <> 'inactive'::public.student_learning_status;

create index if not exists teacher_students_teacher_learning_status_idx
  on public.teacher_students (teacher_id, learning_status, student_id)
  where is_active = true;

-- Remember which recurring series were suspended specifically by the student
-- lifecycle so they can be restored safely without reactivating series that a
-- teacher had already stopped manually. Existing materialized lessons are left
-- untouched intentionally.
alter table public.recurring_lessons
  add column if not exists lifecycle_suspended boolean not null default false;


-- The existing helper means "available for NEW learning activity". Keep its
-- public contract, but include lifecycle status so paused/inactive students
-- cannot receive newly created lessons/series.
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
      and rel.learning_status = 'active'::public.student_learning_status
      and student.role = 'student'
      and student.is_active = true
  );
$function$;

revoke execute on function public.is_my_active_student(uuid)
  from public, anon, authenticated;
grant execute on function public.is_my_active_student(uuid)
  to service_role;

create or replace function public.list_teacher_students_lifecycle()
returns table (
  student_id uuid,
  email text,
  full_name text,
  phone text,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  created_at timestamptz,
  status_changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  return query
  select
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.is_active,
    rel.learning_status,
    p.created_at,
    rel.status_changed_at
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

create or replace function public.get_teacher_student_lifecycle(
  p_student_id uuid
)
returns table (
  student_id uuid,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  status_changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  return query
  select
    rel.student_id,
    p.is_active,
    rel.learning_status,
    rel.status_changed_at
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

create or replace function public.set_teacher_student_learning_status(
  p_student_id uuid,
  p_status public.student_learning_status
)
returns table (
  student_id uuid,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  status_changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_now timestamptz := now();
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

  update public.teacher_students rel
  set
    learning_status = p_status,
    status_changed_at = v_now,
    status_changed_by = v_teacher_id,
    updated_at = v_now
  where rel.teacher_id = v_teacher_id
    and rel.student_id = p_student_id
    and rel.is_active = true;

  -- "Inactive" means learning is finished and login is disabled by the
  -- existing Login/ProtectedRoute profile.is_active checks. A pause keeps login
  -- available so the student can see history, lessons and materials.
  update public.profiles p
  set is_active = (p_status <> 'inactive'::public.student_learning_status)
  where p.id = p_student_id
    and p.role = 'student';

  if p_status = 'active'::public.student_learning_status then
    update public.recurring_lessons r
    set
      is_active = true,
      lifecycle_suspended = false,
      updated_at = v_now
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.lifecycle_suspended = true
      and (
        r.valid_until is null
        or r.valid_until >= public.get_teacher_local_date(v_teacher_id)
      );
  else
    update public.recurring_lessons r
    set
      is_active = false,
      lifecycle_suspended = true,
      updated_at = v_now
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.is_active = true;
  end if;

  return query
  select
    rel.student_id,
    p.is_active,
    rel.learning_status,
    rel.status_changed_at
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
  public.student_learning_status
) from public, anon;
grant execute on function public.set_teacher_student_learning_status(
  uuid,
  public.student_learning_status
) to authenticated, service_role;

create or replace function public.get_my_student_lifecycle()
returns table (
  teacher_id uuid,
  learning_status public.student_learning_status,
  status_changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  return query
  select
    rel.teacher_id,
    rel.learning_status,
    rel.status_changed_at
  from public.teacher_students rel
  where rel.student_id = v_student_id
    and rel.is_active = true
  limit 1;
end;
$function$;

revoke all on function public.get_my_student_lifecycle()
  from public, anon;
grant execute on function public.get_my_student_lifecycle()
  to authenticated, service_role;

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

-- Keep the existing public request RPC signatures. The financial-policy
-- migration already wrapped the unrestricted implementations; add lifecycle
-- validation before the financial guard.
create or replace function public.create_extra_lesson_request(
  p_requested_starts_at timestamptz,
  p_message text default null::text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.assert_current_student_learning_active();
  perform public.assert_current_student_financial_access();
  return public.create_extra_lesson_request_unrestricted(
    p_requested_starts_at,
    p_message
  );
end;
$function$;

revoke all on function public.create_extra_lesson_request(timestamptz, text)
  from public, anon;
grant execute on function public.create_extra_lesson_request(timestamptz, text)
  to authenticated, service_role;

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
begin
  perform public.assert_current_student_learning_active();
  perform public.assert_current_student_financial_access();
  return public.create_lesson_reschedule_request_unrestricted(
    p_lesson_id,
    p_requested_starts_at,
    p_message
  );
end;
$function$;

revoke all on function public.create_lesson_reschedule_request(
  uuid,
  timestamptz,
  text
) from public, anon;
grant execute on function public.create_lesson_reschedule_request(
  uuid,
  timestamptz,
  text
) to authenticated, service_role;

commit;
