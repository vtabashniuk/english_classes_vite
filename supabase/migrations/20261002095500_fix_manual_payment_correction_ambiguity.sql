-- Fix ambiguous payment_id references in correct_manual_student_payment().
-- The RETURNS TABLE output column payment_id is also a PL/pgSQL variable,
-- so table columns must be qualified explicitly.

begin;

create or replace function public.correct_manual_student_payment(
  p_payment_id uuid,
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
  transaction_id uuid,
  reversal_transaction_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_original public.payments%rowtype;
  v_original_transaction public.student_finance_transactions%rowtype;
  v_existing_correction public.payment_corrections%rowtype;
  v_existing_replacement public.payments%rowtype;
  v_account_type public.payment_account_type;
  v_owner_type public.payment_account_owner_type;
  v_timezone text;
  v_payment_date date;
  v_description text;
  v_new_payment_id uuid;
  v_new_transaction_id uuid;
  v_reversal_id uuid;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
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

  select p.*
  into v_original
  from public.payments p
  where p.id = p_payment_id
    and p.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  select c.*
  into v_existing_correction
  from public.payment_corrections c
  where c.original_payment_id = v_original.id;

  if found then
    select p.*
    into v_existing_replacement
    from public.payments p
    where p.id = v_existing_correction.replacement_payment_id;

    if p_client_request_id is not null
       and v_existing_replacement.client_request_id = p_client_request_id then
      select t.id
      into v_new_transaction_id
      from public.student_finance_transactions t
      where t.payment_id = v_existing_replacement.id
        and t.transaction_type = 'payment'::public.finance_transaction_type;

      return query
      select v_existing_replacement.id, v_new_transaction_id, v_existing_correction.reversal_transaction_id;
      return;
    end if;

    raise exception 'PAYMENT_ALREADY_CORRECTED';
  end if;

  if v_original.provider <> 'manual'::public.payment_provider
     or v_original.status <> 'succeeded'::public.payment_status then
    raise exception 'PAYMENT_NOT_EDITABLE';
  end if;

  select t.*
  into v_original_transaction
  from public.student_finance_transactions t
  where t.payment_id = v_original.id
    and t.transaction_type = 'payment'::public.finance_transaction_type
  for update;

  if not found then
    raise exception 'PAYMENT_LEDGER_INCONSISTENT';
  end if;

  if exists (
    select 1
    from public.student_finance_transactions r
    where r.reversal_of_id = v_original_transaction.id
      and r.transaction_type = 'reversal'::public.finance_transaction_type
  ) then
    raise exception 'PAYMENT_ALREADY_REVERSED';
  end if;

  select a.account_type, a.owner_type
  into v_account_type, v_owner_type
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

  select ts.schedule_timezone
  into v_timezone
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  v_payment_date := (
    p_paid_at at time zone coalesce(v_timezone, 'Europe/Kyiv')
  )::date;

  if v_payment_date > public.get_teacher_local_date(v_teacher_id) then
    raise exception 'FUTURE_PAYMENT_DATE_NOT_ALLOWED';
  end if;

  if v_owner_type = 'pe'::public.payment_account_owner_type
     and not exists (
       select 1
       from public.teacher_tax_profiles tp
       where tp.teacher_id = v_teacher_id
         and tp.taxpayer_type = 'pe'::public.teacher_taxpayer_type
         and tp.effective_from <= v_payment_date
         and (tp.effective_to is null or v_payment_date < tp.effective_to)
     ) then
    raise exception 'PE_TAX_PROFILE_REQUIRED_FOR_PAYMENT';
  end if;

  v_description := nullif(trim(p_description), '');

  if v_original.amount_minor = p_amount_minor
     and v_original.currency = p_currency
     and v_original.payment_account_id is not distinct from p_payment_account_id
     and v_original.payment_method = p_payment_method
     and coalesce(v_original.description, '') = coalesce(v_description, '')
     and v_original.paid_at = p_paid_at then
    raise exception 'PAYMENT_UNCHANGED';
  end if;

  if p_client_request_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_client_request_id::text, 0)
    );

    if exists (
      select 1
      from public.payments p
      where p.teacher_id = v_teacher_id
        and p.client_request_id = p_client_request_id
    ) then
      raise exception 'PAYMENT_REQUEST_ID_CONFLICT';
    end if;
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
    v_original.student_id,
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
  returning id into v_new_payment_id;

  insert into public.student_finance_transactions (
    teacher_id,
    student_id,
    transaction_type,
    amount_minor,
    currency,
    payment_id,
    description,
    effective_at,
    created_by,
    metadata
  )
  values (
    v_teacher_id,
    v_original.student_id,
    'payment'::public.finance_transaction_type,
    p_amount_minor,
    p_currency,
    v_new_payment_id,
    v_description,
    p_paid_at,
    v_teacher_id,
    jsonb_build_object('payment_correction', true, 'corrects_payment_id', v_original.id)
  )
  returning id into v_new_transaction_id;

  insert into public.student_finance_transactions (
    teacher_id,
    student_id,
    transaction_type,
    amount_minor,
    currency,
    reversal_of_id,
    description,
    effective_at,
    created_by,
    metadata
  )
  values (
    v_teacher_id,
    v_original.student_id,
    'reversal'::public.finance_transaction_type,
    -v_original_transaction.amount_minor,
    v_original_transaction.currency,
    v_original_transaction.id,
    null,
    now(),
    v_teacher_id,
    jsonb_build_object('reason', 'payment_correction', 'replacement_payment_id', v_new_payment_id)
  )
  returning id into v_reversal_id;

  update public.payments
  set status = 'cancelled'::public.payment_status,
      updated_at = now()
  where id = v_original.id;

  -- Tax/reporting rows are derived data. Remove the superseded snapshots so all
  -- summaries and Finance dashboard views use only the corrected payment.
  delete from public.payment_tax_accruals pta
  where pta.payment_id = v_original.id;

  delete from public.payment_reporting_values prv
  where prv.payment_id = v_original.id;

  perform public.create_payment_tax_accrual_if_needed(v_new_payment_id);
  perform public.create_payment_reporting_value_if_needed(v_new_payment_id);

  insert into public.payment_corrections (
    teacher_id,
    student_id,
    original_payment_id,
    replacement_payment_id,
    reversal_transaction_id,
    created_by
  )
  values (
    v_teacher_id,
    v_original.student_id,
    v_original.id,
    v_new_payment_id,
    v_reversal_id,
    v_teacher_id
  );

  return query
  select v_new_payment_id, v_new_transaction_id, v_reversal_id;
end;
$function$;

revoke all on function public.correct_manual_student_payment(
  uuid, bigint, public.finance_currency, uuid, public.payment_method, text, timestamptz, uuid
) from public, anon;

grant execute on function public.correct_manual_student_payment(
  uuid, bigint, public.finance_currency, uuid, public.payment_method, text, timestamptz, uuid
) to authenticated, service_role;

comment on function public.correct_manual_student_payment(
  uuid, bigint, public.finance_currency, uuid, public.payment_method, text, timestamptz, uuid
) is 'Corrects a manually recorded payment without mutating the immutable finance ledger. The old payment credit is reversed and a corrected replacement payment is created.';


commit;
