-- Teacher-specific taxation profiles + immutable lesson price snapshots.
--
-- Goals:
-- 1) Tax calculations are opt-in per teacher. Non-PE teachers have no tax model.
-- 2) PE group/rates are teacher settings, not global assumptions. VAT profiles are intentionally unsupported.
-- 3) PE groups 1/2/3 use versioned Ukrainian reference constants.
-- 4) A lesson keeps the price assigned to its original pricing date when moved.
-- 5) A future tariff change reprices already-scheduled lessons whose pricing date
--    is on/after the tariff effective date.

begin;

-- ---------------------------------------------------------------------------
-- Teacher-specific tax profile
-- ---------------------------------------------------------------------------

create type public.teacher_taxpayer_type as enum (
  'none',
  'pe'
);

create type public.tax_calculation_basis as enum (
  'none',
  'income_percent',
  'minimum_wage_percent',
  'living_wage_percent'
);

create table public.teacher_tax_profiles (
  id uuid not null default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  taxpayer_type public.teacher_taxpayer_type not null default 'none',
  pe_group smallint,
  single_tax_basis public.tax_calculation_basis not null default 'none',
  single_tax_rate numeric(12,8),

  military_levy_basis public.tax_calculation_basis not null default 'none',
  military_levy_rate numeric(12,8),

  esv_basis public.tax_calculation_basis not null default 'none',
  esv_rate numeric(12,8),

  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint teacher_tax_profiles_pkey primary key (id),
  constraint teacher_tax_profiles_period_valid check (
    effective_to is null or effective_to > effective_from
  ),
  constraint teacher_tax_profiles_pe_group_valid check (
    (taxpayer_type = 'none'::public.teacher_taxpayer_type and pe_group is null)
    or
    (taxpayer_type = 'pe'::public.teacher_taxpayer_type and pe_group between 1 and 3)
  ),
  constraint teacher_tax_profiles_group_tax_model_valid check (
    taxpayer_type = 'none'::public.teacher_taxpayer_type
    or (
      pe_group = 1
      and single_tax_basis = 'living_wage_percent'::public.tax_calculation_basis
      and single_tax_rate <= 0.10
      and military_levy_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and military_levy_rate = 0.10
      and esv_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and esv_rate = 0.22
    )
    or (
      pe_group = 2
      and single_tax_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and single_tax_rate <= 0.20
      and military_levy_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and military_levy_rate = 0.10
      and esv_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and esv_rate = 0.22
    )
    or (
      pe_group = 3
      and single_tax_basis = 'income_percent'::public.tax_calculation_basis
      and single_tax_rate = 0.05
      and military_levy_basis = 'income_percent'::public.tax_calculation_basis
      and military_levy_rate = 0.01
      and esv_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and esv_rate = 0.22
    )
  ),
  constraint teacher_tax_profiles_rates_valid check (
    (
      taxpayer_type = 'none'::public.teacher_taxpayer_type
      and single_tax_basis = 'none'::public.tax_calculation_basis
      and single_tax_rate is null
      and military_levy_basis = 'none'::public.tax_calculation_basis
      and military_levy_rate is null
      and esv_basis = 'none'::public.tax_calculation_basis
      and esv_rate is null
    )
    or
    (
      taxpayer_type = 'pe'::public.teacher_taxpayer_type
      and single_tax_basis <> 'none'::public.tax_calculation_basis
      and single_tax_rate > 0 and single_tax_rate <= 1
      and military_levy_basis <> 'none'::public.tax_calculation_basis
      and military_levy_rate > 0 and military_levy_rate <= 1
      and esv_basis <> 'none'::public.tax_calculation_basis
      and esv_rate > 0 and esv_rate <= 1
    )
  )
);

alter table public.teacher_tax_profiles enable row level security;

