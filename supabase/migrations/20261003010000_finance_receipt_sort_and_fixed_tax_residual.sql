-- Keep Finance receipt rows deterministically sortable by actual operation time
-- and make proportional monthly fixed-tax allocation exact after rounding.
--
-- Business rule for the rounding residual:
--   1. Calculate every payment's proportional fixed-tax share and round to cents.
--   2. Compare the rounded monthly sum with the authoritative monthly fixed-tax pool.
--   3. Apply the whole residual to the student with the largest UAH receipt base
--      for that month. Inside that student, apply it to the largest payment
--      (created_at/payment_id are deterministic tie-breakers).
--
-- This keeps SUM(allocated_fixed_tax_uah_minor) exactly equal to the monthly
-- fixed-tax pool while changing only a few cents at most.

create or replace view public.teacher_finance_receipts
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
    end as direct_tax_uah_minor,
    p.created_at
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
),
initial_allocations as (
  select
    r.*,
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
    end as initial_allocated_fixed_tax_uah_minor
  from resolved r
),
student_bases as (
  select
    i.teacher_id,
    i.payment_month,
    i.student_id,
    sum(i.reporting_uah_minor)::bigint as student_receipts_uah_minor
  from initial_allocations i
  where i.initial_allocated_fixed_tax_uah_minor is not null
  group by i.teacher_id, i.payment_month, i.student_id
),
ranked_students as (
  select
    s.*,
    row_number() over (
      partition by s.teacher_id, s.payment_month
      order by s.student_receipts_uah_minor desc, s.student_id::text asc
    ) as student_rank
  from student_bases s
),
ranked_adjustment_payments as (
  select
    i.teacher_id,
    i.payment_month,
    i.payment_id,
    row_number() over (
      partition by i.teacher_id, i.payment_month
      order by i.reporting_uah_minor desc, i.created_at desc, i.payment_id::text desc
    ) as payment_rank
  from initial_allocations i
  join ranked_students s
    on s.teacher_id = i.teacher_id
   and s.payment_month = i.payment_month
   and s.student_id = i.student_id
   and s.student_rank = 1
  where i.initial_allocated_fixed_tax_uah_minor is not null
),
allocation_totals as (
  select
    i.teacher_id,
    i.payment_month,
    max(i.fixed_tax_pool_uah_minor)::bigint as fixed_tax_pool_uah_minor,
    sum(i.initial_allocated_fixed_tax_uah_minor)::bigint as rounded_allocation_total_uah_minor
  from initial_allocations i
  where i.initial_allocated_fixed_tax_uah_minor is not null
  group by i.teacher_id, i.payment_month
),
final_allocations as (
  select
    i.*,
    case
      when i.initial_allocated_fixed_tax_uah_minor is null then null
      when ap.payment_rank = 1 then
        i.initial_allocated_fixed_tax_uah_minor
        + (
          at.fixed_tax_pool_uah_minor
          - at.rounded_allocation_total_uah_minor
        )
      else i.initial_allocated_fixed_tax_uah_minor
    end as allocated_fixed_tax_uah_minor
  from initial_allocations i
  left join allocation_totals at
    on at.teacher_id = i.teacher_id
   and at.payment_month = i.payment_month
  left join ranked_adjustment_payments ap
    on ap.teacher_id = i.teacher_id
   and ap.payment_month = i.payment_month
   and ap.payment_id = i.payment_id
)
select
  f.teacher_id,
  f.payment_id,
  f.student_id,
  f.student_name,
  f.student_email,
  f.payment_account_id,
  f.account_name,
  f.owner_type,
  f.account_type,
  f.amount_minor,
  f.currency,
  f.payment_method,
  f.provider,
  f.paid_at,
  f.payment_date,
  f.payment_month,
  f.description,
  f.reporting_uah_minor,
  f.direct_tax_uah_minor,
  f.allocated_fixed_tax_uah_minor,
  case
    when f.allocated_fixed_tax_uah_minor is null then null
    else (
      f.reporting_uah_minor
      - f.direct_tax_uah_minor
      - f.allocated_fixed_tax_uah_minor
    )
  end as net_income_uah_minor,
  case
    when f.reporting_status <> 'ready' or f.pending_reporting_fx_count > 0
      then 'fx_pending'
    else 'ready'
  end as profitability_status,
  f.created_at
from final_allocations f;

comment on view public.teacher_finance_receipts is
  'Successful teacher receipts with student/account context, stable UAH reporting value, direct payment taxes, exact proportional allocation of monthly fixed taxes with deterministic rounding residual adjustment, management net income, and payment creation timestamp for stable sorting.';

revoke all on table public.teacher_finance_receipts from anon, authenticated;
grant select on table public.teacher_finance_receipts to authenticated, service_role;
