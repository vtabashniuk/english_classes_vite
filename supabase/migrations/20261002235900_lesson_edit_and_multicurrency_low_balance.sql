begin;

-- ---------------------------------------------------------------------------
-- 1. One-off lesson rescheduling/editing.
-- ---------------------------------------------------------------------------

create or replace function public.update_lesson_schedule(
  p_lesson_id uuid,
  p_lesson_date date,
  p_start_time time without time zone,
  p_zoom_url text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_lesson public.lessons%rowtype;
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_slot_interval integer;
  v_duration integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select l.*
  into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_lesson.status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;

  if v_lesson.starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_EDITED';
  end if;

  if v_lesson.recurring_lesson_id is not null then
    raise exception 'RECURRING_LESSON_REQUIRES_SERIES_EDIT';
  end if;

  if exists (
    select 1
    from public.lesson_cancellation_requests r
    where r.lesson_id = p_lesson_id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_PENDING';
  end if;

  select
    ts.schedule_timezone,
    ts.workday_start,
    ts.workday_end,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_workday_start,
    v_workday_end,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  if extract(isodow from p_lesson_date) not between 1 and 5 then
    raise exception 'WEEKEND_NOT_ALLOWED';
  end if;

  v_duration := v_lesson.duration_minutes;

  v_minutes_from_midnight :=
    extract(hour from p_start_time)::integer * 60
    + extract(minute from p_start_time)::integer;

  v_workday_start_minutes :=
    extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if (
    mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0
    or extract(second from p_start_time) <> 0
  ) then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  if p_start_time < v_workday_start then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  if p_start_time + make_interval(mins => v_duration) > v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_starts_at :=
    (p_lesson_date::timestamp + p_start_time)
    at time zone v_timezone;

  v_ends_at := v_starts_at + make_interval(mins => v_duration);

  if v_starts_at <= now() then
    raise exception 'LESSON_IN_PAST';
  end if;

  if exists (
    select 1
    from public.lessons l
    where l.id <> p_lesson_id
      and l.status <> 'cancelled'::public.lesson_status
      and (
        l.teacher_id = v_teacher_id
        or l.student_id = v_lesson.student_id
      )
      and l.starts_at < v_ends_at
      and l.ends_at > v_starts_at
  ) then
    raise exception 'LESSON_TIME_CONFLICT';
  end if;

  update public.lessons
  set
    starts_at = v_starts_at,
    ends_at = v_ends_at,
    zoom_url = nullif(btrim(p_zoom_url), ''),
    updated_at = now()
  where id = p_lesson_id;

  -- Existing pricing_date / price snapshot is intentionally preserved.
exception
  when exclusion_violation then
    raise exception 'LESSON_TIME_CONFLICT';
end;
$function$;

revoke all on function public.update_lesson_schedule(
  uuid,
  date,
  time without time zone,
  text
) from public, anon;

grant execute on function public.update_lesson_schedule(
  uuid,
  date,
  time without time zone,
  text
) to authenticated, service_role;

comment on function public.update_lesson_schedule(
  uuid,
  date,
  time without time zone,
  text
) is
'Edits a future one-off scheduled lesson while preserving its original lesson price snapshot.';

-- ---------------------------------------------------------------------------
-- 2. NBU exchange-rate cache used only for low-balance coverage estimates.
--    Ledger balances remain multi-currency and are never converted/mutated.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_nbu_exchange_rates (
  currency public.finance_currency not null,
  rate_date date not null,
  rate_uah_per_unit numeric(20,8) not null,
  source text not null default 'NBU',
  fetched_at timestamptz not null default now(),
  primary key (currency, rate_date),
  constraint finance_nbu_exchange_rates_currency_check
    check (currency in ('USD'::public.finance_currency, 'EUR'::public.finance_currency)),
  constraint finance_nbu_exchange_rates_rate_positive
    check (rate_uah_per_unit > 0)
);

comment on table public.finance_nbu_exchange_rates is
  'Cached official NBU UAH-per-unit exchange rates used for management-only low-balance coverage estimates.';

alter table public.finance_nbu_exchange_rates enable row level security;

drop policy if exists "Authenticated can read finance NBU exchange rates"
  on public.finance_nbu_exchange_rates;

create policy "Authenticated can read finance NBU exchange rates"
on public.finance_nbu_exchange_rates
for select
to authenticated
using (true);

revoke all on table public.finance_nbu_exchange_rates from anon, authenticated;
grant select on table public.finance_nbu_exchange_rates to authenticated, service_role;
grant insert, update on table public.finance_nbu_exchange_rates to service_role;

-- Seed the cache from already resolved payment/reporting FX snapshots so the
-- dashboard still has a fallback if the NBU endpoint is temporarily offline.
insert into public.finance_nbu_exchange_rates (
  currency,
  rate_date,
  rate_uah_per_unit,
  source,
  fetched_at
)
select
  r.source_currency,
  r.fx_rate_date,
  max(r.fx_rate)::numeric(20,8),
  'NBU',
  now()
from public.payment_reporting_values r
where r.source_currency in (
    'USD'::public.finance_currency,
    'EUR'::public.finance_currency
  )
  and r.fx_rate_date is not null
  and r.fx_rate is not null
  and r.fx_rate > 0
group by r.source_currency, r.fx_rate_date
on conflict (currency, rate_date)
do update set
  rate_uah_per_unit = excluded.rate_uah_per_unit,
  source = excluded.source,
  fetched_at = excluded.fetched_at;

-- Raw official rate. The newest available rate on or before the teacher-local
-- date is used, which also gives a safe fallback across weekends/holidays.
create or replace function public.finance_nbu_rate(
  p_currency public.finance_currency,
  p_on_date date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_currency = 'UAH'::public.finance_currency then 1::numeric
    else (
      select r.rate_uah_per_unit
      from public.finance_nbu_exchange_rates r
      where r.currency = p_currency
        and r.rate_date <= p_on_date
        and r.rate_date >= (p_on_date - 7)
      order by r.rate_date desc
      limit 1
    )
  end;
$function$;

-- For an available foreign-currency asset, use a conservative internal
-- "sell" estimate: NBU - 1%, rounded DOWN to whole UAH per currency unit.
create or replace function public.finance_coverage_sell_rate_uah(
  p_currency public.finance_currency,
  p_on_date date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_currency = 'UAH'::public.finance_currency then 1::numeric
    when public.finance_nbu_rate(p_currency, p_on_date) is null then null
    else greatest(
      floor(public.finance_nbu_rate(p_currency, p_on_date) * 0.99),
      1
    )::numeric
  end;
$function$;

-- When the target/cost currency has to be bought, use NBU + 1%, rounded UP
-- to whole UAH per currency unit. This prevents overstating lesson coverage.
create or replace function public.finance_coverage_buy_rate_uah(
  p_currency public.finance_currency,
  p_on_date date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_currency = 'UAH'::public.finance_currency then 1::numeric
    when public.finance_nbu_rate(p_currency, p_on_date) is null then null
    else greatest(
      ceil(public.finance_nbu_rate(p_currency, p_on_date) * 1.01),
      1
    )::numeric
  end;
$function$;

-- Convert a positive balance (an asset) to the current tariff currency.
-- foreign -> UAH uses the conservative sell rate;
-- UAH -> foreign uses the conservative buy rate;
-- foreign -> foreign crosses through UAH using both conservative sides.
create or replace function public.finance_coverage_convert_asset_minor(
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
  v_source_sell numeric;
  v_target_buy numeric;
begin
  if p_amount_minor is null then
    return null;
  end if;

  if p_amount_minor <= 0 then
    return 0;
  end if;

  if p_from_currency = p_to_currency then
    return p_amount_minor;
  end if;

  v_source_sell := public.finance_coverage_sell_rate_uah(
    p_from_currency,
    p_on_date
  );
  v_target_buy := public.finance_coverage_buy_rate_uah(
    p_to_currency,
    p_on_date
  );

  if v_source_sell is null or v_target_buy is null or v_target_buy <= 0 then
    return null;
  end if;

  return floor(
    p_amount_minor::numeric * v_source_sell / v_target_buy
  )::bigint;
end;
$function$;

-- Convert a scheduled lesson price (a cost) to the current tariff currency.
-- The conservative sides are intentionally reversed versus an asset so the
-- estimated cost is never understated.
create or replace function public.finance_coverage_convert_cost_minor(
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
  v_source_buy numeric;
  v_target_sell numeric;
begin
  if p_amount_minor is null then
    return null;
  end if;

  if p_amount_minor <= 0 then
    return 0;
  end if;

  if p_from_currency = p_to_currency then
    return p_amount_minor;
  end if;

  v_source_buy := public.finance_coverage_buy_rate_uah(
    p_from_currency,
    p_on_date
  );
  v_target_sell := public.finance_coverage_sell_rate_uah(
    p_to_currency,
    p_on_date
  );

  if v_source_buy is null or v_target_sell is null or v_target_sell <= 0 then
    return null;
  end if;

  return ceil(
    p_amount_minor::numeric * v_source_buy / v_target_sell
  )::bigint;
end;
$function$;


-- Convert a signed student balance. Positive balances are treated as assets;
-- negative balances are treated as liabilities/costs so foreign-currency debt
-- reduces the combined coverage using the conservative opposite FX side.
create or replace function public.finance_coverage_convert_balance_minor(
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
  v_converted bigint;
begin
  if p_amount_minor is null then
    return null;
  end if;

  if p_amount_minor = 0 then
    return 0;
  end if;

  if p_amount_minor > 0 then
    return public.finance_coverage_convert_asset_minor(
      p_amount_minor,
      p_from_currency,
      p_to_currency,
      p_on_date
    );
  end if;

  v_converted := public.finance_coverage_convert_cost_minor(
    abs(p_amount_minor),
    p_from_currency,
    p_to_currency,
    p_on_date
  );

  if v_converted is null then
    return null;
  end if;

  return -v_converted;
end;
$function$;

revoke all on function public.finance_nbu_rate(public.finance_currency, date)
  from public, anon;
revoke all on function public.finance_coverage_sell_rate_uah(public.finance_currency, date)
  from public, anon;
revoke all on function public.finance_coverage_buy_rate_uah(public.finance_currency, date)
  from public, anon;
revoke all on function public.finance_coverage_convert_asset_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) from public, anon;
revoke all on function public.finance_coverage_convert_cost_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) from public, anon;

revoke all on function public.finance_coverage_convert_balance_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) from public, anon;

grant execute on function public.finance_nbu_rate(public.finance_currency, date)
  to authenticated, service_role;
grant execute on function public.finance_coverage_sell_rate_uah(public.finance_currency, date)
  to authenticated, service_role;
grant execute on function public.finance_coverage_buy_rate_uah(public.finance_currency, date)
  to authenticated, service_role;
grant execute on function public.finance_coverage_convert_asset_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) to authenticated, service_role;
grant execute on function public.finance_coverage_convert_cost_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) to authenticated, service_role;

grant execute on function public.finance_coverage_convert_balance_minor(
  bigint,
  public.finance_currency,
  public.finance_currency,
  date
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Finance-health read model.
--    Debt remains derived in the configured billing currency.
--    Low-balance coverage nets signed balances from every currency and
--    converts them to the CURRENT lesson-rate currency.
-- ---------------------------------------------------------------------------

create or replace view public.teacher_student_finance_health
with (security_invoker = true)
as
with recursive
relationships as (
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
coverage_balance_rows as (
  select
    rel.teacher_id,
    rel.student_id,
    ar.currency as coverage_currency,
    b.currency as source_currency,
    b.balance_minor as source_balance_minor,
    public.finance_coverage_convert_balance_minor(
      b.balance_minor,
      b.currency,
      ar.currency,
      public.get_teacher_local_date(rel.teacher_id)
    ) as converted_balance_minor
  from relationships rel
  join active_rate ar
    on ar.teacher_id = rel.teacher_id
   and ar.student_id = rel.student_id
  join public.student_finance_balances b
    on b.teacher_id = rel.teacher_id
   and b.student_id = rel.student_id
  where b.balance_minor <> 0
),
coverage_balances as (
  select
    r.teacher_id,
    r.student_id,
    r.coverage_currency,
    coalesce(sum(coalesce(r.converted_balance_minor, 0)), 0)::bigint
      as coverage_balance_minor,
    bool_or(r.source_currency <> r.coverage_currency) as coverage_uses_fx,
    count(*) filter (
      where r.source_currency <> r.coverage_currency
        and r.converted_balance_minor is null
    )::integer as missing_fx_balance_count
  from coverage_balance_rows r
  group by r.teacher_id, r.student_id, r.coverage_currency
),
lesson_charge_chain as (
  select
    t.id as root_charge_id,
    t.id as node_id,
    t.teacher_id,
    t.student_id,
    t.currency,
    t.effective_at as root_effective_at,
    t.created_at as root_created_at,
    abs(t.amount_minor)::bigint as root_charge_minor,
    0::integer as depth
  from public.student_finance_transactions t
  where t.transaction_type = 'lesson_charge'::public.finance_transaction_type

  union all

  select
    c.root_charge_id,
    r.id,
    c.teacher_id,
    c.student_id,
    c.currency,
    c.root_effective_at,
    c.root_created_at,
    c.root_charge_minor,
    c.depth + 1
  from lesson_charge_chain c
  join public.student_finance_transactions r
    on r.reversal_of_id = c.node_id
   and r.transaction_type = 'reversal'::public.finance_transaction_type
),
lesson_charge_heads as (
  select distinct on (c.root_charge_id)
    c.root_charge_id,
    c.teacher_id,
    c.student_id,
    c.currency,
    c.root_effective_at,
    c.root_created_at,
    c.root_charge_minor,
    c.depth
  from lesson_charge_chain c
  order by c.root_charge_id, c.depth desc
),
active_lesson_charges as (
  select
    h.teacher_id,
    h.student_id,
    h.currency,
    h.root_charge_id as id,
    h.root_charge_minor as charge_minor,
    h.root_effective_at as effective_at,
    h.root_created_at as created_at
  from lesson_charge_heads h
  where mod(h.depth, 2) = 0
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
upcoming_priced_rows as (
  select
    l.teacher_id,
    l.student_id,
    l.id,
    l.starts_at,
    l.price_currency,
    l.price_amount_minor,
    ar.currency as coverage_currency,
    public.finance_coverage_convert_cost_minor(
      l.price_amount_minor,
      l.price_currency,
      ar.currency,
      public.get_teacher_local_date(l.teacher_id)
    ) as coverage_price_minor
  from public.lessons l
  join active_rate ar
    on ar.teacher_id = l.teacher_id
   and ar.student_id = l.student_id
  where l.status = 'scheduled'::public.lesson_status
    and l.starts_at >= now()
    and l.price_amount_minor is not null
    and l.price_currency is not null
),
upcoming_priced as (
  select
    u.*,
    sum(coalesce(u.coverage_price_minor, 0)) over (
      partition by u.teacher_id, u.student_id
      order by u.starts_at asc, u.id asc
      rows between unbounded preceding and current row
    )::bigint as cumulative_price_minor,
    sum(case when u.coverage_price_minor is null then 1 else 0 end) over (
      partition by u.teacher_id, u.student_id
      order by u.starts_at asc, u.id asc
      rows between unbounded preceding and current row
    )::integer as cumulative_missing_fx
  from upcoming_priced_rows u
),
coverage as (
  select
    rel.teacher_id,
    rel.student_id,
    count(u.id) filter (
      where coalesce(cb.coverage_balance_minor, 0) > 0
        and u.cumulative_missing_fx = 0
        and u.cumulative_price_minor <= coalesce(cb.coverage_balance_minor, 0)
    )::integer as covered_scheduled_lessons,
    count(u.id)::integer as priced_upcoming_lessons,
    coalesce(sum(u.coverage_price_minor), 0)::bigint as scheduled_total_minor,
    count(u.id) filter (
      where u.coverage_price_minor is null
    )::integer as missing_fx_lesson_count
  from relationships rel
  left join coverage_balances cb
    on cb.teacher_id = rel.teacher_id
   and cb.student_id = rel.student_id
  left join upcoming_priced u
    on u.teacher_id = rel.teacher_id
   and u.student_id = rel.student_id
  group by rel.teacher_id, rel.student_id, cb.coverage_balance_minor
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
    when ar.amount_minor is null or ar.amount_minor <= 0 then null
    when (
      coalesce(cb.missing_fx_balance_count, 0) > 0
      or coalesce(c.missing_fx_lesson_count, 0) > 0
    ) then null
    when coalesce(cb.coverage_balance_minor, 0) <= 0 then 0
    when coalesce(c.priced_upcoming_lessons, 0) > 0
      and coalesce(c.covered_scheduled_lessons, 0) < coalesce(c.priced_upcoming_lessons, 0)
      then coalesce(c.covered_scheduled_lessons, 0)
    else
      coalesce(c.priced_upcoming_lessons, 0)
      + floor(
          greatest(
            coalesce(cb.coverage_balance_minor, 0)
              - coalesce(c.scheduled_total_minor, 0),
            0
          )::numeric / ar.amount_minor::numeric
        )::integer
  end as remaining_lesson_count,
  -- New columns are appended after the original view shape so CREATE OR
  -- REPLACE VIEW remains backward-compatible with existing dependencies.
  ar.currency as coverage_currency,
  coalesce(cb.coverage_balance_minor, 0)::bigint as coverage_balance_minor,
  coalesce(cb.coverage_uses_fx, false) as coverage_uses_fx,
  (
    coalesce(cb.missing_fx_balance_count, 0) > 0
    or coalesce(c.missing_fx_lesson_count, 0) > 0
  ) as coverage_fx_pending
from balance_base b
left join unpaid_lessons u
  on u.teacher_id = b.teacher_id
 and u.student_id = b.student_id
left join active_rate ar
  on ar.teacher_id = b.teacher_id
 and ar.student_id = b.student_id
left join coverage_balances cb
  on cb.teacher_id = b.teacher_id
 and cb.student_id = b.student_id
left join coverage c
  on c.teacher_id = b.teacher_id
 and c.student_id = b.student_id;

comment on view public.teacher_student_finance_health is
  'Teacher finance attention read model. Debt stays in the billing currency. Low-balance coverage nets signed balances from UAH/USD/EUR, converts them conservatively to the current tariff currency using cached NBU rates (asset: source NBU-1% / target NBU+1%), consumes scheduled lesson price snapshots first, then converts the remainder to lesson equivalents at the current tariff.';

revoke all on table public.teacher_student_finance_health from anon, authenticated;
grant select on table public.teacher_student_finance_health to authenticated, service_role;

commit;
