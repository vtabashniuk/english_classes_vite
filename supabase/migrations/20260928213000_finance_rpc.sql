-- Finance RPC layer
-- Safe browser-facing mutations for Finance Core.
-- This migration intentionally does NOT connect lesson status changes to billing yet.

begin;

-- ---------------------------------------------------------------------------
-- Manual-payment idempotency
-- ---------------------------------------------------------------------------

alter table public.payments
  add column client_request_id uuid;

create unique index payments_teacher_client_request_unique_idx
  on public.payments (teacher_id, client_request_id)
  where client_request_id is not null;

comment on column public.payments.client_request_id is
  'Client-generated UUID used to make manual payment RPC retries idempotent.';

-- ---------------------------------------------------------------------------
-- Read model: rate that is effective today
-- ---------------------------------------------------------------------------

create view public.student_current_lesson_rates
with (security_invoker = true)
as
select
  r.id,
  r.teacher_id,
  r.student_id,
  r.amount_minor,
  r.currency,
  r.effective_from,
  r.effective_to,
  r.created_at,
  r.updated_at
from public.student_lesson_rates r
where r.effective_from <= current_date
  and (r.effective_to is null or current_date < r.effective_to);

comment on view public.student_current_lesson_rates is
  'Current standard lesson rate for each teacher/student relationship.';

revoke all on table public.student_current_lesson_rates from anon, authenticated;
grant select on table public.student_current_lesson_rates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Update / initialize per-student billing settings
-- ---------------------------------------------------------------------------

create or replace function public.update_student_billing_settings(
  p_student_id uuid,
  p_billing_currency public.finance_currency,
  p_online_payments_enabled boolean default null,
  p_charge_missed_lessons boolean default null
)
returns public.student_billing_settings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_result public.student_billing_settings%rowtype;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  insert into public.student_billing_settings (
    teacher_id,
    student_id,
    billing_currency,
    online_payments_enabled,
    charge_missed_lessons
  )
  values (
    v_teacher_id,
    p_student_id,
    p_billing_currency,
    coalesce(p_online_payments_enabled, false),
    coalesce(p_charge_missed_lessons, false)
  )
  on conflict (teacher_id, student_id)
  do update set
    billing_currency = excluded.billing_currency,
    online_payments_enabled = coalesce(
      p_online_payments_enabled,
      public.student_billing_settings.online_payments_enabled
    ),
    charge_missed_lessons = coalesce(
      p_charge_missed_lessons,
      public.student_billing_settings.charge_missed_lessons
    ),
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.update_student_billing_settings(
  uuid,
  public.finance_currency,
  boolean,
  boolean
) from public, anon;

