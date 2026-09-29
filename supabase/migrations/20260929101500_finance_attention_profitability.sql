-- Finance dashboard extensions:
-- 1) stable UAH reporting values for every successful payment (including personal/cash FX),
-- 2) payment-level management net income with monthly fixed-tax allocation,
-- 3) teacher student finance health for debtors and low-balance attention lists.
--
-- IMPORTANT: "net income" here is a management analytics metric, not statutory
-- tax attribution. Variable income taxes stay attached to the PE payment that
-- generated them. Monthly fixed taxes are allocated proportionally by each
-- payment's UAH-equivalent share of all receipts in that teacher-local month.

begin;

-- ---------------------------------------------------------------------------
-- UAH reporting snapshot for every successful payment.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_reporting_values (
  payment_id uuid primary key references public.payments(id) on delete restrict,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  payment_date date not null,
  source_amount_minor bigint not null,
  source_currency public.finance_currency not null,
  fx_source text,
  fx_rate numeric(20,8),
  fx_rate_date date,
  amount_uah_minor bigint,
  status text not null,
  calculation_error text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,

  constraint payment_reporting_values_source_amount_positive
    check (source_amount_minor > 0),
  constraint payment_reporting_values_status_check
    check (status in ('ready', 'fx_pending', 'error')),
  constraint payment_reporting_values_ready_shape
    check (
      status <> 'ready'
      or (
        amount_uah_minor is not null
        and amount_uah_minor > 0
        and resolved_at is not null
      )
    ),
  constraint payment_reporting_values_fx_shape
    check (
      source_currency = 'UAH'::public.finance_currency
      or status <> 'ready'
      or (
        fx_source is not null
        and fx_rate is not null
        and fx_rate > 0
        and fx_rate_date is not null
      )
    )
);

alter table public.payment_reporting_values enable row level security;

create index if not exists payment_reporting_values_teacher_date_idx
  on public.payment_reporting_values (teacher_id, payment_date desc);

create index if not exists payment_reporting_values_pending_idx
  on public.payment_reporting_values (teacher_id, status, payment_date)
  where status = 'fx_pending';

comment on table public.payment_reporting_values is
  'Immutable-style reporting snapshot that converts every successful receipt to UAH for management analytics. FX uses the official NBU rate for the teacher-local payment date.';

create policy "Teacher can view own payment reporting values"
on public.payment_reporting_values
for select
to authenticated
using (teacher_id = auth.uid() and public.is_teacher());

revoke all on table public.payment_reporting_values from anon, authenticated;
grant select on table public.payment_reporting_values to authenticated, service_role;

create or replace function public.create_payment_reporting_value_if_needed(
  p_payment_id uuid
)
returns public.payment_reporting_values
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_payment_date date;
  v_existing public.payment_reporting_values%rowtype;
  v_tax public.payment_tax_accruals%rowtype;
  v_result public.payment_reporting_values%rowtype;
