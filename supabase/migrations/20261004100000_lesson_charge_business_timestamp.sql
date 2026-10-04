-- Lesson-derived finance operations belong to the lesson business time.
--
-- effective_at for lesson charges and their charge-state reversals must be the
-- CURRENT lesson.starts_at. Transaction history also displays lesson charges by
-- that business timestamp. created_at remains the
-- immutable audit timestamp showing when the financial record was actually
-- written. This is especially important for rescheduled lessons: the charge is
-- shown against the rescheduled lesson time, not its original occurrence date
-- and not the later teacher confirmation time.

create or replace function public.set_lesson_finance_charge_state(
  p_lesson_id uuid,
  p_should_charge boolean,
  p_reason text default null,
  p_effective_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lesson public.lessons%rowtype;
  v_root public.student_finance_transactions%rowtype;
  v_head public.student_finance_transactions%rowtype;
  v_head_id uuid;
  v_head_depth integer := 0;
  v_is_charged boolean := false;
begin
  select l.*
  into v_lesson
  from public.lessons l
  where l.id = p_lesson_id;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  select t.*
  into v_root
  from public.student_finance_transactions t
  where t.lesson_id = p_lesson_id
    and t.transaction_type = 'lesson_charge'::public.finance_transaction_type
  limit 1;

  if not found then
    if not p_should_charge then
      return;
    end if;

    if v_lesson.price_amount_minor is null
       or v_lesson.price_currency is null
       or v_lesson.price_rate_id is null then
      raise exception 'LESSON_PRICE_NOT_SET';
    end if;

    insert into public.student_finance_transactions (
      teacher_id,
      student_id,
      transaction_type,
      amount_minor,
      currency,
      lesson_id,
      description,
      metadata,
      effective_at,
      created_by
    )
    values (
      v_lesson.teacher_id,
      v_lesson.student_id,
      'lesson_charge'::public.finance_transaction_type,
      -v_lesson.price_amount_minor,
      v_lesson.price_currency,
      v_lesson.id,
      null,
      jsonb_build_object(
        'reason', coalesce(p_reason, 'lesson_outcome'),
        'pricingDate', v_lesson.pricing_date,
        'priceRateId', v_lesson.price_rate_id,
        'lessonStartsAt', v_lesson.starts_at
      ),
      v_lesson.starts_at,
      v_lesson.teacher_id
    );

    return;
  end if;

  with recursive charge_chain as (
    select
      t.id,
      t.amount_minor,
      t.currency,
      t.reversal_of_id,
      0::integer as depth
    from public.student_finance_transactions t
    where t.id = v_root.id

    union all

    select
      r.id,
      r.amount_minor,
      r.currency,
      r.reversal_of_id,
      c.depth + 1
    from charge_chain c
    join public.student_finance_transactions r
      on r.reversal_of_id = c.id
     and r.transaction_type = 'reversal'::public.finance_transaction_type
  )
  select c.id, c.depth
  into v_head_id, v_head_depth
  from charge_chain c
  order by c.depth desc
  limit 1;

  select t.*
  into v_head
  from public.student_finance_transactions t
  where t.id = v_head_id;

  v_is_charged := (mod(v_head_depth, 2) = 0);

  if v_is_charged = p_should_charge then
    return;
  end if;

  insert into public.student_finance_transactions (
    teacher_id,
    student_id,
    transaction_type,
    amount_minor,
    currency,
    reversal_of_id,
    description,
    metadata,
    effective_at,
    created_by
  )
  values (
    v_lesson.teacher_id,
    v_lesson.student_id,
    'reversal'::public.finance_transaction_type,
    -v_head.amount_minor,
    v_head.currency,
    v_head.id,
    null,
    jsonb_build_object(
      'reason', coalesce(p_reason, 'lesson_outcome'),
      'lessonId', v_lesson.id,
      'lessonStartsAt', v_lesson.starts_at,
      'reversedTransactionId', v_head.id,
      'targetChargedState', p_should_charge
    ),
    v_lesson.starts_at,
    v_lesson.teacher_id
  );
end;
$function$;

-- Keep the existing signature/grants because multiple lesson/cancellation RPCs
-- already call it. p_effective_at is retained only for backwards compatibility;
-- lesson-derived finance rows now always use the lesson business timestamp.
revoke all on function public.set_lesson_finance_charge_state(uuid, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_lesson_finance_charge_state(uuid, boolean, text, timestamptz)
  to service_role;

-- History uses lesson.starts_at as the business timestamp for lesson charges.
-- This also corrects the DISPLAY of already-existing immutable charge rows
-- whose stored effective_at may have been written with the confirmation time.
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
  case
    when t.transaction_type = 'lesson_charge'::public.finance_transaction_type
      then coalesce(nullif(t.metadata ->> 'lessonStartsAt', '')::timestamptz, t.effective_at)
    else t.effective_at
  end as effective_at,
  t.created_at,
  (
    case
      when t.transaction_type = 'lesson_charge'::public.finance_transaction_type
        then coalesce(nullif(t.metadata ->> 'lessonStartsAt', '')::timestamptz, t.effective_at)
      else t.effective_at
    end at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv')
  )::date as effective_date,
  t.metadata,
  case
    when t.transaction_type = 'lesson_charge'::public.finance_transaction_type
      then coalesce(nullif(t.metadata ->> 'lessonStartsAt', '')::timestamptz, t.effective_at, t.created_at)
    else t.created_at
  end as display_at,
  (
    case
      when t.transaction_type = 'lesson_charge'::public.finance_transaction_type
        then coalesce(nullif(t.metadata ->> 'lessonStartsAt', '')::timestamptz, t.effective_at, t.created_at)
      else t.created_at
    end at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv')
  )::date as display_date
from public.student_finance_transactions t
left join public.teacher_settings ts
  on ts.teacher_id = t.teacher_id;

comment on view public.student_finance_transaction_history is
  'Finance transaction history. Lesson charges use the lessonStartsAt ledger snapshot (current lesson.starts_at at charge time) as their business/display timestamp; created_at remains the actual ledger creation timestamp for audit. Other operations keep their existing display semantics.';

revoke all on table public.student_finance_transaction_history from anon, authenticated;
grant select on table public.student_finance_transaction_history to authenticated, service_role;
