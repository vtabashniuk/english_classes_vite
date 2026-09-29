-- Payment account classification + PE tax core
-- Adds Personal/PE ownership, card accounts, versioned tax constants,
-- per-payment PE tax accruals and a monthly PE tax summary.

begin;

-- ---------------------------------------------------------------------------
-- Payment account classification
-- ---------------------------------------------------------------------------

alter type public.payment_account_type add value if not exists 'card';

create type public.payment_account_owner_type as enum (
  'personal',
  'pe'
);

alter table public.payment_accounts
  add column owner_type public.payment_account_owner_type not null default 'personal';

comment on column public.payment_accounts.owner_type is
  'Classifies the receiving account as personal or PE (Private Entrepreneur) for tax calculations.';

create index payment_accounts_teacher_owner_idx
  on public.payment_accounts (teacher_id, owner_type, currency, is_active);

-- Replace account-creation RPC with an owner-aware version. Existing callers
-- remain compatible because p_owner_type has a default.
drop function if exists public.create_payment_account(
  text,
  text,
  public.payment_account_type,
  public.finance_currency,
  text
);

create or replace function public.create_payment_account(
  p_name text,
  p_provider text,
  p_account_type public.payment_account_type,
  p_currency public.finance_currency,
  p_external_ref text default null,
  p_owner_type public.payment_account_owner_type default 'personal'::public.payment_account_owner_type
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

  if p_account_type = 'cash'::public.payment_account_type and v_provider <> 'manual' then
    raise exception 'CASH_ACCOUNT_REQUIRES_MANUAL_PROVIDER';
  end if;

  if p_account_type <> 'cash'::public.payment_account_type and v_provider = 'manual' then
    raise exception 'NON_CASH_ACCOUNT_REQUIRES_BANK_PROVIDER';
  end if;

  insert into public.payment_accounts (
    teacher_id,
    name,
    provider,
    account_type,
    currency,
    external_ref,
    owner_type
  )
  values (
    v_teacher_id,
    v_name,
    v_provider,
    p_account_type,
    p_currency,
    v_external_ref,
    p_owner_type
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
  text,
  public.payment_account_owner_type
) from public, anon;

grant execute on function public.create_payment_account(
  text,
  text,
  public.payment_account_type,
  public.finance_currency,
  text,
  public.payment_account_owner_type
) to authenticated, service_role;

-- Classification can be corrected while the account is unused. Historical
-- payments lock classification so past tax treatment cannot silently change.
create or replace function public.update_payment_account_classification(
  p_account_id uuid,
  p_owner_type public.payment_account_owner_type,
  p_account_type public.payment_account_type
)
returns public.payment_accounts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_provider text;
  v_result public.payment_accounts%rowtype;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if exists (
    select 1
    from public.payments p
    where p.teacher_id = v_teacher_id
      and p.payment_account_id = p_account_id
  ) then
    raise exception 'PAYMENT_ACCOUNT_CLASSIFICATION_LOCKED';
  end if;

  select a.provider
  into v_provider
  from public.payment_accounts a
  where a.id = p_account_id
    and a.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'PAYMENT_ACCOUNT_NOT_FOUND';
  end if;

  if p_account_type = 'cash'::public.payment_account_type and v_provider <> 'manual' then
    raise exception 'CASH_ACCOUNT_REQUIRES_MANUAL_PROVIDER';
  end if;

  if p_account_type <> 'cash'::public.payment_account_type and v_provider = 'manual' then
    raise exception 'NON_CASH_ACCOUNT_REQUIRES_BANK_PROVIDER';
  end if;

  update public.payment_accounts
  set
    owner_type = p_owner_type,
    account_type = p_account_type,
    updated_at = now()
  where id = p_account_id
    and teacher_id = v_teacher_id
  returning * into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.update_payment_account_classification(
  uuid,
  public.payment_account_owner_type,
  public.payment_account_type
) from public, anon;

grant execute on function public.update_payment_account_classification(
  uuid,
  public.payment_account_owner_type,
  public.payment_account_type
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Versioned tax constants
-- Values are deliberately data, not hard-coded inside calculation functions.
-- ratio = decimal ratio (0.05 = 5%); uah_minor = kopiykas.
-- ---------------------------------------------------------------------------

create table public.tax_parameters (
  id uuid not null default gen_random_uuid(),
  code text not null,
  value_numeric numeric(20,8) not null,
  unit text not null,
  effective_from date not null,
  effective_to date,
  source_note text,
  created_at timestamptz not null default now(),

  constraint tax_parameters_pkey primary key (id),
  constraint tax_parameters_code_allowed check (
    code in (
      'single_tax_rate',
      'military_levy_rate',
      'esv_rate',
      'minimum_wage_minor'
    )
  ),
  constraint tax_parameters_unit_allowed check (unit in ('ratio', 'uah_minor')),
  constraint tax_parameters_positive_value check (value_numeric > 0),
  constraint tax_parameters_valid_period check (
    effective_to is null or effective_to > effective_from
  ),
  constraint tax_parameters_unit_matches_code check (
    (code = 'minimum_wage_minor' and unit = 'uah_minor')
    or
    (code <> 'minimum_wage_minor' and unit = 'ratio')
  )
);

alter table public.tax_parameters enable row level security;

alter table public.tax_parameters
  add constraint tax_parameters_no_overlap
  exclude using gist (
    code with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index tax_parameters_lookup_idx
  on public.tax_parameters (code, effective_from desc);

comment on table public.tax_parameters is
  'Versioned PE tax constants. Historical tax calculations keep snapshots of the rates used.';

insert into public.tax_parameters (
  code,
  value_numeric,
  unit,
  effective_from,
  effective_to,
  source_note
)
values
  ('single_tax_rate', 0.05, 'ratio', '2026-01-01', '2027-01-01', 'PE group 3, no VAT: single tax 5% of income'),
  ('military_levy_rate', 0.01, 'ratio', '2026-01-01', '2027-01-01', 'PE group 3: military levy 1% of income'),
  ('esv_rate', 0.22, 'ratio', '2026-01-01', '2027-01-01', 'ESV rate 22%'),
  ('minimum_wage_minor', 864700, 'uah_minor', '2026-01-01', '2027-01-01', 'Minimum monthly wage: 8,647.00 UAH');

-- ---------------------------------------------------------------------------
-- PE income tax accruals per successful payment
-- ---------------------------------------------------------------------------

create type public.payment_tax_accrual_status as enum (
  'ready',
  'fx_pending',
  'error'
);

create table public.payment_tax_accruals (
  id uuid not null default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  income_date date not null,
  source_amount_minor bigint not null,
  source_currency public.finance_currency not null,
  fx_source text,
  fx_rate numeric(20,8),
  fx_rate_date date,
  tax_base_uah_minor bigint,
  single_tax_rate numeric(12,8),
  military_levy_rate numeric(12,8),
  single_tax_minor bigint,
  military_levy_minor bigint,
  total_income_taxes_minor bigint,
  status public.payment_tax_accrual_status not null,
  calculation_error text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,

  constraint payment_tax_accruals_pkey primary key (id),
  constraint payment_tax_accruals_payment_key unique (payment_id),
  constraint payment_tax_accruals_source_amount_positive check (source_amount_minor > 0),
  constraint payment_tax_accruals_rates_positive check (
    (single_tax_rate is null and military_levy_rate is null)
    or (single_tax_rate > 0 and military_levy_rate > 0)
  ),
  constraint payment_tax_accruals_active_rates_present check (
    status = 'error'::public.payment_tax_accrual_status
    or (single_tax_rate is not null and military_levy_rate is not null)
  ),
  constraint payment_tax_accruals_ready_shape check (
    status <> 'ready'::public.payment_tax_accrual_status
    or (
      tax_base_uah_minor is not null
      and tax_base_uah_minor > 0
      and single_tax_minor is not null
      and military_levy_minor is not null
      and total_income_taxes_minor is not null
      and resolved_at is not null
    )
  ),
  constraint payment_tax_accruals_fx_shape check (
    source_currency = 'UAH'::public.finance_currency
    or status <> 'ready'::public.payment_tax_accrual_status
    or (
      fx_source is not null
      and fx_rate is not null
      and fx_rate > 0
      and fx_rate_date is not null
    )
  )
);

alter table public.payment_tax_accruals enable row level security;

create index payment_tax_accruals_teacher_income_date_idx
  on public.payment_tax_accruals (teacher_id, income_date desc);

create index payment_tax_accruals_pending_idx
  on public.payment_tax_accruals (teacher_id, status, income_date)
  where status = 'fx_pending'::public.payment_tax_accrual_status;

comment on table public.payment_tax_accruals is
  'Reference PE tax accruals for successful payments received on PE-classified accounts. Foreign-currency income is converted to UAH using a stored NBU rate snapshot.';

-- ---------------------------------------------------------------------------
-- Internal tax helpers
-- ---------------------------------------------------------------------------

create or replace function public.get_tax_parameter_value(
  p_code text,
  p_date date
)
returns numeric
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  v_value numeric;
begin
  select p.value_numeric
  into v_value
  from public.tax_parameters p
  where p.code = p_code
    and p.effective_from <= p_date
    and (p.effective_to is null or p_date < p.effective_to)
  order by p.effective_from desc
  limit 1;

  if v_value is null then
    raise exception 'TAX_PARAMETER_MISSING:%:%', p_code, p_date;
  end if;

  return v_value;
end;
$function$;

revoke all on function public.get_tax_parameter_value(text, date)
  from public, anon, authenticated;
grant execute on function public.get_tax_parameter_value(text, date)
  to service_role;

create or replace function public.create_payment_tax_accrual_if_needed(
  p_payment_id uuid
)
returns public.payment_tax_accruals
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_owner_type public.payment_account_owner_type;
  v_income_date date;
  v_single_tax_rate numeric;
  v_military_rate numeric;
  v_tax_base bigint;
  v_single_tax bigint;
  v_military bigint;
  v_result public.payment_tax_accruals%rowtype;
begin
  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status <> 'succeeded'::public.payment_status then
    return null;
  end if;

  select a.owner_type
  into v_owner_type
  from public.payment_accounts a
  where a.id = v_payment.payment_account_id
    and a.teacher_id = v_payment.teacher_id;

  if not found or v_owner_type <> 'pe'::public.payment_account_owner_type then
    return null;
  end if;

  if exists (
    select 1
    from public.payment_tax_accruals a
    where a.payment_id = p_payment_id
  ) then
    select *
    into v_result
    from public.payment_tax_accruals a
    where a.payment_id = p_payment_id;

    return v_result;
  end if;

  v_income_date := (v_payment.paid_at at time zone 'Europe/Kyiv')::date;

  select p.value_numeric
  into v_single_tax_rate
  from public.tax_parameters p
  where p.code = 'single_tax_rate'
    and p.effective_from <= v_income_date
    and (p.effective_to is null or v_income_date < p.effective_to)
  order by p.effective_from desc
  limit 1;

  select p.value_numeric
  into v_military_rate
  from public.tax_parameters p
  where p.code = 'military_levy_rate'
    and p.effective_from <= v_income_date
    and (p.effective_to is null or v_income_date < p.effective_to)
  order by p.effective_from desc
  limit 1;

  if v_single_tax_rate is null or v_military_rate is null then
    insert into public.payment_tax_accruals (
      teacher_id,
      payment_id,
      income_date,
      source_amount_minor,
      source_currency,
      fx_source,
      status,
      calculation_error
    )
    values (
      v_payment.teacher_id,
      v_payment.id,
      v_income_date,
      v_payment.amount_minor,
      v_payment.currency,
      case when v_payment.currency = 'UAH'::public.finance_currency then 'native_uah' else 'NBU' end,
      'error'::public.payment_tax_accrual_status,
      'TAX_PARAMETER_MISSING'
    )
    returning * into v_result;

    return v_result;
  end if;

  if v_payment.currency = 'UAH'::public.finance_currency then
    v_tax_base := v_payment.amount_minor;
    v_single_tax := round(v_tax_base * v_single_tax_rate)::bigint;
    v_military := round(v_tax_base * v_military_rate)::bigint;

    insert into public.payment_tax_accruals (
      teacher_id,
      payment_id,
      income_date,
      source_amount_minor,
      source_currency,
      fx_source,
      fx_rate,
      fx_rate_date,
      tax_base_uah_minor,
      single_tax_rate,
      military_levy_rate,
      single_tax_minor,
      military_levy_minor,
      total_income_taxes_minor,
      status,
      resolved_at
    )
    values (
      v_payment.teacher_id,
      v_payment.id,
      v_income_date,
      v_payment.amount_minor,
      v_payment.currency,
      'native_uah',
      1,
      v_income_date,
      v_tax_base,
      v_single_tax_rate,
      v_military_rate,
      v_single_tax,
      v_military,
      v_single_tax + v_military,
      'ready'::public.payment_tax_accrual_status,
      now()
    )
    returning * into v_result;
  else
    insert into public.payment_tax_accruals (
      teacher_id,
      payment_id,
      income_date,
      source_amount_minor,
      source_currency,
      fx_source,
      single_tax_rate,
      military_levy_rate,
      status
    )
    values (
      v_payment.teacher_id,
      v_payment.id,
      v_income_date,
      v_payment.amount_minor,
      v_payment.currency,
      'NBU',
      v_single_tax_rate,
      v_military_rate,
      'fx_pending'::public.payment_tax_accrual_status
    )
    returning * into v_result;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.create_payment_tax_accrual_if_needed(uuid)
  from public, anon, authenticated;
grant execute on function public.create_payment_tax_accrual_if_needed(uuid)
  to service_role;

-- Called only by the NBU-rate Edge Function using service_role.
create or replace function public.finalize_payment_tax_accrual(
  p_payment_id uuid,
  p_fx_rate numeric,
  p_fx_rate_date date
)
returns public.payment_tax_accruals
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_accrual public.payment_tax_accruals%rowtype;
  v_tax_base bigint;
  v_single_tax bigint;
  v_military bigint;
  v_result public.payment_tax_accruals%rowtype;
begin
  if p_fx_rate is null or p_fx_rate <= 0 then
    raise exception 'INVALID_FX_RATE';
  end if;

  select *
  into v_accrual
  from public.payment_tax_accruals a
  where a.payment_id = p_payment_id
  for update;

  if not found then
    raise exception 'TAX_ACCRUAL_NOT_FOUND';
  end if;

  if v_accrual.status = 'ready'::public.payment_tax_accrual_status then
    return v_accrual;
  end if;

  if v_accrual.source_currency = 'UAH'::public.finance_currency then
    raise exception 'FX_RATE_NOT_REQUIRED';
  end if;

  -- Source and UAH both use two decimal minor units, so multiplying source
  -- minor units by UAH-per-unit rate directly yields UAH minor units.
  v_tax_base := round(v_accrual.source_amount_minor * p_fx_rate)::bigint;
  v_single_tax := round(v_tax_base * v_accrual.single_tax_rate)::bigint;
  v_military := round(v_tax_base * v_accrual.military_levy_rate)::bigint;

  update public.payment_tax_accruals
  set
    fx_source = 'NBU',
    fx_rate = p_fx_rate,
    fx_rate_date = p_fx_rate_date,
    tax_base_uah_minor = v_tax_base,
    single_tax_minor = v_single_tax,
    military_levy_minor = v_military,
    total_income_taxes_minor = v_single_tax + v_military,
    status = 'ready'::public.payment_tax_accrual_status,
    calculation_error = null,
    resolved_at = now()
  where payment_id = p_payment_id
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.finalize_payment_tax_accrual(uuid, numeric, date)
  from public, anon, authenticated;
grant execute on function public.finalize_payment_tax_accrual(uuid, numeric, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- Upgrade manual payment RPC: create PE tax accrual atomically with payment.
-- Foreign currency creates fx_pending; NBU Edge Function resolves it.
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

      perform public.create_payment_tax_accrual_if_needed(v_existing_payment_id);

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

  perform public.create_payment_tax_accrual_if_needed(v_payment_id);

  return query
  select v_payment_id, v_transaction_id;
end;
$function$;

-- Existing grants remain valid after CREATE OR REPLACE, but keep them explicit.
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
-- Monthly read model. It intentionally aggregates only months with PE income;
-- a future global Finance/Tax dashboard can add empty months if desired.
-- ---------------------------------------------------------------------------

create view public.teacher_monthly_tax_summary
with (security_invoker = true)
as
with monthly as (
  select
    a.teacher_id,
    date_trunc('month', a.income_date::timestamp)::date as month_start,
    sum(coalesce(a.tax_base_uah_minor, 0))::bigint as income_base_uah_minor,
    sum(coalesce(a.single_tax_minor, 0))::bigint as single_tax_minor,
    sum(coalesce(a.military_levy_minor, 0))::bigint as military_levy_minor,
    count(*) filter (where a.status = 'fx_pending'::public.payment_tax_accrual_status)::integer as pending_fx_count
  from public.payment_tax_accruals a
  group by a.teacher_id, date_trunc('month', a.income_date::timestamp)::date
)
select
  m.teacher_id,
  m.month_start,
  m.income_base_uah_minor,
  m.single_tax_minor,
  m.military_levy_minor,
  round(min_wage.value_numeric * esv_rate.value_numeric)::bigint as esv_minor,
  (
    m.single_tax_minor
    + m.military_levy_minor
    + round(min_wage.value_numeric * esv_rate.value_numeric)::bigint
  )::bigint as total_tax_minor,
  m.pending_fx_count
from monthly m
join lateral (
  select p.value_numeric
  from public.tax_parameters p
  where p.code = 'minimum_wage_minor'
    and p.effective_from <= m.month_start
    and (p.effective_to is null or m.month_start < p.effective_to)
  order by p.effective_from desc
  limit 1
) min_wage on true
join lateral (
  select p.value_numeric
  from public.tax_parameters p
  where p.code = 'esv_rate'
    and p.effective_from <= m.month_start
    and (p.effective_to is null or m.month_start < p.effective_to)
  order by p.effective_from desc
  limit 1
) esv_rate on true;

comment on view public.teacher_monthly_tax_summary is
  'Reference monthly PE tax summary: 5% single tax + 1% military levy on resolved PE income, plus minimum ESV based on versioned constants.';

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------

create policy "Teacher can view tax parameters"
on public.tax_parameters
for select
to authenticated
using (public.is_teacher());

create policy "Teacher can view own payment tax accruals"
on public.payment_tax_accruals
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

revoke all on table public.tax_parameters from anon, authenticated;
revoke all on table public.payment_tax_accruals from anon, authenticated;
revoke all on table public.teacher_monthly_tax_summary from anon, authenticated;

grant select on table public.tax_parameters to authenticated;
grant select on table public.payment_tax_accruals to authenticated;
grant select on table public.teacher_monthly_tax_summary to authenticated;

grant all on table public.tax_parameters to service_role;
grant all on table public.payment_tax_accruals to service_role;
grant select on table public.teacher_monthly_tax_summary to service_role;

commit;
