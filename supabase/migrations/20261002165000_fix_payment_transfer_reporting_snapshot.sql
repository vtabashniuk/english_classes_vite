-- Hotfix: preserve the original payment reporting snapshot during a student transfer.
-- The replacement payment fires payments_sync_reporting_value automatically;
-- without removing that generated row first, re-keying the original snapshot
-- causes payment_reporting_values_pkey (payment_id) duplicate-key error 23505.

begin;

create or replace function public.transfer_manual_student_payment(
  p_payment_id uuid,
  p_target_student_id uuid,
  p_reason_code text,
  p_reason_note text default null,
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
  v_existing public.payment_transfers%rowtype;
  v_existing_replacement public.payments%rowtype;
  v_new_payment_id uuid;
  v_new_transaction_id uuid;
  v_reversal_id uuid;
  v_transfer_id uuid := gen_random_uuid();
  v_reason_note text := nullif(trim(p_reason_note), '');
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_target_student_id is null then
    raise exception 'TARGET_STUDENT_REQUIRED';
  end if;

  if p_reason_code not in ('wrong_student', 'other') then
    raise exception 'INVALID_PAYMENT_TRANSFER_REASON';
  end if;

  if p_reason_code = 'other' and v_reason_note is null then
    raise exception 'PAYMENT_TRANSFER_NOTE_REQUIRED';
  end if;

  if v_reason_note is not null and char_length(v_reason_note) > 500 then
    raise exception 'PAYMENT_TRANSFER_NOTE_TOO_LONG';
  end if;

  select pt.*
  into v_existing
  from public.payment_transfers pt
  where pt.original_payment_id = p_payment_id
    and pt.teacher_id = v_teacher_id;

  if found then
    select p.*
    into v_existing_replacement
    from public.payments p
    where p.id = v_existing.replacement_payment_id;

    if p_client_request_id is not null
       and v_existing_replacement.client_request_id = p_client_request_id then
      select t.id
      into v_new_transaction_id
      from public.student_finance_transactions t
      where t.payment_id = v_existing.replacement_payment_id
        and t.transaction_type = 'payment'::public.finance_transaction_type;

      return query
      select v_existing.replacement_payment_id, v_new_transaction_id, v_existing.reversal_transaction_id;
      return;
    end if;

    raise exception 'PAYMENT_ALREADY_TRANSFERRED';
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

  if v_original.provider <> 'manual'::public.payment_provider
     or v_original.status <> 'succeeded'::public.payment_status then
    raise exception 'PAYMENT_NOT_EDITABLE';
  end if;

  if v_original.student_id = p_target_student_id then
    raise exception 'PAYMENT_TRANSFER_SAME_STUDENT';
  end if;

  if not exists (
    select 1
    from public.teacher_students ts
    where ts.teacher_id = v_teacher_id
      and ts.student_id = p_target_student_id
      and ts.is_active = true
  ) then
    raise exception 'TARGET_STUDENT_NOT_ASSIGNED';
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
    provider_invoice_id,
    provider_payment_id,
    description,
    provider_metadata,
    paid_at,
    created_by,
    client_request_id
  )
  values (
    v_teacher_id,
    p_target_student_id,
    v_original.payment_account_id,
    v_original.amount_minor,
    v_original.currency,
    v_original.provider,
    v_original.payment_method,
    'succeeded'::public.payment_status,
    null,
    null,
    v_original.description,
    coalesce(v_original.provider_metadata, '{}'::jsonb) || jsonb_build_object(
      'payment_transfer', true,
      'transferred_from_payment_id', v_original.id,
      'transfer_id', v_transfer_id
    ),
    v_original.paid_at,
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
    p_target_student_id,
    'payment'::public.finance_transaction_type,
    v_original.amount_minor,
    v_original.currency,
    v_new_payment_id,
    v_original.description,
    v_original.paid_at,
    v_teacher_id,
    jsonb_build_object(
      'payment_transfer', true,
      'transfer_id', v_transfer_id,
      'transferred_from_payment_id', v_original.id,
      'source_student_id', v_original.student_id
    )
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
    v_reason_note,
    now(),
    v_teacher_id,
    jsonb_build_object(
      'reason', 'payment_transfer',
      'payment_transfer_id', v_transfer_id,
      'replacement_payment_id', v_new_payment_id,
      'target_student_id', p_target_student_id,
      'reason_code', p_reason_code
    )
  )
  returning id into v_reversal_id;

  update public.payments p
  set status = 'cancelled'::public.payment_status,
      updated_at = now()
  where p.id = v_original.id;

  -- The receipt itself is real, so move the existing tax/FX snapshots to the
  -- replacement payment instead of deleting/recalculating them.
  update public.payment_tax_accruals pta
  set payment_id = v_new_payment_id
  where pta.payment_id = v_original.id;

  -- INSERTing the replacement payment fires payments_sync_reporting_value,
  -- which creates a fresh reporting row for v_new_payment_id. If the original
  -- payment already has a reporting snapshot, preserve that exact historical
  -- snapshot (including FX/NBU data) instead of the auto-generated replacement.
  if exists (
    select 1
    from public.payment_reporting_values prv
    where prv.payment_id = v_original.id
  ) then
    delete from public.payment_reporting_values prv
    where prv.payment_id = v_new_payment_id;

    update public.payment_reporting_values prv
    set payment_id = v_new_payment_id
    where prv.payment_id = v_original.id;
  end if;

  insert into public.payment_transfers (
    id,
    teacher_id,
    source_student_id,
    target_student_id,
    original_payment_id,
    replacement_payment_id,
    reversal_transaction_id,
    reason_code,
    reason_note,
    created_by
  )
  values (
    v_transfer_id,
    v_teacher_id,
    v_original.student_id,
    p_target_student_id,
    v_original.id,
    v_new_payment_id,
    v_reversal_id,
    p_reason_code,
    v_reason_note,
    v_teacher_id
  );

  return query select v_new_payment_id, v_new_transaction_id, v_reversal_id;
end;
$function$;

revoke all on function public.transfer_manual_student_payment(uuid, uuid, text, text, uuid)
  from public, anon;
grant execute on function public.transfer_manual_student_payment(uuid, uuid, text, text, uuid)
  to authenticated, service_role;


comment on function public.transfer_manual_student_payment(uuid, uuid, text, text, uuid) is
'Transfers a real manual receipt to another student by reversing the source ledger credit and creating a replacement credit, while preserving the original tax/reporting snapshot and avoiding duplicate reporting rows created by the payment trigger.';

commit;