begin
  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status <> 'succeeded'::public.payment_status or v_payment.paid_at is null then
    raise exception 'PAYMENT_NOT_SUCCEEDED';
  end if;

  select r.*
  into v_existing
  from public.payment_reporting_values r
  where r.payment_id = p_payment_id;

  if found then
    return v_existing;
  end if;

  v_payment_date := (
    v_payment.paid_at at time zone coalesce(
      (
        select ts.schedule_timezone
        from public.teacher_settings ts
        where ts.teacher_id = v_payment.teacher_id
      ),
      'Europe/Kyiv'
    )
  )::date;

  if v_payment.currency = 'UAH'::public.finance_currency then
    insert into public.payment_reporting_values (
      payment_id,
      teacher_id,
      payment_date,
      source_amount_minor,
      source_currency,
      fx_source,
      fx_rate,
      fx_rate_date,
      amount_uah_minor,
      status,
      resolved_at
    )
    values (
      v_payment.id,
      v_payment.teacher_id,
      v_payment_date,
      v_payment.amount_minor,
      v_payment.currency,
      'native_uah',
      1,
      v_payment_date,
      v_payment.amount_minor,
      'ready',
      now()
    )
    returning * into v_result;

    return v_result;
  end if;

  -- Reuse an already resolved PE tax FX snapshot when it exists.
  select a.*
  into v_tax
  from public.payment_tax_accruals a
  where a.payment_id = p_payment_id
    and a.status = 'ready'::public.payment_tax_accrual_status;

  if found and v_tax.tax_base_uah_minor is not null and v_tax.fx_rate is not null then
    insert into public.payment_reporting_values (
      payment_id,
      teacher_id,
      payment_date,
      source_amount_minor,
      source_currency,
      fx_source,
      fx_rate,
      fx_rate_date,
      amount_uah_minor,
      status,
      resolved_at
    )
    values (
      v_payment.id,
      v_payment.teacher_id,
      v_payment_date,
      v_payment.amount_minor,
      v_payment.currency,
      coalesce(v_tax.fx_source, 'NBU'),
      v_tax.fx_rate,
      v_tax.fx_rate_date,
      v_tax.tax_base_uah_minor,
      'ready',
      now()
    )
    returning * into v_result;

    return v_result;
  end if;

  insert into public.payment_reporting_values (
    payment_id,
    teacher_id,
    payment_date,
    source_amount_minor,
    source_currency,
    fx_source,
    status
  )
  values (
    v_payment.id,
    v_payment.teacher_id,
    v_payment_date,
    v_payment.amount_minor,
    v_payment.currency,
    'NBU',
    'fx_pending'
  )
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.create_payment_reporting_value_if_needed(uuid)
  from public, anon, authenticated;
grant execute on function public.create_payment_reporting_value_if_needed(uuid)
  to service_role;

create or replace function public.finalize_payment_reporting_value(
  p_payment_id uuid,
  p_fx_rate numeric,
  p_fx_rate_date date
)
returns public.payment_reporting_values
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.payment_reporting_values%rowtype;
  v_amount_uah bigint;
begin
  if p_fx_rate is null or p_fx_rate <= 0 or p_fx_rate_date is null then
    raise exception 'INVALID_FX_RATE';
  end if;

  select r.*
  into v_row
  from public.payment_reporting_values r
  where r.payment_id = p_payment_id
  for update;

  if not found then
    raise exception 'PAYMENT_REPORTING_VALUE_NOT_FOUND';
  end if;

  if v_row.status = 'ready' then
    return v_row;
  end if;

  if v_row.source_currency = 'UAH'::public.finance_currency then
    raise exception 'FX_RATE_NOT_REQUIRED';
  end if;

  v_amount_uah := round(v_row.source_amount_minor * p_fx_rate)::bigint;

  update public.payment_reporting_values
  set
    fx_source = 'NBU',
    fx_rate = p_fx_rate,
    fx_rate_date = p_fx_rate_date,
    amount_uah_minor = v_amount_uah,
    status = 'ready',
    calculation_error = null,
    resolved_at = now()
  where payment_id = p_payment_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.finalize_payment_reporting_value(uuid, numeric, date)
  from public, anon, authenticated;
grant execute on function public.finalize_payment_reporting_value(uuid, numeric, date)
  to service_role;

create or replace function public.sync_payment_reporting_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'succeeded'::public.payment_status
     and new.paid_at is not null
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.paid_at is distinct from new.paid_at
     ) then
    perform public.create_payment_reporting_value_if_needed(new.id);
  end if;

  return new;
end;
$function$;

revoke all on function public.sync_payment_reporting_value()
  from public, anon, authenticated;
grant execute on function public.sync_payment_reporting_value()
  to service_role;

drop trigger if exists payments_sync_reporting_value on public.payments;
create trigger payments_sync_reporting_value
after insert or update of status, paid_at on public.payments
for each row execute function public.sync_payment_reporting_value();