alter table public.teacher_tax_profiles
  add constraint teacher_tax_profiles_no_overlap
  exclude using gist (
    teacher_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index teacher_tax_profiles_lookup_idx
  on public.teacher_tax_profiles (teacher_id, effective_from desc);

comment on table public.teacher_tax_profiles is
  'Versioned teacher-specific taxation settings. taxpayer_type=none means the application performs no tax calculation.';

create policy "Teacher can view own tax profiles"
on public.teacher_tax_profiles
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

revoke all on table public.teacher_tax_profiles from anon, authenticated;
grant select on table public.teacher_tax_profiles to authenticated;
grant all on table public.teacher_tax_profiles to service_role;

-- Add the reference base needed by PE group 1. Existing minimum_wage_minor is
-- retained as the reference base for groups 2/3 and ESV.
alter table public.tax_parameters
  drop constraint if exists tax_parameters_code_allowed;

alter table public.tax_parameters
  add constraint tax_parameters_code_allowed check (
    code in (
      'single_tax_rate',
      'military_levy_rate',
      'esv_rate',
      'minimum_wage_minor',
      'living_wage_minor'
    )
  );

alter table public.tax_parameters
  drop constraint if exists tax_parameters_unit_matches_code;

alter table public.tax_parameters
  add constraint tax_parameters_unit_matches_code check (
    (code in ('minimum_wage_minor', 'living_wage_minor') and unit = 'uah_minor')
    or
    (code not in ('minimum_wage_minor', 'living_wage_minor') and unit = 'ratio')
  );

insert into public.tax_parameters (
  code,
  value_numeric,
  unit,
  effective_from,
  effective_to,
  source_note
)
select
  'living_wage_minor',
  332800,
  'uah_minor',
  '2026-01-01'::date,
  '2027-01-01'::date,
  'Living wage for able-bodied persons: 3,328.00 UAH'
where not exists (
  select 1
  from public.tax_parameters p
  where p.code = 'living_wage_minor'
    and p.effective_from = '2026-01-01'::date
);

-- Preserve the behaviour of the previous Step 5 for teachers who already
-- created PE accounts: Step 5 represented PE group 3 without VAT,
-- 5% single tax + 1% military levy + 22% ESV.
insert into public.teacher_tax_profiles (
  teacher_id,
  taxpayer_type,
  pe_group,
  single_tax_basis,
  single_tax_rate,
  military_levy_basis,
  military_levy_rate,
  esv_basis,
  esv_rate,
  effective_from
)
select distinct
  a.teacher_id,
  'pe'::public.teacher_taxpayer_type,
  3,
  'income_percent'::public.tax_calculation_basis,
  0.05,
  'income_percent'::public.tax_calculation_basis,
  0.01,
  'minimum_wage_percent'::public.tax_calculation_basis,
  0.22,
  '2026-01-01'::date
from public.payment_accounts a
where a.owner_type = 'pe'::public.payment_account_owner_type
  and not exists (
    select 1
    from public.teacher_tax_profiles p
    where p.teacher_id = a.teacher_id
  );

create or replace view public.teacher_current_tax_profile
with (security_invoker = true)
as
select distinct on (p.teacher_id)
  p.id,
  p.teacher_id,
  p.taxpayer_type,
  p.pe_group,
  p.single_tax_basis,
  p.single_tax_rate,
  p.military_levy_basis,
  p.military_levy_rate,
  p.esv_basis,
  p.esv_rate,
  p.effective_from,
  p.effective_to,
  p.created_at,
  p.updated_at
from public.teacher_tax_profiles p
where p.effective_from <= current_date
  and (p.effective_to is null or current_date < p.effective_to)
order by p.teacher_id, p.effective_from desc;

revoke all on table public.teacher_current_tax_profile from anon, authenticated;
grant select on table public.teacher_current_tax_profile to authenticated, service_role;

create or replace function public.set_my_tax_profile(
  p_taxpayer_type public.teacher_taxpayer_type,
  p_pe_group smallint default null,
  p_single_tax_rate numeric default null,
  p_military_levy_rate numeric default null,
  p_esv_rate numeric default null,
  p_effective_from date default current_date
)
returns public.teacher_tax_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_next_from date;
  v_existing_id uuid;
  v_single_basis public.tax_calculation_basis;
  v_military_basis public.tax_calculation_basis;
  v_esv_basis public.tax_calculation_basis;
  v_result public.teacher_tax_profiles%rowtype;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_effective_from is null then
    raise exception 'TAX_PROFILE_DATE_REQUIRED';
  end if;

  if p_taxpayer_type = 'none'::public.teacher_taxpayer_type then
    p_pe_group := null;
    p_single_tax_rate := null;
    p_military_levy_rate := null;
    p_esv_rate := null;
    v_single_basis := 'none'::public.tax_calculation_basis;
    v_military_basis := 'none'::public.tax_calculation_basis;
    v_esv_basis := 'none'::public.tax_calculation_basis;
  else
    if p_pe_group is null or p_pe_group not between 1 and 3 then
      raise exception 'INVALID_PE_GROUP';
    end if;

    if p_pe_group = 1 then
      if p_single_tax_rate is null or p_single_tax_rate <= 0 or p_single_tax_rate > 0.10 then
        raise exception 'INVALID_GROUP_1_SINGLE_TAX_RATE';
      end if;

      v_single_basis := 'living_wage_percent'::public.tax_calculation_basis;
      p_military_levy_rate := 0.10;
      p_esv_rate := 0.22;
      v_military_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_esv_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
    elsif p_pe_group = 2 then
      if p_single_tax_rate is null or p_single_tax_rate <= 0 or p_single_tax_rate > 0.20 then
        raise exception 'INVALID_GROUP_2_SINGLE_TAX_RATE';
      end if;

      v_single_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      p_military_levy_rate := 0.10;
      p_esv_rate := 0.22;
      v_military_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_esv_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
    else
      -- Group 3 is intentionally supported only without VAT in this product.
      p_single_tax_rate := 0.05;
      p_military_levy_rate := 0.01;
      p_esv_rate := 0.22;
      v_single_basis := 'income_percent'::public.tax_calculation_basis;
      v_military_basis := 'income_percent'::public.tax_calculation_basis;
      v_esv_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
    end if;
  end if;

  perform p.id
  from public.teacher_tax_profiles p
  where p.teacher_id = v_teacher_id
  order by p.effective_from
  for update;

  select p.id
  into v_existing_id
  from public.teacher_tax_profiles p
  where p.teacher_id = v_teacher_id
    and p.effective_from = p_effective_from
  limit 1;

  if v_existing_id is not null then
    update public.teacher_tax_profiles
    set
      taxpayer_type = p_taxpayer_type,
      pe_group = p_pe_group,
      single_tax_basis = v_single_basis,
      single_tax_rate = p_single_tax_rate,
      military_levy_basis = v_military_basis,
      military_levy_rate = p_military_levy_rate,
      esv_basis = v_esv_basis,
      esv_rate = p_esv_rate,
      updated_at = now()
    where id = v_existing_id
    returning * into v_result;
  else
    select min(p.effective_from)
    into v_next_from
    from public.teacher_tax_profiles p
    where p.teacher_id = v_teacher_id
      and p.effective_from > p_effective_from;

    update public.teacher_tax_profiles p
    set
      effective_to = p_effective_from,
      updated_at = now()
    where p.teacher_id = v_teacher_id
      and p.effective_from < p_effective_from
      and (p.effective_to is null or p.effective_to > p_effective_from);

    insert into public.teacher_tax_profiles (
      teacher_id,
      taxpayer_type,
      pe_group,
      single_tax_basis,
      single_tax_rate,
      military_levy_basis,
      military_levy_rate,
      esv_basis,
      esv_rate,
      effective_from,
      effective_to
    )
    values (
      v_teacher_id,
      p_taxpayer_type,
      p_pe_group,
      v_single_basis,
      p_single_tax_rate,
      v_military_basis,
      p_military_levy_rate,
      v_esv_basis,
      p_esv_rate,
      p_effective_from,
      v_next_from
    )
    returning * into v_result;
  end if;

  return v_result;
end;
$function$;

revoke execute on function public.set_my_tax_profile(
  public.teacher_taxpayer_type,
  smallint,
  numeric,
  numeric,
  numeric,
  date
) from public, anon;

grant execute on function public.set_my_tax_profile(
  public.teacher_taxpayer_type,
  smallint,
  numeric,
  numeric,
  numeric,
  date
) to authenticated, service_role;

-- Payment-account classification follows the teacher's current tax profile.
-- A non-PE teacher can create only a personal card or cash account. A PE
-- account is available only while a PE profile is active.
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

  if p_owner_type = 'personal'::public.payment_account_owner_type
     and p_account_type not in (
       'card'::public.payment_account_type,
       'cash'::public.payment_account_type
     ) then
    raise exception 'PERSONAL_ACCOUNT_TYPE_NOT_ALLOWED';
  end if;

  if p_owner_type = 'pe'::public.payment_account_owner_type
     and not exists (
       select 1
       from public.teacher_tax_profiles p
       where p.teacher_id = v_teacher_id
         and p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
         and p.effective_from <= current_date
         and (p.effective_to is null or current_date < p.effective_to)
     ) then
    raise exception 'PE_TAX_PROFILE_REQUIRED_FOR_ACCOUNT';
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

  if p_owner_type = 'personal'::public.payment_account_owner_type
     and p_account_type not in (
       'card'::public.payment_account_type,
       'cash'::public.payment_account_type
     ) then
    raise exception 'PERSONAL_ACCOUNT_TYPE_NOT_ALLOWED';
  end if;

  if p_owner_type = 'pe'::public.payment_account_owner_type
     and not exists (
       select 1
       from public.teacher_tax_profiles p
       where p.teacher_id = v_teacher_id
         and p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
         and p.effective_from <= current_date
         and (p.effective_to is null or current_date < p.effective_to)
     ) then
    raise exception 'PE_TAX_PROFILE_REQUIRED_FOR_ACCOUNT';
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

-- Normalise legacy personal bank-account rows created before the distinction
-- was introduced. Personal receiving accounts in this product are card/cash.
update public.payment_accounts
set account_type = 'card'::public.payment_account_type,
    updated_at = now()
where owner_type = 'personal'::public.payment_account_owner_type
  and account_type = 'bank_account'::public.payment_account_type
  and not exists (
    select 1
    from public.payments p
    where p.payment_account_id = payment_accounts.id
  );

-- ---------------------------------------------------------------------------
-- Generalize PE payment tax accruals to the active teacher tax profile.
-- ---------------------------------------------------------------------------

alter table public.payment_tax_accruals
  add column tax_profile_id uuid references public.teacher_tax_profiles(id) on delete restrict,
  add column pe_group smallint,
  add column single_tax_basis public.tax_calculation_basis,
  add column military_levy_basis public.tax_calculation_basis;

update public.payment_tax_accruals a
set
  tax_profile_id = p.id,
  pe_group = p.pe_group,
  single_tax_basis = p.single_tax_basis,
  military_levy_basis = p.military_levy_basis
from public.teacher_tax_profiles p
where p.teacher_id = a.teacher_id
  and p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
  and p.effective_from <= a.income_date
  and (p.effective_to is null or a.income_date < p.effective_to);

alter table public.payment_tax_accruals
  drop constraint if exists payment_tax_accruals_rates_positive,
  drop constraint if exists payment_tax_accruals_active_rates_present,
  drop constraint if exists payment_tax_accruals_ready_shape;

alter table public.payment_tax_accruals
  add constraint payment_tax_accruals_rates_nonnegative check (
    (single_tax_rate is null or single_tax_rate >= 0)
    and (military_levy_rate is null or military_levy_rate >= 0)
  ),
  add constraint payment_tax_accruals_ready_shape check (
    status <> 'ready'::public.payment_tax_accrual_status
    or (
      tax_base_uah_minor is not null
      and tax_base_uah_minor > 0
      and single_tax_minor is not null
      and single_tax_minor >= 0
      and military_levy_minor is not null
      and military_levy_minor >= 0
      and total_income_taxes_minor is not null
      and total_income_taxes_minor >= 0
      and resolved_at is not null
    )
  );

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
  v_profile public.teacher_tax_profiles%rowtype;
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

  select p.*
  into v_profile
  from public.teacher_tax_profiles p
  where p.teacher_id = v_payment.teacher_id
    and p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
    and p.effective_from <= v_income_date
    and (p.effective_to is null or v_income_date < p.effective_to)
  order by p.effective_from desc
  limit 1;

  -- A PE-classified account without an active PE tax profile is intentionally
  -- not calculated. record_manual_student_payment() rejects this situation for
  -- new manual payments; this guard keeps retries/imports safe.
  if not found then
    return null;
  end if;

  if v_payment.currency = 'UAH'::public.finance_currency then
    v_tax_base := v_payment.amount_minor;
    v_single_tax := case
      when v_profile.single_tax_basis = 'income_percent'::public.tax_calculation_basis
        then round(v_tax_base * v_profile.single_tax_rate)::bigint
      else 0
    end;
    v_military := case
      when v_profile.military_levy_basis = 'income_percent'::public.tax_calculation_basis
        then round(v_tax_base * v_profile.military_levy_rate)::bigint
      else 0
    end;

    insert into public.payment_tax_accruals (
      teacher_id,
      payment_id,
      tax_profile_id,
      pe_group,
      income_date,
      source_amount_minor,
      source_currency,
      fx_source,
      fx_rate,
      fx_rate_date,
      tax_base_uah_minor,
      single_tax_basis,
      single_tax_rate,
      military_levy_basis,
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
      v_profile.id,
      v_profile.pe_group,
      v_income_date,
      v_payment.amount_minor,
      v_payment.currency,
      'native_uah',
      1,
      v_income_date,
      v_tax_base,
      v_profile.single_tax_basis,
      v_profile.single_tax_rate,
      v_profile.military_levy_basis,
      v_profile.military_levy_rate,
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
      tax_profile_id,
      pe_group,
      income_date,
      source_amount_minor,
      source_currency,
      fx_source,
      single_tax_basis,
      single_tax_rate,
      military_levy_basis,
      military_levy_rate,
      status
    )
    values (
      v_payment.teacher_id,
      v_payment.id,
      v_profile.id,
      v_profile.pe_group,
      v_income_date,
      v_payment.amount_minor,
      v_payment.currency,
      'NBU',
      v_profile.single_tax_basis,
      v_profile.single_tax_rate,
      v_profile.military_levy_basis,
      v_profile.military_levy_rate,
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

  v_tax_base := round(v_accrual.source_amount_minor * p_fx_rate)::bigint;
  v_single_tax := case
    when v_accrual.single_tax_basis = 'income_percent'::public.tax_calculation_basis
      then round(v_tax_base * coalesce(v_accrual.single_tax_rate, 0))::bigint
    else 0
  end;
  v_military := case
    when v_accrual.military_levy_basis = 'income_percent'::public.tax_calculation_basis
      then round(v_tax_base * coalesce(v_accrual.military_levy_rate, 0))::bigint
    else 0
  end;

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

-- Manual PE payments require a matching PE tax profile for the actual income
-- date. Personal-card/cash payments do not require any tax profile.
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
  v_owner_type public.payment_account_owner_type;
  v_income_date date;
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

  if v_owner_type = 'pe'::public.payment_account_owner_type then
    v_income_date := (p_paid_at at time zone 'Europe/Kyiv')::date;

    if not exists (
      select 1
      from public.teacher_tax_profiles p
      where p.teacher_id = v_teacher_id
        and p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
        and p.effective_from <= v_income_date
        and (p.effective_to is null or v_income_date < p.effective_to)
    ) then
      raise exception 'PE_TAX_PROFILE_REQUIRED_FOR_PAYMENT';
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

-- Monthly tax summary follows each teacher's own PE profile.
-- Group 1: monthly single tax = configured % of living wage; military levy = configured % of minimum wage; ESV = configured % of minimum wage.
-- Group 2: monthly single tax = configured % of minimum wage; military levy = configured % of minimum wage; ESV = configured % of minimum wage.
-- Group 3 (non-VAT only): single tax and military levy are income-based; ESV remains a monthly minimum-wage-based obligation.
drop view if exists public.teacher_monthly_tax_summary;

create view public.teacher_monthly_tax_summary
with (security_invoker = true)
as
with profile_months_raw as (
  select
    p.*,
    gs::date as month_start
  from public.teacher_tax_profiles p
  cross join lateral generate_series(
    date_trunc('month', p.effective_from::timestamp),
    date_trunc(
      'month',
      least(
        coalesce(p.effective_to - 1, current_date),
        current_date
      )::timestamp
    ),
    interval '1 month'
  ) gs
  where p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
    and p.effective_from <= current_date
),
profile_months as (
  select distinct on (teacher_id, month_start)
    *
  from profile_months_raw
  order by teacher_id, month_start, effective_from desc
),
income as (
  select
    a.teacher_id,
    date_trunc('month', a.income_date::timestamp)::date as month_start,
    sum(coalesce(a.tax_base_uah_minor, 0))::bigint as income_base_uah_minor,
    sum(coalesce(a.single_tax_minor, 0))::bigint as income_single_tax_minor,
    sum(coalesce(a.military_levy_minor, 0))::bigint as income_military_levy_minor,
    count(*) filter (
      where a.status = 'fx_pending'::public.payment_tax_accrual_status
    )::integer as pending_fx_count
  from public.payment_tax_accruals a
  group by a.teacher_id, date_trunc('month', a.income_date::timestamp)::date
),
computed as (
  select
    pm.teacher_id,
    pm.month_start,
    coalesce(i.income_base_uah_minor, 0)::bigint as income_base_uah_minor,
    coalesce(i.pending_fx_count, 0)::integer as pending_fx_count,
    case pm.single_tax_basis
      when 'income_percent'::public.tax_calculation_basis
        then coalesce(i.income_single_tax_minor, 0)::bigint
      when 'minimum_wage_percent'::public.tax_calculation_basis
        then round(min_wage.value_numeric * pm.single_tax_rate)::bigint
      when 'living_wage_percent'::public.tax_calculation_basis
        then round(living_wage.value_numeric * pm.single_tax_rate)::bigint
      else 0::bigint
    end as single_tax_minor,
    case pm.military_levy_basis
      when 'income_percent'::public.tax_calculation_basis
        then coalesce(i.income_military_levy_minor, 0)::bigint
      when 'minimum_wage_percent'::public.tax_calculation_basis
        then round(min_wage.value_numeric * pm.military_levy_rate)::bigint
      when 'living_wage_percent'::public.tax_calculation_basis
        then round(living_wage.value_numeric * pm.military_levy_rate)::bigint
      else 0::bigint
    end as military_levy_minor,
    case pm.esv_basis
      when 'minimum_wage_percent'::public.tax_calculation_basis
        then round(min_wage.value_numeric * pm.esv_rate)::bigint
      when 'living_wage_percent'::public.tax_calculation_basis
        then round(living_wage.value_numeric * pm.esv_rate)::bigint
      when 'income_percent'::public.tax_calculation_basis
        then round(coalesce(i.income_base_uah_minor, 0) * pm.esv_rate)::bigint
      else 0::bigint
    end as esv_minor
  from profile_months pm
  left join income i
    on i.teacher_id = pm.teacher_id
   and i.month_start = pm.month_start
  join lateral (
    select p.value_numeric
    from public.tax_parameters p
    where p.code = 'minimum_wage_minor'
      and p.effective_from <= pm.month_start
      and (p.effective_to is null or pm.month_start < p.effective_to)
    order by p.effective_from desc
    limit 1
  ) min_wage on true
  join lateral (
    select p.value_numeric
    from public.tax_parameters p
    where p.code = 'living_wage_minor'
      and p.effective_from <= pm.month_start
      and (p.effective_to is null or pm.month_start < p.effective_to)
    order by p.effective_from desc
    limit 1
  ) living_wage on true
)
select
  c.teacher_id,
  c.month_start,
  c.income_base_uah_minor,
  c.single_tax_minor,
  c.military_levy_minor,
  c.esv_minor,
  (c.single_tax_minor + c.military_levy_minor + c.esv_minor)::bigint as total_tax_minor,
  c.pending_fx_count
from computed c;

comment on view public.teacher_monthly_tax_summary is
  'Teacher-specific monthly PE tax summary. No rows are produced for non-PE tax profiles.';

revoke all on table public.teacher_monthly_tax_summary from anon, authenticated;
grant select on table public.teacher_monthly_tax_summary to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lesson price snapshots
-- ---------------------------------------------------------------------------

alter table public.lessons
  add column pricing_date date,
  add column price_amount_minor bigint,
  add column price_currency public.finance_currency,
  add column price_rate_id uuid references public.student_lesson_rates(id) on delete restrict;

comment on column public.lessons.pricing_date is
  'Date used to determine the lesson tariff. It is set when the lesson is created and is preserved when the lesson is rescheduled.';
comment on column public.lessons.price_amount_minor is
  'Snapshot of the lesson price in minor units. Future tariff changes may refresh scheduled lessons by pricing_date, but rescheduling does not change it.';
comment on column public.lessons.price_currency is
  'Currency snapshot paired with price_amount_minor.';
comment on column public.lessons.price_rate_id is
  'Versioned student_lesson_rates row used to price the lesson.';

-- Backfill pricing_date using each teacher's schedule timezone.
update public.lessons l
set pricing_date = (l.starts_at at time zone ts.schedule_timezone)::date
from public.teacher_settings ts
where ts.teacher_id = l.teacher_id
  and l.pricing_date is null;

-- Fallback for any legacy lesson whose teacher settings are unexpectedly absent.
update public.lessons l
set pricing_date = (l.starts_at at time zone 'Europe/Kyiv')::date
where l.pricing_date is null;

-- Backfill the rate snapshot that was applicable on the original lesson date.
with priced as (
  select
    l.id as lesson_id,
    r.id as rate_id,
    r.amount_minor,
    r.currency
  from public.lessons l
  join lateral (
    select r.*
    from public.student_lesson_rates r
    where r.teacher_id = l.teacher_id
      and r.student_id = l.student_id
      and r.effective_from <= l.pricing_date
      and (r.effective_to is null or l.pricing_date < r.effective_to)
    order by r.effective_from desc
    limit 1
  ) r on true
)
update public.lessons l
set
  price_rate_id = p.rate_id,
  price_amount_minor = p.amount_minor,
  price_currency = p.currency
from priced p
where l.id = p.lesson_id;

alter table public.lessons
  alter column pricing_date set not null;

alter table public.lessons
  add constraint lessons_price_snapshot_shape check (
    (
      price_amount_minor is null
      and price_currency is null
      and price_rate_id is null
    )
    or
    (
      price_amount_minor is not null
      and price_amount_minor > 0
      and price_currency is not null
      and price_rate_id is not null
    )
  );

create index lessons_teacher_student_pricing_date_idx
  on public.lessons (teacher_id, student_id, pricing_date, status);

create or replace function public.assign_lesson_price_snapshot_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_timezone text;
  v_rate public.student_lesson_rates%rowtype;
begin
  if new.pricing_date is null then
    select ts.schedule_timezone
    into v_timezone
    from public.teacher_settings ts
    where ts.teacher_id = new.teacher_id;

    new.pricing_date := (
      new.starts_at at time zone coalesce(v_timezone, 'Europe/Kyiv')
    )::date;
  end if;

  if new.price_amount_minor is null
     and new.price_currency is null
     and new.price_rate_id is null then
    select r.*
    into v_rate
    from public.student_lesson_rates r
    where r.teacher_id = new.teacher_id
      and r.student_id = new.student_id
      and r.effective_from <= new.pricing_date
      and (r.effective_to is null or new.pricing_date < r.effective_to)
    order by r.effective_from desc
    limit 1;

    if found then
      new.price_rate_id := v_rate.id;
      new.price_amount_minor := v_rate.amount_minor;
      new.price_currency := v_rate.currency;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.assign_lesson_price_snapshot_on_insert()
  from public, anon, authenticated;
grant execute on function public.assign_lesson_price_snapshot_on_insert()
  to service_role;

create trigger lessons_assign_price_snapshot_before_insert
before insert on public.lessons
for each row
execute function public.assign_lesson_price_snapshot_on_insert();

-- If the same lesson row is moved to another date/time, preserve its original
-- pricing date and price snapshot. This is the core "29.09 moved to 02.10 keeps
-- the 29.09 price" invariant.
create or replace function public.preserve_lesson_price_on_reschedule()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.starts_at is distinct from old.starts_at then
    new.pricing_date := old.pricing_date;
    new.price_rate_id := old.price_rate_id;
    new.price_amount_minor := old.price_amount_minor;
    new.price_currency := old.price_currency;
  end if;

  return new;
end;
$function$;

create trigger lessons_preserve_price_on_reschedule_before_update
before update on public.lessons
for each row
execute function public.preserve_lesson_price_on_reschedule();

create or replace function public.refresh_scheduled_lesson_prices(
  p_teacher_id uuid,
  p_student_id uuid,
  p_from_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer := 0;
begin
  with priced as (
    select
      l.id as lesson_id,
      r.id as rate_id,
      r.amount_minor,
      r.currency
    from public.lessons l
    join lateral (
      select r.*
      from public.student_lesson_rates r
      where r.teacher_id = l.teacher_id
        and r.student_id = l.student_id
        and r.effective_from <= l.pricing_date
        and (r.effective_to is null or l.pricing_date < r.effective_to)
      order by r.effective_from desc
      limit 1
    ) r on true
    where l.teacher_id = p_teacher_id
      and l.student_id = p_student_id
      and l.status = 'scheduled'::public.lesson_status
      and l.pricing_date >= p_from_date
  )
  update public.lessons l
  set
    price_rate_id = p.rate_id,
    price_amount_minor = p.amount_minor,
    price_currency = p.currency,
    updated_at = now()
  from priced p
  where l.id = p.lesson_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.refresh_scheduled_lesson_prices(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.refresh_scheduled_lesson_prices(uuid, uuid, date)
  to service_role;

-- Replace rate-setting RPC so a tariff scheduled for a date also updates all
-- already-created scheduled lessons priced on/after that date. A lesson moved
-- from an earlier pricing_date is not touched.
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
  v_existing_amount bigint;
  v_existing_currency public.finance_currency;
  v_previous_amount bigint;
  v_previous_currency public.finance_currency;
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

  perform r.id
  from public.student_lesson_rates r
  where r.teacher_id = v_teacher_id
    and r.student_id = p_student_id
  order by r.effective_from
  for update;

  select
    r.id,
    r.amount_minor,
    r.currency
  into
    v_existing_id,
    v_existing_amount,
    v_existing_currency
  from public.student_lesson_rates r
  where r.teacher_id = v_teacher_id
    and r.student_id = p_student_id
    and r.effective_from = p_effective_from
  limit 1;

  if v_existing_id is not null then
    if v_existing_amount = p_amount_minor
       and v_existing_currency = p_currency then
      raise exception 'LESSON_RATE_UNCHANGED';
    end if;

    v_previous_amount := v_existing_amount;
    v_previous_currency := v_existing_currency;

    update public.student_lesson_rates
    set
      amount_minor = p_amount_minor,
      currency = p_currency,
      updated_at = now()
    where id = v_existing_id
    returning * into v_result;
  else
    select
      r.amount_minor,
      r.currency
    into
      v_previous_amount,
      v_previous_currency
    from public.student_lesson_rates r
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.effective_from < p_effective_from
      and (r.effective_to is null or r.effective_to > p_effective_from)
    order by r.effective_from desc
    limit 1;

    if v_previous_amount = p_amount_minor
       and v_previous_currency = p_currency then
      raise exception 'LESSON_RATE_UNCHANGED';
    end if;

    select min(r.effective_from)
    into v_next_from
    from public.student_lesson_rates r
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.effective_from > p_effective_from;

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

  perform public.refresh_scheduled_lesson_prices(
    v_teacher_id,
    p_student_id,
    p_effective_from
  );

  insert into public.notifications (
    user_id,
    type,
    title_key,
    body_key,
    data
  )
  values (
    p_student_id,
    'lesson_rate_changed'::public.notification_type,
    'notifications.lessonRateChanged.title',
    'notifications.lessonRateChanged.body',
    jsonb_strip_nulls(
      jsonb_build_object(
        'rateId', v_result.id,
        'oldAmountMinor', v_previous_amount,
        'oldCurrency', v_previous_currency,
        'newAmountMinor', p_amount_minor,
        'newCurrency', p_currency,
        'effectiveFrom', p_effective_from,
        'changedBy', v_teacher_id
      )
    )
  );

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

commit;
