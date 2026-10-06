begin;

-- ---------------------------------------------------------------------------
-- Student financial access policy.
--
-- Entry threshold and recovery threshold intentionally differ (hysteresis):
--   * enter financial block when the signed balance converted to the current
--     tariff currency becomes lower than -(current rate * N debt lessons);
--   * once blocked, recover automatically only when the same converted balance
--     covers MORE than the teacher low-balance warning threshold F, i.e. F + 1
--     current-rate lessons;
--   * teacher may temporarily unlock a blocked student; the override survives
--     until the student's next financial ledger operation.
--
-- The browser never reimplements these formulas. It consumes the RPC read model.
-- ---------------------------------------------------------------------------

alter table public.teacher_settings
  add column if not exists financial_blocking_enabled boolean not null default false,
  add column if not exists financial_blocking_debt_threshold_lessons smallint not null default 5;

alter table public.teacher_settings
  drop constraint if exists teacher_settings_financial_blocking_debt_threshold_check;

alter table public.teacher_settings
  add constraint teacher_settings_financial_blocking_debt_threshold_check
  check (financial_blocking_debt_threshold_lessons between 1 and 50);

comment on column public.teacher_settings.financial_blocking_enabled is
  'When enabled, student-created new lesson activity can be restricted by the centralized financial access policy.';
comment on column public.teacher_settings.financial_blocking_debt_threshold_lessons is
  'Debt-entry threshold N expressed as multiples of the student current lesson rate. Default: 5 lessons.';

create table public.student_financial_access_state (
  teacher_id uuid not null,
  student_id uuid not null,
  is_financially_blocked boolean not null default false,
  manual_unlock_active boolean not null default false,
  blocked_at timestamptz,
  unblocked_at timestamptz,
  manual_unlocked_at timestamptz,
  manual_unlocked_by uuid references public.profiles(id) on delete set null,
  last_finance_transaction_id uuid references public.student_finance_transactions(id) on delete set null,
  last_evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (teacher_id, student_id),
  constraint student_financial_access_state_relationship_fkey
    foreign key (teacher_id, student_id)
    references public.teacher_students (teacher_id, student_id)
    on delete cascade,
  constraint student_financial_access_manual_unlock_requires_block
    check (not manual_unlock_active or is_financially_blocked)
);

alter table public.student_financial_access_state enable row level security;

create policy "Teacher can read student financial access state"
on public.student_financial_access_state
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

create policy "Student can read own financial access state"
on public.student_financial_access_state
for select
to authenticated
using (
  student_id = auth.uid()
);

revoke all on table public.student_financial_access_state from anon, authenticated;
grant select on table public.student_financial_access_state to authenticated, service_role;
grant all on table public.student_financial_access_state to service_role;