-- Backfill already successful payments. Use a resolved tax snapshot where
-- possible; otherwise foreign personal/cash receipts remain fx_pending until
-- the resolver is invoked.
insert into public.payment_reporting_values (
  payment_id,
  teacher_id,
  payment_date,
  source_amount_minor,
  source_currency,
  fx_source,
  fx_rate,
  fx_rate_date,
  amount_uah_minor,
  status,
  resolved_at
)
select
  p.id,
  p.teacher_id,
  (
    p.paid_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv')
  )::date,
  p.amount_minor,
  p.currency,
  case
    when p.currency = 'UAH'::public.finance_currency then 'native_uah'
    when a.status = 'ready'::public.payment_tax_accrual_status then coalesce(a.fx_source, 'NBU')
    else 'NBU'
  end,
  case
    when p.currency = 'UAH'::public.finance_currency then 1::numeric
    when a.status = 'ready'::public.payment_tax_accrual_status then a.fx_rate
    else null
  end,
  case
    when p.currency = 'UAH'::public.finance_currency then (
      p.paid_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv')
    )::date
    when a.status = 'ready'::public.payment_tax_accrual_status then a.fx_rate_date
    else null
  end,
  case
    when p.currency = 'UAH'::public.finance_currency then p.amount_minor
    when a.status = 'ready'::public.payment_tax_accrual_status then a.tax_base_uah_minor
    else null
  end,
  case
    when p.currency = 'UAH'::public.finance_currency then 'ready'
    when a.status = 'ready'::public.payment_tax_accrual_status then 'ready'
    else 'fx_pending'
  end,
  case
    when p.currency = 'UAH'::public.finance_currency then now()
    when a.status = 'ready'::public.payment_tax_accrual_status then coalesce(a.resolved_at, now())
    else null
  end
from public.payments p
left join public.teacher_settings ts
  on ts.teacher_id = p.teacher_id
left join public.payment_tax_accruals a
  on a.payment_id = p.id
where p.status = 'succeeded'::public.payment_status
  and p.paid_at is not null
on conflict (payment_id) do nothing;

-- ---------------------------------------------------------------------------
-- Rebuild Finance receipts read model with management profitability fields.
-- ---------------------------------------------------------------------------

drop view if exists public.teacher_finance_receipts;

create view public.teacher_finance_receipts
with (security_invoker = true)
as
with base as (
  select
    p.teacher_id,
    p.id as payment_id,
    p.student_id,
    s.full_name as student_name,
    s.email as student_email,
    p.payment_account_id,
    a.name as account_name,
    a.owner_type,
    a.account_type,
    p.amount_minor,
    p.currency,
    p.payment_method,
    p.provider,
    p.paid_at,
    r.payment_date,
    date_trunc('month', r.payment_date::timestamp)::date as payment_month,
    p.description,
    r.amount_uah_minor as reporting_uah_minor,
    r.status as reporting_status,
    case
      when ta.status = 'ready'::public.payment_tax_accrual_status
        then coalesce(ta.total_income_taxes_minor, 0)::bigint
      else 0::bigint
    end as direct_tax_uah_minor
  from public.payments p
  join public.payment_reporting_values r
    on r.payment_id = p.id
   and r.teacher_id = p.teacher_id
  left join public.payment_accounts a
    on a.id = p.payment_account_id
   and a.teacher_id = p.teacher_id
  join public.profiles s
    on s.id = p.student_id
  left join public.payment_tax_accruals ta
    on ta.payment_id = p.id
   and ta.teacher_id = p.teacher_id
  where p.status = 'succeeded'::public.payment_status
    and p.paid_at is not null
),
monthly_receipts as (
  select
    b.teacher_id,
    b.payment_month,
    sum(coalesce(b.reporting_uah_minor, 0))::bigint as known_receipts_uah_minor,
    count(*) filter (where b.reporting_status <> 'ready')::integer as pending_reporting_fx_count,
    sum(b.direct_tax_uah_minor)::bigint as direct_tax_uah_minor
  from base b
  group by b.teacher_id, b.payment_month
),
monthly_tax as (
  select
    t.teacher_id,
    t.month_start as payment_month,
    t.total_tax_minor
  from public.teacher_monthly_tax_summary t
),
resolved as (
  select
    b.*,
    mr.known_receipts_uah_minor,
    mr.pending_reporting_fx_count,
    greatest(
      coalesce(mt.total_tax_minor, 0)::bigint - coalesce(mr.direct_tax_uah_minor, 0)::bigint,
      0::bigint
    ) as fixed_tax_pool_uah_minor
  from base b
  join monthly_receipts mr
    on mr.teacher_id = b.teacher_id
   and mr.payment_month = b.payment_month
  left join monthly_tax mt
    on mt.teacher_id = b.teacher_id
   and mt.payment_month = b.payment_month
)
select
  r.teacher_id,
  r.payment_id,
  r.student_id,
  r.student_name,
  r.student_email,
  r.payment_account_id,
  r.account_name,
  r.owner_type,
  r.account_type,
  r.amount_minor,
  r.currency,
  r.payment_method,
  r.provider,
  r.paid_at,
  r.payment_date,
  r.payment_month,
  r.description,
  r.reporting_uah_minor,
  r.direct_tax_uah_minor,
  case
    when r.reporting_status <> 'ready'
      or r.pending_reporting_fx_count > 0
      or r.reporting_uah_minor is null
      or r.known_receipts_uah_minor <= 0
      then null
    else round(
      r.fixed_tax_pool_uah_minor::numeric
      * r.reporting_uah_minor::numeric
      / r.known_receipts_uah_minor::numeric
    )::bigint
  end as allocated_fixed_tax_uah_minor,
  case
    when r.reporting_status <> 'ready'
      or r.pending_reporting_fx_count > 0
      or r.reporting_uah_minor is null
      or r.known_receipts_uah_minor <= 0
      then null
    else (
      r.reporting_uah_minor
      - r.direct_tax_uah_minor
      - round(
          r.fixed_tax_pool_uah_minor::numeric
          * r.reporting_uah_minor::numeric
          / r.known_receipts_uah_minor::numeric
        )::bigint
    )
  end as net_income_uah_minor,
  case
    when r.reporting_status <> 'ready' or r.pending_reporting_fx_count > 0
      then 'fx_pending'
    else 'ready'
  end as profitability_status
