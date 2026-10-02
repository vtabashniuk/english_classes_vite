-- Manual payment cancellation and transfer workflow.
-- Keeps the finance ledger append-only and preserves auditability.

begin;

create table if not exists public.payment_cancellations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  reversal_transaction_id uuid not null unique references public.student_finance_transactions(id) on delete restrict,
  reason_code text not null,
  reason_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payment_cancellations_reason_code_check
    check (reason_code in ('duplicate', 'not_received', 'entry_error', 'other')),
  constraint payment_cancellations_reason_note_length
    check (reason_note is null or char_length(reason_note) <= 500),
  constraint payment_cancellations_other_reason_note
    check (reason_code <> 'other' or nullif(trim(reason_note), '') is not null)
);

alter table public.payment_cancellations enable row level security;

create policy "Teacher can view own payment cancellations"
on public.payment_cancellations
for select
to authenticated
using (teacher_id = auth.uid() and public.is_teacher());

revoke all on table public.payment_cancellations from anon, authenticated;
grant select on table public.payment_cancellations to authenticated, service_role;

create table if not exists public.payment_transfers (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  source_student_id uuid not null references public.profiles(id) on delete restrict,
  target_student_id uuid not null references public.profiles(id) on delete restrict,
  original_payment_id uuid not null unique references public.payments(id) on delete restrict,
  replacement_payment_id uuid not null unique references public.payments(id) on delete restrict,
  reversal_transaction_id uuid not null unique references public.student_finance_transactions(id) on delete restrict,
  reason_code text not null,
  reason_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payment_transfers_different_students
    check (source_student_id <> target_student_id),
  constraint payment_transfers_different_payments
    check (original_payment_id <> replacement_payment_id),
  constraint payment_transfers_reason_code_check
    check (reason_code in ('wrong_student', 'other')),
  constraint payment_transfers_reason_note_length
    check (reason_note is null or char_length(reason_note) <= 500),
  constraint payment_transfers_other_reason_note
    check (reason_code <> 'other' or nullif(trim(reason_note), '') is not null)
);

alter table public.payment_transfers enable row level security;

create policy "Teacher can view own payment transfers"
on public.payment_transfers
for select
to authenticated
using (teacher_id = auth.uid() and public.is_teacher());

revoke all on table public.payment_transfers from anon, authenticated;
grant select on table public.payment_transfers to authenticated, service_role;

-- Operation history uses the actual event creation timestamp for visual sorting,
-- while effective_at/effective_date remain available for accounting semantics.
create or replace view public.student_finance_transaction_history
with (security_invoker = true)
as
select
  t.id,
  t.teacher_id,
  t.student_id,
  t.transaction_type,
  t.amount_minor,
  t.currency,
  t.lesson_id,
  t.payment_id,
  t.reversal_of_id,
  t.description,
  t.effective_at,
  t.created_at,
  (
    t.effective_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv')
  )::date as effective_date,
  t.metadata,
  t.created_at as display_at,
  (
    t.created_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv')
  )::date as display_date
from public.student_finance_transactions t
left join public.teacher_settings ts
  on ts.teacher_id = t.teacher_id;

comment on view public.student_finance_transaction_history is
  'Finance transaction history with teacher-local display date (actual operation time) and accounting effective date.';

revoke all on table public.student_finance_transaction_history from anon, authenticated;
grant select on table public.student_finance_transaction_history to authenticated, service_role;

create or replace view public.student_finance_transaction_relations
with (security_invoker = true)
as
-- Payment correction: original payment, its reversal, and replacement payment.
select
  original_tx.id as transaction_id,
  c.id as relation_id,
  'correction'::text as relation_type,
  'original'::text as relation_role,
  c.created_at as relation_created_at,
  c.student_id as source_student_id,
  c.student_id as target_student_id,
  c.original_payment_id,
  c.replacement_payment_id,
  null::text as reason_code,
  null::text as reason_note
from public.payment_corrections c
join public.student_finance_transactions original_tx
  on original_tx.payment_id = c.original_payment_id
 and original_tx.transaction_type = 'payment'::public.finance_transaction_type

union all

select
  c.reversal_transaction_id,
  c.id,
  'correction'::text,
  'reversal'::text,
  c.created_at,
  c.student_id,
  c.student_id,
  c.original_payment_id,
  c.replacement_payment_id,
  null::text,
  null::text
from public.payment_corrections c

union all

select
  replacement_tx.id,
  c.id,
  'correction'::text,
  'replacement'::text,
  c.created_at,
  c.student_id,
  c.student_id,
  c.original_payment_id,
  c.replacement_payment_id,
  null::text,
  null::text
from public.payment_corrections c
join public.student_finance_transactions replacement_tx
  on replacement_tx.payment_id = c.replacement_payment_id
 and replacement_tx.transaction_type = 'payment'::public.finance_transaction_type

union all

-- Payment cancellation: original payment and its reversal.
select
  original_tx.id,
  pc.id,
  'cancellation'::text,
  'original'::text,
  pc.created_at,
  pc.student_id,
  pc.student_id,
  pc.payment_id,
  null::uuid,
  pc.reason_code,
  pc.reason_note
from public.payment_cancellations pc
join public.student_finance_transactions original_tx
  on original_tx.payment_id = pc.payment_id
 and original_tx.transaction_type = 'payment'::public.finance_transaction_type

union all

select
  pc.reversal_transaction_id,
  pc.id,
  'cancellation'::text,
  'reversal'::text,
  pc.created_at,
  pc.student_id,
  pc.student_id,
  pc.payment_id,
  null::uuid,
  pc.reason_code,
  pc.reason_note
from public.payment_cancellations pc

union all