grant execute on function public.update_student_billing_settings(
  uuid,
  public.finance_currency,
  boolean,
  boolean
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Set a versioned standard lesson rate
--
-- Rules:
-- - past rates cannot be rewritten through this RPC;
-- - an existing rate starting on the same future/today date is updated;
-- - otherwise the previous period is closed and the new period ends at the
--   next already-scheduled rate, if any;
-- - when the new rate starts today, billing_currency follows the rate currency.
-- ---------------------------------------------------------------------------

create or replace function public.set_student_lesson_rate(
  p_student_id uuid,
  p_amount_minor bigint,
  p_currency public.finance_currency,
  p_effective_from date default current_date
)
returns public.student_lesson_rates
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_next_from date;
  v_existing_id uuid;
  v_result public.student_lesson_rates%rowtype;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'INVALID_LESSON_RATE';
  end if;

  if p_effective_from is null or p_effective_from < current_date then
    raise exception 'LESSON_RATE_PAST_DATE_NOT_ALLOWED';
  end if;

  -- Serialize rate changes for this student.
  perform r.id
  from public.student_lesson_rates r
  where r.teacher_id = v_teacher_id
    and r.student_id = p_student_id
  order by r.effective_from
  for update;

  select r.id
  into v_existing_id
  from public.student_lesson_rates r
  where r.teacher_id = v_teacher_id
    and r.student_id = p_student_id
    and r.effective_from = p_effective_from
  limit 1;

  if v_existing_id is not null then
    update public.student_lesson_rates
    set
      amount_minor = p_amount_minor,
      currency = p_currency,
      updated_at = now()
    where id = v_existing_id
    returning * into v_result;
  else
    select min(r.effective_from)
    into v_next_from
    from public.student_lesson_rates r
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.effective_from > p_effective_from;

    -- Close the rate that currently overlaps the new start date.
    update public.student_lesson_rates r
    set
      effective_to = p_effective_from,
      updated_at = now()
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.effective_from < p_effective_from
      and (r.effective_to is null or r.effective_to > p_effective_from);

    insert into public.student_lesson_rates (
      teacher_id,
      student_id,
      amount_minor,
      currency,
      effective_from,
      effective_to
    )
    values (
      v_teacher_id,
      p_student_id,
      p_amount_minor,
      p_currency,
      p_effective_from,
      v_next_from
    )
    returning * into v_result;
  end if;

  -- Ensure settings exist. The current billing currency follows a rate that
  -- becomes effective today; a future rate does not prematurely switch it.
  insert into public.student_billing_settings (
    teacher_id,
    student_id,
    billing_currency
  )
  values (
    v_teacher_id,
    p_student_id,
    p_currency
  )
  on conflict (teacher_id, student_id)
  do update set
    billing_currency = case
      when p_effective_from = current_date then excluded.billing_currency
      else public.student_billing_settings.billing_currency
    end,
    updated_at = now();

  return v_result;
end;
$function$;

revoke execute on function public.set_student_lesson_rate(
  uuid,
  bigint,
  public.finance_currency,
  date
) from public, anon;

grant execute on function public.set_student_lesson_rate(
  uuid,
  bigint,
  public.finance_currency,
  date
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Teacher receiving accounts
-- ---------------------------------------------------------------------------

create or replace function public.create_payment_account(
  p_name text,
  p_provider text,
  p_account_type public.payment_account_type,
  p_currency public.finance_currency,
  p_external_ref text default null
)
returns public.payment_accounts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_name text;
  v_provider text;
  v_external_ref text;
  v_result public.payment_accounts%rowtype;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  v_name := trim(p_name);
  v_provider := lower(trim(p_provider));
  v_external_ref := nullif(trim(p_external_ref), '');

  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'INVALID_PAYMENT_ACCOUNT_NAME';
  end if;

  if v_provider is null or char_length(v_provider) not between 1 and 50 then
    raise exception 'INVALID_PAYMENT_ACCOUNT_PROVIDER';
  end if;

  if v_provider not in ('manual', 'monobank') then
    raise exception 'UNSUPPORTED_PAYMENT_ACCOUNT_PROVIDER';
  end if;

  insert into public.payment_accounts (
    teacher_id,
    name,
    provider,
    account_type,
    currency,
    external_ref
  )
  values (
    v_teacher_id,
    v_name,
    v_provider,
    p_account_type,
    p_currency,
    v_external_ref
  )
  returning * into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.create_payment_account(
  text,
  text,
  public.payment_account_type,
  public.finance_currency,
  text
) from public, anon;

grant execute on function public.create_payment_account(
  text,
  text,
  public.payment_account_type,
  public.finance_currency,
  text
) to authenticated, service_role;

create or replace function public.set_payment_account_active(
  p_account_id uuid,
  p_is_active boolean
)
returns public.payment_accounts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_result public.payment_accounts%rowtype;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  update public.payment_accounts
  set
    is_active = coalesce(p_is_active, false),
    updated_at = now()
  where id = p_account_id
    and teacher_id = v_teacher_id
  returning * into v_result;

  if not found then
    raise exception 'PAYMENT_ACCOUNT_NOT_FOUND';
  end if;

  return v_result;
end;
$function$;

revoke execute on function public.set_payment_account_active(uuid, boolean)
  from public, anon;
grant execute on function public.set_payment_account_active(uuid, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Record a succeeded manual payment and credit the ledger atomically.
-- Only cash and bank transfer are manual methods; card / Apple Pay / monopay
-- are reserved for a payment-provider integration.
-- ---------------------------------------------------------------------------

create or replace function public.record_manual_student_payment(
  p_student_id uuid,
  p_amount_minor bigint,
  p_currency public.finance_currency,
  p_payment_account_id uuid,
  p_payment_method public.payment_method,
  p_description text default null,
  p_paid_at timestamptz default now(),
  p_client_request_id uuid default null
)
returns table (
  payment_id uuid,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_account_type public.payment_account_type;
  v_existing_payment_id uuid;
  v_existing_transaction_id uuid;
  v_existing_student_id uuid;
  v_existing_amount_minor bigint;
  v_existing_currency public.finance_currency;
  v_existing_account_id uuid;
  v_existing_method public.payment_method;
  v_payment_id uuid;
  v_transaction_id uuid;
  v_description text;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'INVALID_PAYMENT_AMOUNT';
  end if;

  if p_payment_method not in (
    'cash'::public.payment_method,
    'bank_transfer'::public.payment_method
  ) then
    raise exception 'INVALID_MANUAL_PAYMENT_METHOD';
  end if;

  if p_paid_at is null then
    raise exception 'PAYMENT_DATE_REQUIRED';
  end if;

  v_description := nullif(trim(p_description), '');

  -- Retry safety. Serialize the same client request UUID so concurrent retries
  -- cannot both create a payment. A reused request UUID with different business
  -- inputs is rejected instead of silently returning an unrelated payment.
  if p_client_request_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_client_request_id::text, 0)
    );

    select
      p.id,
      p.student_id,
      p.amount_minor,
      p.currency,
      p.payment_account_id,
      p.payment_method
    into
      v_existing_payment_id,
      v_existing_student_id,
      v_existing_amount_minor,
      v_existing_currency,
      v_existing_account_id,
      v_existing_method
    from public.payments p
    where p.teacher_id = v_teacher_id
      and p.client_request_id = p_client_request_id;

    if v_existing_payment_id is not null then
      if v_existing_student_id <> p_student_id
         or v_existing_amount_minor <> p_amount_minor
         or v_existing_currency <> p_currency
         or v_existing_account_id is distinct from p_payment_account_id
         or v_existing_method <> p_payment_method then
        raise exception 'PAYMENT_REQUEST_ID_CONFLICT';
      end if;

      select t.id
      into v_existing_transaction_id
      from public.student_finance_transactions t
      where t.payment_id = v_existing_payment_id
        and t.transaction_type = 'payment'::public.finance_transaction_type;

      if v_existing_transaction_id is null then
        raise exception 'PAYMENT_LEDGER_INCONSISTENT';
      end if;

      return query
      select v_existing_payment_id, v_existing_transaction_id;
      return;
    end if;
  end if;

  select a.account_type
  into v_account_type
  from public.payment_accounts a
  where a.id = p_payment_account_id
    and a.teacher_id = v_teacher_id
    and a.currency = p_currency
    and a.is_active = true
  for update;

  if not found then
    raise exception 'PAYMENT_ACCOUNT_NOT_FOUND_OR_CURRENCY_MISMATCH';
  end if;

  if p_payment_method = 'cash'::public.payment_method
     and v_account_type <> 'cash'::public.payment_account_type then
    raise exception 'CASH_PAYMENT_REQUIRES_CASH_ACCOUNT';
  end if;

  if p_payment_method = 'bank_transfer'::public.payment_method
     and v_account_type = 'cash'::public.payment_account_type then
    raise exception 'BANK_TRANSFER_REQUIRES_NON_CASH_ACCOUNT';
  end if;

  insert into public.payments (
    teacher_id,
    student_id,
    payment_account_id,
    amount_minor,
    currency,
    provider,
    payment_method,
    status,
    description,
    paid_at,
    created_by,
    client_request_id
  )
  values (
    v_teacher_id,
    p_student_id,
    p_payment_account_id,
    p_amount_minor,
    p_currency,
    'manual'::public.payment_provider,
    p_payment_method,
    'succeeded'::public.payment_status,
    v_description,
    p_paid_at,
    v_teacher_id,
    p_client_request_id
  )
  returning id into v_payment_id;

  insert into public.student_finance_transactions (
    teacher_id,
    student_id,
    transaction_type,
    amount_minor,
    currency,
    payment_id,
    description,
    effective_at,
    created_by
  )
  values (
    v_teacher_id,
    p_student_id,
    'payment'::public.finance_transaction_type,
    p_amount_minor,
    p_currency,
    v_payment_id,
    v_description,
    p_paid_at,
    v_teacher_id
  )
  returning id into v_transaction_id;

  return query
  select v_payment_id, v_transaction_id;
end;
$function$;

revoke execute on function public.record_manual_student_payment(
  uuid,
  bigint,
  public.finance_currency,
  uuid,
  public.payment_method,
  text,
  timestamptz,
  uuid
) from public, anon;

grant execute on function public.record_manual_student_payment(
  uuid,
  bigint,
  public.finance_currency,
  uuid,
  public.payment_method,
  text,
  timestamptz,
  uuid
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Manual balance adjustment. No payment row is created because this represents
-- an accounting correction/credit/debit rather than movement through a payment
-- provider or receiving account.
-- ---------------------------------------------------------------------------

create or replace function public.add_student_finance_adjustment(
  p_student_id uuid,
  p_amount_minor bigint,
  p_currency public.finance_currency,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_description text;
  v_transaction_id uuid;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  if p_amount_minor is null or p_amount_minor = 0 then
    raise exception 'INVALID_ADJUSTMENT_AMOUNT';
  end if;

  v_description := nullif(trim(p_description), '');

  if v_description is null or char_length(v_description) < 3 then
    raise exception 'ADJUSTMENT_REASON_REQUIRED';
  end if;

  if char_length(v_description) > 500 then
    raise exception 'ADJUSTMENT_REASON_TOO_LONG';
  end if;

  insert into public.student_finance_transactions (
    teacher_id,
    student_id,
    transaction_type,
    amount_minor,
    currency,
    description,
    effective_at,
    created_by
  )
  values (
    v_teacher_id,
    p_student_id,
    'adjustment'::public.finance_transaction_type,
    p_amount_minor,
    p_currency,
    v_description,
    now(),
    v_teacher_id
  )
  returning id into v_transaction_id;

  return v_transaction_id;
end;
$function$;

revoke execute on function public.add_student_finance_adjustment(
  uuid,
  bigint,
  public.finance_currency,
  text
) from public, anon;

grant execute on function public.add_student_finance_adjustment(
  uuid,
  bigint,
  public.finance_currency,
  text
) to authenticated, service_role;

commit;