from resolved r;

comment on view public.teacher_finance_receipts is
  'Successful teacher receipts with student/account context, stable UAH reporting value, direct payment taxes, proportional allocation of monthly fixed taxes, and management net income.';

revoke all on table public.teacher_finance_receipts from anon, authenticated;
grant select on table public.teacher_finance_receipts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Student finance health: debt and low-balance attention read model.
-- Debt is the derived ledger balance in the student billing currency.
-- Unpaid lesson count uses active (not reversed) lesson_charge rows and FIFO
-- settlement logic: current debt is attributed to the newest unpaid charges.
-- Low-balance coverage uses actual upcoming scheduled lesson price snapshots;
-- when no priced upcoming lesson exists, it falls back to the current rate.
-- ---------------------------------------------------------------------------

create or replace view public.teacher_student_finance_health
with (security_invoker = true)
as
with relationships as (
  select
    ts.teacher_id,
    ts.student_id,
    p.full_name as student_name,
    p.email as student_email,
    bs.billing_currency
  from public.teacher_students ts
  join public.profiles p
    on p.id = ts.student_id
  left join public.student_billing_settings bs
    on bs.teacher_id = ts.teacher_id
   and bs.student_id = ts.student_id
  where ts.is_active = true
),
active_rate as (
  select distinct on (r.teacher_id, r.student_id)
    r.teacher_id,
    r.student_id,
    r.amount_minor,
    r.currency
  from public.student_lesson_rates r
  where r.effective_from <= public.get_teacher_local_date(r.teacher_id)
    and (
      r.effective_to is null
      or public.get_teacher_local_date(r.teacher_id) < r.effective_to
    )
  order by r.teacher_id, r.student_id, r.effective_from desc
),
balance_base as (
  select
    rel.*,
    coalesce(b.balance_minor, 0)::bigint as balance_minor,
    greatest(-coalesce(b.balance_minor, 0), 0)::bigint as debt_minor
  from relationships rel
  left join public.student_finance_balances b
    on b.teacher_id = rel.teacher_id
   and b.student_id = rel.student_id
   and b.currency = rel.billing_currency
),
active_lesson_charges as (
  select
    t.teacher_id,
    t.student_id,
    t.currency,
    t.id,
    abs(t.amount_minor)::bigint as charge_minor,
    t.effective_at,
    t.created_at
  from public.student_finance_transactions t
  where t.transaction_type = 'lesson_charge'::public.finance_transaction_type
    and not exists (
      select 1
      from public.student_finance_transactions rev
      where rev.transaction_type = 'reversal'::public.finance_transaction_type
        and rev.reversal_of_id = t.id
    )
),
ranked_lesson_charges as (
  select
    c.*,
    sum(c.charge_minor) over (
      partition by c.teacher_id, c.student_id, c.currency
      order by c.effective_at desc, c.created_at desc, c.id desc
      rows between unbounded preceding and current row
    )::bigint as cumulative_charge_minor
  from active_lesson_charges c
),
unpaid_lessons as (
  select
    b.teacher_id,
    b.student_id,
    count(c.id) filter (
      where b.debt_minor > 0
        and (c.cumulative_charge_minor - c.charge_minor) < b.debt_minor
    )::integer as unpaid_lesson_count
  from balance_base b
  left join ranked_lesson_charges c
    on c.teacher_id = b.teacher_id
   and c.student_id = b.student_id
   and c.currency = b.billing_currency
  group by b.teacher_id, b.student_id
),
upcoming_priced as (
  select
    l.teacher_id,
    l.student_id,
    l.price_currency as currency,
    l.id,
    l.starts_at,
    l.price_amount_minor,
    sum(l.price_amount_minor) over (
      partition by l.teacher_id, l.student_id, l.price_currency
      order by l.starts_at asc, l.id asc
      rows between unbounded preceding and current row
    )::bigint as cumulative_price_minor
  from public.lessons l
  where l.status = 'scheduled'::public.lesson_status
    and l.starts_at >= now()
    and l.price_amount_minor is not null
    and l.price_currency is not null
),
coverage as (
  select
    b.teacher_id,
    b.student_id,
    count(u.id) filter (
      where b.balance_minor > 0
        and u.cumulative_price_minor <= b.balance_minor
    )::integer as covered_scheduled_lessons,
    count(u.id)::integer as priced_upcoming_lessons
  from balance_base b
  left join upcoming_priced u
    on u.teacher_id = b.teacher_id
   and u.student_id = b.student_id
   and u.currency = b.billing_currency
  group by b.teacher_id, b.student_id
)
select
  b.teacher_id,
  b.student_id,
  b.student_name,
  b.student_email,
  b.billing_currency,
  b.balance_minor,
  b.debt_minor,
  coalesce(u.unpaid_lesson_count, 0)::integer as unpaid_lesson_count,
  ar.amount_minor as current_rate_minor,
  ar.currency as current_rate_currency,
  coalesce(c.covered_scheduled_lessons, 0)::integer as covered_scheduled_lessons,
  coalesce(c.priced_upcoming_lessons, 0)::integer as priced_upcoming_lessons,
  case
    when b.balance_minor <= 0 then 0
    when coalesce(c.priced_upcoming_lessons, 0) > 0
      then coalesce(c.covered_scheduled_lessons, 0)
    when ar.amount_minor is not null
      and ar.amount_minor > 0
      and ar.currency = b.billing_currency
      then floor(b.balance_minor::numeric / ar.amount_minor::numeric)::integer
    else null
  end as remaining_lesson_count
from balance_base b
left join unpaid_lessons u
  on u.teacher_id = b.teacher_id
 and u.student_id = b.student_id
left join active_rate ar
  on ar.teacher_id = b.teacher_id
 and ar.student_id = b.student_id
left join coverage c
  on c.teacher_id = b.teacher_id
 and c.student_id = b.student_id;

comment on view public.teacher_student_finance_health is
  'Teacher finance attention read model: billing-currency balance/debt, unpaid lesson count, and low-balance lesson coverage.';

revoke all on table public.teacher_student_finance_health from anon, authenticated;
grant select on table public.teacher_student_finance_health to authenticated, service_role;

commit;