-- Payment transfer: source payment, source reversal, and target replacement.
select
  source_tx.id,
  pt.id,
  'transfer'::text,
  'original'::text,
  pt.created_at,
  pt.source_student_id,
  pt.target_student_id,
  pt.original_payment_id,
  pt.replacement_payment_id,
  pt.reason_code,
  pt.reason_note
from public.payment_transfers pt
join public.student_finance_transactions source_tx
  on source_tx.payment_id = pt.original_payment_id
 and source_tx.transaction_type = 'payment'::public.finance_transaction_type

union all

select
  pt.reversal_transaction_id,
  pt.id,
  'transfer'::text,
  'reversal'::text,
  pt.created_at,
  pt.source_student_id,
  pt.target_student_id,
  pt.original_payment_id,
  pt.replacement_payment_id,
  pt.reason_code,
  pt.reason_note
from public.payment_transfers pt

union all

select
  target_tx.id,
  pt.id,
  'transfer'::text,
  'replacement'::text,
  pt.created_at,
  pt.source_student_id,
  pt.target_student_id,
  pt.original_payment_id,
  pt.replacement_payment_id,
  pt.reason_code,
  pt.reason_note
from public.payment_transfers pt
join public.student_finance_transactions target_tx
  on target_tx.payment_id = pt.replacement_payment_id
 and target_tx.transaction_type = 'payment'::public.finance_transaction_type;

comment on view public.student_finance_transaction_relations is
  'Audit relation metadata used to display corrections, cancellations and transfers in a logical sequence without rewriting ledger timestamps.';

revoke all on table public.student_finance_transaction_relations from anon, authenticated;
grant select on table public.student_finance_transaction_relations to authenticated, service_role;

create or replace function public.cancel_manual_student_payment(
  p_payment_id uuid,
  p_reason_code text,
  p_reason_note text default null
)
returns table (
  payment_id uuid,
  reversal_transaction_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_payment_transaction public.student_finance_transactions%rowtype;
  v_existing public.payment_cancellations%rowtype;
  v_reversal_id uuid;
  v_cancellation_id uuid := gen_random_uuid();
  v_reason_note text := nullif(trim(p_reason_note), '');
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_reason_code not in ('duplicate', 'not_received', 'entry_error', 'other') then
    raise exception 'INVALID_PAYMENT_CANCELLATION_REASON';
  end if;

  if p_reason_code = 'other' and v_reason_note is null then
    raise exception 'PAYMENT_CANCELLATION_NOTE_REQUIRED';
  end if;

  if v_reason_note is not null and char_length(v_reason_note) > 500 then
    raise exception 'PAYMENT_CANCELLATION_NOTE_TOO_LONG';
  end if;

  select pc.*
  into v_existing
  from public.payment_cancellations pc
  where pc.payment_id = p_payment_id
    and pc.teacher_id = v_teacher_id;

  if found then
    return query select v_existing.payment_id, v_existing.reversal_transaction_id;
    return;
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.provider <> 'manual'::public.payment_provider
     or v_payment.status <> 'succeeded'::public.payment_status then
    raise exception 'PAYMENT_NOT_EDITABLE';
  end if;

  select t.*
  into v_payment_transaction
  from public.student_finance_transactions t
  where t.payment_id = v_payment.id
    and t.transaction_type = 'payment'::public.finance_transaction_type
  for update;

  if not found then
    raise exception 'PAYMENT_LEDGER_INCONSISTENT';
  end if;

  if exists (
    select 1
    from public.student_finance_transactions r
    where r.reversal_of_id = v_payment_transaction.id
      and r.transaction_type = 'reversal'::public.finance_transaction_type
  ) then
    raise exception 'PAYMENT_ALREADY_REVERSED';
  end if;

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
    v_payment.student_id,
    'reversal'::public.finance_transaction_type,
    -v_payment_transaction.amount_minor,
    v_payment_transaction.currency,
    v_payment_transaction.id,
    v_reason_note,
    now(),
    v_teacher_id,
    jsonb_build_object(
      'reason', 'payment_cancellation',
      'payment_cancellation_id', v_cancellation_id,
      'payment_id', v_payment.id,
      'reason_code', p_reason_code
    )
  )
  returning id into v_reversal_id;

  update public.payments p
  set status = 'cancelled'::public.payment_status,
      updated_at = now()
  where p.id = v_payment.id;

  -- The cancelled payment must disappear from tax and management receipt sums.
  delete from public.payment_tax_accruals pta
  where pta.payment_id = v_payment.id;

  delete from public.payment_reporting_values prv
  where prv.payment_id = v_payment.id;

  insert into public.payment_cancellations (
    id,
    teacher_id,
    student_id,
    payment_id,
    reversal_transaction_id,
    reason_code,
    reason_note,
    created_by
  )
  values (
    v_cancellation_id,
    v_teacher_id,
    v_payment.student_id,
    v_payment.id,
    v_reversal_id,
    p_reason_code,
    v_reason_note,
    v_teacher_id
  );

  return query select v_payment.id, v_reversal_id;
end;
$function$;

revoke all on function public.cancel_manual_student_payment(uuid, text, text)
  from public, anon;
grant execute on function public.cancel_manual_student_payment(uuid, text, text)
  to authenticated, service_role;

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

  update public.payment_reporting_values prv
  set payment_id = v_new_payment_id
  where prv.payment_id = v_original.id;

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

comment on function public.cancel_manual_student_payment(uuid, text, text) is
  'Cancels an incorrectly recorded manual payment by reversing the ledger credit and removing its derived tax/reporting snapshots.';

comment on function public.transfer_manual_student_payment(uuid, uuid, text, text, uuid) is
  'Transfers a real manual receipt to another assigned student. The original student credit is reversed, a replacement credit is created, and existing tax/reporting snapshots are moved without double-counting income.';

commit;