-- ---------------------------------------------------------------------------
-- Internal read model. All monetary values below are in current tariff currency.
-- teacher_student_finance_health already performs the multi-currency conversion
-- with the same conservative NBU coverage conversion used by Low balance.
-- ---------------------------------------------------------------------------

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
  h.coverage_balance_minor as balance_in_tariff_currency_minor,
  h.coverage_uses_fx,
  h.coverage_fx_pending,
  case
    when h.current_rate_minor is null or h.current_rate_minor <= 0 then null
    else h.current_rate_minor::bigint * ts.financial_blocking_debt_threshold_lessons::bigint
  end as block_debt_threshold_minor,
  (ts.low_balance_threshold_lessons::integer + 1) as recovery_target_lessons,
  case
    when h.current_rate_minor is null or h.current_rate_minor <= 0 then null
    else h.current_rate_minor::bigint * (ts.low_balance_threshold_lessons::bigint + 1)
  end as recovery_target_minor,
  case
    when h.current_rate_minor is null or h.current_rate_minor <= 0 then null
    when h.coverage_fx_pending then null
    else greatest(
      h.current_rate_minor::bigint * (ts.low_balance_threshold_lessons::bigint + 1)
        - coalesce(h.coverage_balance_minor, 0)::bigint,
      0::bigint
    )
  end as recommended_payment_minor,
  (
    ts.financial_blocking_enabled
    and h.current_rate_minor is not null
    and h.current_rate_minor > 0
    and not h.coverage_fx_pending
    and coalesce(h.coverage_balance_minor, 0)::bigint
      < -(h.current_rate_minor::bigint * ts.financial_blocking_debt_threshold_lessons::bigint)
  ) as block_entry_condition,
  (
    h.current_rate_minor is not null
    and h.current_rate_minor > 0
    and not h.coverage_fx_pending
    and coalesce(h.coverage_balance_minor, 0)::bigint
      >= h.current_rate_minor::bigint * (ts.low_balance_threshold_lessons::bigint + 1)
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
left join public.student_financial_access_state s
  on s.teacher_id = h.teacher_id
 and s.student_id = h.student_id;

comment on view public.teacher_student_financial_access_policy is
  'Central student finance access policy. All balances, block thresholds, recovery targets and recommended payments are expressed in the student current tariff currency. The block has hysteresis: enter below -N lesson rates; recover only at F+1 funded lesson rates, where F is the existing low-balance threshold.';

revoke all on table public.teacher_student_financial_access_policy from public, anon, authenticated;
grant select on table public.teacher_student_financial_access_policy to service_role;

-- ---------------------------------------------------------------------------
-- State reconciliation. This is the only place that transitions the persistent
-- block state. p_finance_event=true also consumes a temporary teacher override.
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_student_financial_access(
  p_teacher_id uuid,
  p_student_id uuid,
  p_finance_event boolean default false,
  p_finance_transaction_id uuid default null
)
returns public.student_financial_access_state
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_policy record;
  v_state public.student_financial_access_state%rowtype;
  v_now timestamptz := now();
begin
  if p_teacher_id is null or p_student_id is null then
    raise exception 'INVALID_FINANCIAL_ACCESS_SUBJECT';
  end if;

  if not exists (
    select 1
    from public.teacher_students rel
    where rel.teacher_id = p_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true
  ) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  insert into public.student_financial_access_state (
    teacher_id,
    student_id,
    last_evaluated_at
  ) values (
    p_teacher_id,
    p_student_id,
    v_now
  )
  on conflict (teacher_id, student_id) do nothing;

  select *
  into v_state
  from public.student_financial_access_state s
  where s.teacher_id = p_teacher_id
    and s.student_id = p_student_id
  for update;

  select *
  into v_policy
  from public.teacher_student_financial_access_policy p
  where p.teacher_id = p_teacher_id
    and p.student_id = p_student_id;

  if not found then
    -- Finance-health may be unavailable when no active relationship/rate exists.
    -- Keep any existing block conservative, but consume the temporary override
    -- on a finance event as promised.
    update public.student_financial_access_state s
    set
      manual_unlock_active = case
        when p_finance_event then false
        else s.manual_unlock_active
      end,
      manual_unlocked_at = case
        when p_finance_event then null
        else s.manual_unlocked_at
      end,
      manual_unlocked_by = case
        when p_finance_event then null
        else s.manual_unlocked_by
      end,
      last_finance_transaction_id = case
        when p_finance_event then p_finance_transaction_id
        else s.last_finance_transaction_id
      end,
      last_evaluated_at = v_now,
      updated_at = v_now
    where s.teacher_id = p_teacher_id
      and s.student_id = p_student_id
    returning * into v_state;

    return v_state;
  end if;

  if not v_policy.financial_blocking_enabled then
    update public.student_financial_access_state s
    set
      is_financially_blocked = false,
      manual_unlock_active = false,
      unblocked_at = case
        when s.is_financially_blocked then v_now
        else s.unblocked_at
      end,
      manual_unlocked_at = null,
      manual_unlocked_by = null,
      last_finance_transaction_id = case
        when p_finance_event then p_finance_transaction_id
        else s.last_finance_transaction_id
      end,
      last_evaluated_at = v_now,
      updated_at = v_now
    where s.teacher_id = p_teacher_id
      and s.student_id = p_student_id
    returning * into v_state;

    return v_state;
  end if;

  -- Once blocked, the student remains blocked until the recovery target is met.
  -- Returning merely above the entry debt threshold is intentionally insufficient.
  if v_state.is_financially_blocked then
    if v_policy.auto_recovery_ready then
      update public.student_financial_access_state s
      set
        is_financially_blocked = false,
        manual_unlock_active = false,
        unblocked_at = v_now,
        manual_unlocked_at = null,
        manual_unlocked_by = null,
        last_finance_transaction_id = case
          when p_finance_event then p_finance_transaction_id
          else s.last_finance_transaction_id
        end,
        last_evaluated_at = v_now,
        updated_at = v_now
      where s.teacher_id = p_teacher_id
        and s.student_id = p_student_id
      returning * into v_state;

      return v_state;
    end if;

    update public.student_financial_access_state s
    set
      manual_unlock_active = case
        when p_finance_event then false
        else s.manual_unlock_active
      end,
      manual_unlocked_at = case
        when p_finance_event then null
        else s.manual_unlocked_at
      end,
      manual_unlocked_by = case
        when p_finance_event then null
        else s.manual_unlocked_by
      end,
      last_finance_transaction_id = case
        when p_finance_event then p_finance_transaction_id
        else s.last_finance_transaction_id
      end,
      last_evaluated_at = v_now,
      updated_at = v_now
    where s.teacher_id = p_teacher_id
      and s.student_id = p_student_id
    returning * into v_state;

    return v_state;
  end if;

  if v_policy.block_entry_condition then
    update public.student_financial_access_state s
    set
      is_financially_blocked = true,
      manual_unlock_active = false,
      blocked_at = v_now,
      manual_unlocked_at = null,
      manual_unlocked_by = null,
      last_finance_transaction_id = case
        when p_finance_event then p_finance_transaction_id
        else s.last_finance_transaction_id
      end,
      last_evaluated_at = v_now,
      updated_at = v_now
    where s.teacher_id = p_teacher_id
      and s.student_id = p_student_id
    returning * into v_state;

    return v_state;
  end if;

  update public.student_financial_access_state s
  set
    manual_unlock_active = false,
    manual_unlocked_at = null,
    manual_unlocked_by = null,
    last_finance_transaction_id = case
      when p_finance_event then p_finance_transaction_id
      else s.last_finance_transaction_id
    end,
    last_evaluated_at = v_now,
    updated_at = v_now
  where s.teacher_id = p_teacher_id
    and s.student_id = p_student_id
  returning * into v_state;

  return v_state;
end;
$function$;

revoke all on function public.reconcile_student_financial_access(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_student_financial_access(uuid, uuid, boolean, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Shared output shape used by teacher and student RPCs.
-- ---------------------------------------------------------------------------

create or replace function public.get_teacher_student_financial_access(
  p_student_id uuid
)
returns table (
  teacher_id uuid,
  student_id uuid,
  financial_blocking_enabled boolean,
  debt_threshold_lessons smallint,
  low_balance_threshold_lessons smallint,
  current_rate_minor bigint,
  tariff_currency public.finance_currency,
  balance_minor bigint,
  coverage_uses_fx boolean,
  fx_pending boolean,
  block_debt_threshold_minor bigint,
  recovery_target_lessons integer,
  recovery_target_minor bigint,
  recommended_payment_minor bigint,
  is_financially_blocked boolean,
  manual_unlock_active boolean,
  access_restricted boolean,
  blocked_at timestamptz,
  manual_unlocked_at timestamptz,
  last_evaluated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  if not exists (
    select 1
    from public.teacher_students rel
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true
  ) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  perform public.reconcile_student_financial_access(
    v_teacher_id,
    p_student_id,
    false,
    null
  );

  return query
  select
    p.teacher_id,
    p.student_id,
    p.financial_blocking_enabled,
    p.financial_blocking_debt_threshold_lessons,
    p.low_balance_threshold_lessons,
    p.current_rate_minor,
    p.tariff_currency,
    p.balance_in_tariff_currency_minor,
    p.coverage_uses_fx,
    p.coverage_fx_pending,
    p.block_debt_threshold_minor,
    p.recovery_target_lessons,
    p.recovery_target_minor,
    p.recommended_payment_minor,
    p.is_financially_blocked,
    p.manual_unlock_active,
    p.access_restricted,
    p.blocked_at,
    p.manual_unlocked_at,
    p.last_evaluated_at
  from public.teacher_student_financial_access_policy p
  where p.teacher_id = v_teacher_id
    and p.student_id = p_student_id;
end;
$function$;

revoke all on function public.get_teacher_student_financial_access(uuid)
  from public, anon;
grant execute on function public.get_teacher_student_financial_access(uuid)
  to authenticated, service_role;

create or replace function public.get_my_student_financial_access()
returns table (
  teacher_id uuid,
  student_id uuid,
  financial_blocking_enabled boolean,
  debt_threshold_lessons smallint,
  low_balance_threshold_lessons smallint,
  current_rate_minor bigint,
  tariff_currency public.finance_currency,
  balance_minor bigint,
  coverage_uses_fx boolean,
  fx_pending boolean,
  block_debt_threshold_minor bigint,
  recovery_target_lessons integer,
  recovery_target_minor bigint,
  recommended_payment_minor bigint,
  is_financially_blocked boolean,
  manual_unlock_active boolean,
  access_restricted boolean,
  blocked_at timestamptz,
  manual_unlocked_at timestamptz,
  last_evaluated_at timestamptz
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

  perform public.reconcile_student_financial_access(
    v_teacher_id,
    v_student_id,
    false,
    null
  );

  return query
  select
    p.teacher_id,
    p.student_id,
    p.financial_blocking_enabled,
    p.financial_blocking_debt_threshold_lessons,
    p.low_balance_threshold_lessons,
    p.current_rate_minor,
    p.tariff_currency,
    p.balance_in_tariff_currency_minor,
    p.coverage_uses_fx,
    p.coverage_fx_pending,
    p.block_debt_threshold_minor,
    p.recovery_target_lessons,
    p.recovery_target_minor,
    p.recommended_payment_minor,
    p.is_financially_blocked,
    p.manual_unlock_active,
    p.access_restricted,
    p.blocked_at,
    p.manual_unlocked_at,
    p.last_evaluated_at
  from public.teacher_student_financial_access_policy p
  where p.teacher_id = v_teacher_id
    and p.student_id = v_student_id;
end;
$function$;

revoke all on function public.get_my_student_financial_access()
  from public, anon;
grant execute on function public.get_my_student_financial_access()
  to authenticated, service_role;

create or replace function public.temporary_unlock_student_financial_access(
  p_student_id uuid
)
returns table (
  teacher_id uuid,
  student_id uuid,
  financial_blocking_enabled boolean,
  debt_threshold_lessons smallint,
  low_balance_threshold_lessons smallint,
  current_rate_minor bigint,
  tariff_currency public.finance_currency,
  balance_minor bigint,
  coverage_uses_fx boolean,
  fx_pending boolean,
  block_debt_threshold_minor bigint,
  recovery_target_lessons integer,
  recovery_target_minor bigint,
  recommended_payment_minor bigint,
  is_financially_blocked boolean,
  manual_unlock_active boolean,
  access_restricted boolean,
  blocked_at timestamptz,
  manual_unlocked_at timestamptz,
  last_evaluated_at timestamptz
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

  if not exists (
    select 1
    from public.teacher_students rel
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true
  ) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  perform public.reconcile_student_financial_access(
    v_teacher_id,
    p_student_id,
    false,
    null
  );

  if not exists (
    select 1
    from public.student_financial_access_state s
    where s.teacher_id = v_teacher_id
      and s.student_id = p_student_id
      and s.is_financially_blocked = true
  ) then
    raise exception 'STUDENT_NOT_FINANCIALLY_BLOCKED';
  end if;

  update public.student_financial_access_state s
  set
    manual_unlock_active = true,
    manual_unlocked_at = v_now,
    manual_unlocked_by = v_teacher_id,
    last_evaluated_at = v_now,
    updated_at = v_now
  where s.teacher_id = v_teacher_id
    and s.student_id = p_student_id;

  return query
  select
    p.teacher_id,
    p.student_id,
    p.financial_blocking_enabled,
    p.financial_blocking_debt_threshold_lessons,
    p.low_balance_threshold_lessons,
    p.current_rate_minor,
    p.tariff_currency,
    p.balance_in_tariff_currency_minor,
    p.coverage_uses_fx,
    p.coverage_fx_pending,
    p.block_debt_threshold_minor,
    p.recovery_target_lessons,
    p.recovery_target_minor,
    p.recommended_payment_minor,
    p.is_financially_blocked,
    p.manual_unlock_active,
    p.access_restricted,
    p.blocked_at,
    p.manual_unlocked_at,
    p.last_evaluated_at
  from public.teacher_student_financial_access_policy p
  where p.teacher_id = v_teacher_id
    and p.student_id = p_student_id;
end;
$function$;

revoke all on function public.temporary_unlock_student_financial_access(uuid)
  from public, anon;
grant execute on function public.temporary_unlock_student_financial_access(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Every ledger insert is a financial event. It consumes a manual override and
-- runs the block/recovery state machine after the new balance is visible.
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_student_financial_access_after_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.reconcile_student_financial_access(
    new.teacher_id,
    new.student_id,
    true,
    new.id
  );
  return new;
end;
$function$;

revoke execute on function public.reconcile_student_financial_access_after_transaction()
  from public, anon, authenticated;
grant execute on function public.reconcile_student_financial_access_after_transaction()
  to service_role;

drop trigger if exists student_financial_access_after_transaction
  on public.student_finance_transactions;
create trigger student_financial_access_after_transaction
after insert on public.student_finance_transactions
for each row execute function public.reconcile_student_financial_access_after_transaction();

-- ---------------------------------------------------------------------------
-- Finance preferences RPC overload. The old 3-argument function remains for a
-- safe deployment overlap; the new client calls this 5-argument version.
-- ---------------------------------------------------------------------------

create or replace function public.update_my_finance_preferences(
  p_low_balance_threshold_lessons smallint,
  p_free_cancellation_hours smallint,
  p_finance_history_page_size smallint,
  p_financial_blocking_enabled boolean,
  p_financial_blocking_debt_threshold_lessons smallint
)
returns public.teacher_settings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result public.teacher_settings%rowtype;
  v_student_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  if p_low_balance_threshold_lessons is null
     or p_low_balance_threshold_lessons < 1
     or p_low_balance_threshold_lessons > 20 then
    raise exception 'INVALID_LOW_BALANCE_THRESHOLD';
  end if;

  if p_free_cancellation_hours is null
     or p_free_cancellation_hours < 1
     or p_free_cancellation_hours > 168 then
    raise exception 'INVALID_FREE_CANCELLATION_HOURS';
  end if;

  if p_finance_history_page_size is null
     or p_finance_history_page_size not in (10, 20, 50, 100) then
    raise exception 'INVALID_FINANCE_HISTORY_PAGE_SIZE';
  end if;

  if p_financial_blocking_enabled is null then
    raise exception 'INVALID_FINANCIAL_BLOCKING_ENABLED';
  end if;

  if p_financial_blocking_debt_threshold_lessons is null
     or p_financial_blocking_debt_threshold_lessons < 1
     or p_financial_blocking_debt_threshold_lessons > 50 then
    raise exception 'INVALID_FINANCIAL_BLOCKING_DEBT_THRESHOLD';
  end if;

  update public.teacher_settings
  set
    low_balance_threshold_lessons = p_low_balance_threshold_lessons,
    free_cancellation_hours = p_free_cancellation_hours,
    finance_history_page_size = p_finance_history_page_size,
    financial_blocking_enabled = p_financial_blocking_enabled,
    financial_blocking_debt_threshold_lessons = p_financial_blocking_debt_threshold_lessons,
    updated_at = now()
  where teacher_id = auth.uid()
  returning * into v_result;

  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;

  for v_student_id in
    select rel.student_id
    from public.teacher_students rel
    where rel.teacher_id = auth.uid()
      and rel.is_active = true
  loop
    perform public.reconcile_student_financial_access(
      auth.uid(),
      v_student_id,
      false,
      null
    );
  end loop;

  return v_result;
end;
$function$;

revoke all on function public.update_my_finance_preferences(
  smallint, smallint, smallint, boolean, smallint
) from public, anon;
grant execute on function public.update_my_finance_preferences(
  smallint, smallint, smallint, boolean, smallint
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Server-side guard for student-created NEW learning activity.
-- Cancellation of an already-booked lesson is intentionally not blocked.
-- ---------------------------------------------------------------------------

create or replace function public.assert_current_student_financial_access()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_teacher_id uuid;
  v_restricted boolean := false;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;

  v_teacher_id := public.resolve_my_teacher_id();

  perform public.reconcile_student_financial_access(
    v_teacher_id,
    v_student_id,
    false,
    null
  );

  select coalesce(p.access_restricted, false)
  into v_restricted
  from public.teacher_student_financial_access_policy p
  where p.teacher_id = v_teacher_id
    and p.student_id = v_student_id;

  if v_restricted then
    raise exception 'STUDENT_FINANCIAL_ACCESS_RESTRICTED';
  end if;
end;
$function$;

revoke all on function public.assert_current_student_financial_access()
  from public, anon, authenticated;
grant execute on function public.assert_current_student_financial_access()
  to service_role;

-- Wrap the existing request RPCs instead of duplicating their business logic.
-- The renamed functions become internal-only; original public names stay stable.

alter function public.create_extra_lesson_request(timestamptz, text)
  rename to create_extra_lesson_request_unrestricted;
revoke all on function public.create_extra_lesson_request_unrestricted(timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_extra_lesson_request_unrestricted(timestamptz, text)
  to service_role;

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

alter function public.create_lesson_reschedule_request(uuid, timestamptz, text)
  rename to create_lesson_reschedule_request_unrestricted;
revoke all on function public.create_lesson_reschedule_request_unrestricted(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_lesson_reschedule_request_unrestricted(uuid, timestamptz, text)
  to service_role;

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
  perform public.assert_current_student_financial_access();
  return public.create_lesson_reschedule_request_unrestricted(
    p_lesson_id,
    p_requested_starts_at,
    p_message
  );
end;
$function$;

revoke all on function public.create_lesson_reschedule_request(uuid, timestamptz, text)
  from public, anon;
grant execute on function public.create_lesson_reschedule_request(uuid, timestamptz, text)
  to authenticated, service_role;

commit;
