-- Teacher-specific, versioned tax parameters + finance dashboard read model.
--
-- This migration removes hard-coded tax values from calculation logic.
-- Platform tax_parameters remain read-only defaults; every teacher can create
-- own overrides effective today or in the future. Historical calculations
-- preserve snapshots and are never rewritten by later parameter changes.

begin;

-- ---------------------------------------------------------------------------
-- Platform defaults: extend the existing reference table with group-specific
-- codes. These values are DATA defaults, not calculation constants.
-- ---------------------------------------------------------------------------

alter table public.tax_parameters
  drop constraint if exists tax_parameters_code_allowed;

alter table public.tax_parameters
  add constraint tax_parameters_code_allowed check (
    code in (
      'single_tax_rate',
      'military_levy_rate',
      'esv_rate',
      'minimum_wage_minor',
      'living_wage_minor',
      'group1_single_tax_rate',
      'group1_military_levy_rate',
      'group2_single_tax_rate',
      'group2_military_levy_rate',
      'group3_single_tax_rate',
      'group3_military_levy_rate'
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
values
  ('group1_single_tax_rate', 0.10, 'ratio', '2026-01-01', null, 'Platform default; teacher may override'),
  ('group1_military_levy_rate', 0.10, 'ratio', '2026-01-01', null, 'Platform default; teacher may override'),
  ('group2_single_tax_rate', 0.20, 'ratio', '2026-01-01', null, 'Platform default; teacher may override'),
  ('group2_military_levy_rate', 0.10, 'ratio', '2026-01-01', null, 'Platform default; teacher may override'),
  ('group3_single_tax_rate', 0.05, 'ratio', '2026-01-01', null, 'Platform default; teacher may override'),
  ('group3_military_levy_rate', 0.01, 'ratio', '2026-01-01', null, 'Platform default; teacher may override')
on conflict do nothing;

-- Keep the current platform reference rows as a fallback until a newer platform
-- value or a teacher override is provided. Calculation logic never embeds the
-- numbers themselves.
update public.tax_parameters
set effective_to = null
where code in ('minimum_wage_minor', 'living_wage_minor', 'esv_rate')
  and effective_from = '2026-01-01'::date
  and effective_to = '2027-01-01'::date;

-- ---------------------------------------------------------------------------
-- Teacher-specific versioned overrides.
-- ---------------------------------------------------------------------------

create table public.teacher_tax_parameters (
  id uuid not null default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  value_numeric numeric(20,8) not null,
  unit text not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint teacher_tax_parameters_pkey primary key (id),
  constraint teacher_tax_parameters_code_allowed check (
    code in (
      'minimum_wage_minor',
      'living_wage_minor',
      'esv_rate',
      'group1_single_tax_rate',
      'group1_military_levy_rate',
      'group2_single_tax_rate',
      'group2_military_levy_rate',
      'group3_single_tax_rate',
      'group3_military_levy_rate'
    )
  ),
  constraint teacher_tax_parameters_unit_allowed check (unit in ('ratio', 'uah_minor')),
  constraint teacher_tax_parameters_value_positive check (value_numeric > 0),
  constraint teacher_tax_parameters_period_valid check (
    effective_to is null or effective_to > effective_from
  ),
  constraint teacher_tax_parameters_unit_matches_code check (
    (code in ('minimum_wage_minor', 'living_wage_minor') and unit = 'uah_minor')
    or
    (code not in ('minimum_wage_minor', 'living_wage_minor') and unit = 'ratio')
  ),
  constraint teacher_tax_parameters_ratio_valid check (
    unit <> 'ratio' or value_numeric <= 1
  ),
  constraint teacher_tax_parameters_money_integer check (
    unit <> 'uah_minor' or value_numeric = trunc(value_numeric)
  )
);

alter table public.teacher_tax_parameters enable row level security;

alter table public.teacher_tax_parameters
  add constraint teacher_tax_parameters_no_overlap
  exclude using gist (
    teacher_id with =,
    code with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index teacher_tax_parameters_lookup_idx
  on public.teacher_tax_parameters (teacher_id, code, effective_from desc);

create policy "Teacher can view own tax parameter overrides"
on public.teacher_tax_parameters
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

revoke all on table public.teacher_tax_parameters from anon, authenticated;
grant select on table public.teacher_tax_parameters to authenticated;
grant all on table public.teacher_tax_parameters to service_role;

comment on table public.teacher_tax_parameters is
  'Versioned per-teacher tax parameter overrides. New values may start today or in the future; historical values remain immutable.';

-- ---------------------------------------------------------------------------
-- Parameter resolver: teacher override first, platform default second.
-- ---------------------------------------------------------------------------

create or replace function public.get_effective_tax_parameter_value(
  p_teacher_id uuid,
  p_code text,
  p_on_date date
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $function$
  select r.value_numeric
  from (
    select
      tp.value_numeric,
      tp.effective_from,
      0 as priority
    from public.teacher_tax_parameters tp
    where tp.teacher_id = p_teacher_id
      and tp.code = p_code
      and tp.effective_from <= p_on_date
      and (tp.effective_to is null or p_on_date < tp.effective_to)

    union all

    select
      p.value_numeric,
      p.effective_from,
      1 as priority
    from public.tax_parameters p
    where p.code = p_code
      and p.effective_from <= p_on_date
      and (p.effective_to is null or p_on_date < p.effective_to)
  ) r
  order by r.priority, r.effective_from desc
  limit 1;
$function$;

revoke all on function public.get_effective_tax_parameter_value(uuid, text, date)
  from public, anon;
grant execute on function public.get_effective_tax_parameter_value(uuid, text, date)
  to authenticated, service_role;

create or replace function public.get_my_tax_parameters(
  p_on_date date default current_date
)
returns table (
  code text,
  value_numeric numeric,
  unit text,
  effective_from date,
  source text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_on_date is null then
    raise exception 'TAX_PARAMETER_DATE_REQUIRED';
  end if;

  return query
  with codes(code, unit) as (
    values
      ('minimum_wage_minor'::text, 'uah_minor'::text),
      ('living_wage_minor'::text, 'uah_minor'::text),
      ('esv_rate'::text, 'ratio'::text),
      ('group1_single_tax_rate'::text, 'ratio'::text),
      ('group1_military_levy_rate'::text, 'ratio'::text),
      ('group2_single_tax_rate'::text, 'ratio'::text),
      ('group2_military_levy_rate'::text, 'ratio'::text),
      ('group3_single_tax_rate'::text, 'ratio'::text),
      ('group3_military_levy_rate'::text, 'ratio'::text)
  )
  select
    c.code,
    coalesce(teacher_value.value_numeric, platform_value.value_numeric),
    c.unit,
    coalesce(teacher_value.effective_from, platform_value.effective_from),
    case when teacher_value.value_numeric is not null then 'teacher' else 'platform_default' end
  from codes c
  left join lateral (
    select tp.value_numeric, tp.effective_from
    from public.teacher_tax_parameters tp
    where tp.teacher_id = v_teacher_id
      and tp.code = c.code
      and tp.effective_from <= p_on_date
      and (tp.effective_to is null or p_on_date < tp.effective_to)
    order by tp.effective_from desc
    limit 1
  ) teacher_value on true
  left join lateral (
    select p.value_numeric, p.effective_from
    from public.tax_parameters p
    where p.code = c.code
      and p.effective_from <= p_on_date
      and (p.effective_to is null or p_on_date < p.effective_to)
    order by p.effective_from desc
    limit 1
  ) platform_value on true
  order by c.code;
end;
$function$;

revoke all on function public.get_my_tax_parameters(date) from public, anon;
grant execute on function public.get_my_tax_parameters(date) to authenticated, service_role;

create or replace function public.set_my_tax_parameters(
  p_effective_from date,
  p_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_code text;
  v_raw text;
  v_value numeric;
  v_unit text;
  v_existing_id uuid;
  v_next_from date;
  v_saved_codes text[] := array[]::text[];
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_effective_from is null then
    raise exception 'TAX_PARAMETER_DATE_REQUIRED';
  end if;

  if p_effective_from < current_date then
    raise exception 'TAX_PARAMETER_PAST_DATE_NOT_ALLOWED';
  end if;

  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'INVALID_TAX_PARAMETER_VALUES';
  end if;

  for v_code, v_raw in
    select key, value #>> '{}'
    from jsonb_each(p_values)
  loop
    if v_code not in (
      'minimum_wage_minor',
      'living_wage_minor',
      'esv_rate',
      'group1_single_tax_rate',
      'group1_military_levy_rate',
      'group2_single_tax_rate',
      'group2_military_levy_rate',
      'group3_single_tax_rate',
      'group3_military_levy_rate'
    ) then
      raise exception 'UNSUPPORTED_TAX_PARAMETER:%', v_code;
    end if;

    begin
      v_value := v_raw::numeric;
    exception when others then
      raise exception 'INVALID_TAX_PARAMETER_VALUE:%', v_code;
    end;

    if v_value <= 0 then
      raise exception 'INVALID_TAX_PARAMETER_VALUE:%', v_code;
    end if;

    if v_code in ('minimum_wage_minor', 'living_wage_minor') then
      v_unit := 'uah_minor';
      if v_value <> trunc(v_value) then
        raise exception 'INVALID_TAX_PARAMETER_MONEY:%', v_code;
      end if;
    else
      v_unit := 'ratio';
      if v_value > 1 then
        raise exception 'INVALID_TAX_PARAMETER_RATE:%', v_code;
      end if;
    end if;

    perform tp.id
    from public.teacher_tax_parameters tp
    where tp.teacher_id = v_teacher_id
      and tp.code = v_code
    order by tp.effective_from
    for update;

    select tp.id
    into v_existing_id
    from public.teacher_tax_parameters tp
    where tp.teacher_id = v_teacher_id
      and tp.code = v_code
      and tp.effective_from = p_effective_from
    limit 1;

    if v_existing_id is not null then
      update public.teacher_tax_parameters
      set
        value_numeric = v_value,
        unit = v_unit,
        updated_at = now()
      where id = v_existing_id;
    else
      select min(tp.effective_from)
      into v_next_from
      from public.teacher_tax_parameters tp
      where tp.teacher_id = v_teacher_id
        and tp.code = v_code
        and tp.effective_from > p_effective_from;

      update public.teacher_tax_parameters tp
      set
        effective_to = p_effective_from,
        updated_at = now()
      where tp.teacher_id = v_teacher_id
        and tp.code = v_code
        and tp.effective_from < p_effective_from
        and (tp.effective_to is null or tp.effective_to > p_effective_from);

      insert into public.teacher_tax_parameters (
        teacher_id,
        code,
        value_numeric,
        unit,
        effective_from,
        effective_to
      )
      values (
        v_teacher_id,
        v_code,
        v_value,
        v_unit,
        p_effective_from,
        v_next_from
      );
    end if;

    v_saved_codes := array_append(v_saved_codes, v_code);
    v_existing_id := null;
    v_next_from := null;
  end loop;

  return jsonb_build_object(
    'effective_from', p_effective_from,
    'saved_codes', to_jsonb(v_saved_codes)
  );
end;
$function$;

revoke all on function public.set_my_tax_parameters(date, jsonb) from public, anon;
grant execute on function public.set_my_tax_parameters(date, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tax profile now describes only the legal mode/group. Numeric tax values are
-- resolved from versioned teacher parameters for the relevant date.
-- ---------------------------------------------------------------------------

alter table public.teacher_tax_profiles
  drop constraint if exists teacher_tax_profiles_group_tax_model_valid;

alter table public.teacher_tax_profiles
  add constraint teacher_tax_profiles_group_tax_model_valid check (
    taxpayer_type = 'none'::public.teacher_taxpayer_type
    or (
      pe_group = 1
      and single_tax_basis = 'living_wage_percent'::public.tax_calculation_basis
      and military_levy_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and esv_basis = 'minimum_wage_percent'::public.tax_calculation_basis
    )
    or (
      pe_group = 2
      and single_tax_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and military_levy_basis = 'minimum_wage_percent'::public.tax_calculation_basis
      and esv_basis = 'minimum_wage_percent'::public.tax_calculation_basis
    )
    or (
      pe_group = 3
      and single_tax_basis = 'income_percent'::public.tax_calculation_basis
      and military_levy_basis = 'income_percent'::public.tax_calculation_basis
      and esv_basis = 'minimum_wage_percent'::public.tax_calculation_basis
    )
  );

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
  v_single_rate numeric;
  v_military_rate numeric;
  v_esv_rate numeric;
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

  if p_effective_from < current_date then
    raise exception 'TAX_PROFILE_PAST_DATE_NOT_ALLOWED';
  end if;

  if p_taxpayer_type = 'none'::public.teacher_taxpayer_type then
    p_pe_group := null;
    v_single_basis := 'none'::public.tax_calculation_basis;
    v_military_basis := 'none'::public.tax_calculation_basis;
    v_esv_basis := 'none'::public.tax_calculation_basis;
    v_single_rate := null;
    v_military_rate := null;
    v_esv_rate := null;
  else
    if p_pe_group is null or p_pe_group not between 1 and 3 then
      raise exception 'INVALID_PE_GROUP';
    end if;

    v_esv_rate := public.get_effective_tax_parameter_value(
      v_teacher_id,
      'esv_rate',
      p_effective_from
    );

    if p_pe_group = 1 then
      v_single_basis := 'living_wage_percent'::public.tax_calculation_basis;
      v_military_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_esv_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_single_rate := public.get_effective_tax_parameter_value(v_teacher_id, 'group1_single_tax_rate', p_effective_from);
      v_military_rate := public.get_effective_tax_parameter_value(v_teacher_id, 'group1_military_levy_rate', p_effective_from);
    elsif p_pe_group = 2 then
      v_single_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_military_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_esv_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_single_rate := public.get_effective_tax_parameter_value(v_teacher_id, 'group2_single_tax_rate', p_effective_from);
      v_military_rate := public.get_effective_tax_parameter_value(v_teacher_id, 'group2_military_levy_rate', p_effective_from);
    else
      v_single_basis := 'income_percent'::public.tax_calculation_basis;
      v_military_basis := 'income_percent'::public.tax_calculation_basis;
      v_esv_basis := 'minimum_wage_percent'::public.tax_calculation_basis;
      v_single_rate := public.get_effective_tax_parameter_value(v_teacher_id, 'group3_single_tax_rate', p_effective_from);
      v_military_rate := public.get_effective_tax_parameter_value(v_teacher_id, 'group3_military_levy_rate', p_effective_from);
    end if;

    if v_single_rate is null or v_military_rate is null or v_esv_rate is null then
      raise exception 'TAX_PARAMETERS_NOT_CONFIGURED';
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
      single_tax_rate = v_single_rate,
      military_levy_basis = v_military_basis,
      military_levy_rate = v_military_rate,
      esv_basis = v_esv_basis,
      esv_rate = v_esv_rate,
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
      v_single_rate,
      v_military_basis,
      v_military_rate,
      v_esv_basis,
      v_esv_rate,
      p_effective_from,
      v_next_from
    )
    returning * into v_result;
  end if;

  return v_result;
end;
$function$;

-- Keep the existing grants on the unchanged signature.

-- ---------------------------------------------------------------------------
-- Payment tax accruals: resolve rates by payment income date, not from profile
-- hard-coded assumptions. Snapshots still persist on each accrual.
-- ---------------------------------------------------------------------------

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
  v_single_rate numeric;
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

  select p.*
  into v_profile
  from public.teacher_tax_profiles p
  where p.teacher_id = v_payment.teacher_id
    and p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
    and p.effective_from <= v_income_date
    and (p.effective_to is null or v_income_date < p.effective_to)
  order by p.effective_from desc
  limit 1;

  if not found then
    return null;
  end if;

  if v_profile.pe_group = 1 then
    v_single_rate := public.get_effective_tax_parameter_value(v_payment.teacher_id, 'group1_single_tax_rate', v_income_date);
    v_military_rate := public.get_effective_tax_parameter_value(v_payment.teacher_id, 'group1_military_levy_rate', v_income_date);
  elsif v_profile.pe_group = 2 then
    v_single_rate := public.get_effective_tax_parameter_value(v_payment.teacher_id, 'group2_single_tax_rate', v_income_date);
    v_military_rate := public.get_effective_tax_parameter_value(v_payment.teacher_id, 'group2_military_levy_rate', v_income_date);
  else
    v_single_rate := public.get_effective_tax_parameter_value(v_payment.teacher_id, 'group3_single_tax_rate', v_income_date);
    v_military_rate := public.get_effective_tax_parameter_value(v_payment.teacher_id, 'group3_military_levy_rate', v_income_date);
  end if;

  if v_single_rate is null or v_military_rate is null then
    return null;
  end if;

  if v_payment.currency = 'UAH'::public.finance_currency then
    v_tax_base := v_payment.amount_minor;
    v_single_tax := case
      when v_profile.single_tax_basis = 'income_percent'::public.tax_calculation_basis
        then round(v_tax_base * v_single_rate)::bigint
      else 0
    end;
    v_military := case
      when v_profile.military_levy_basis = 'income_percent'::public.tax_calculation_basis
        then round(v_tax_base * v_military_rate)::bigint
      else 0
    end;

    insert into public.payment_tax_accruals (
      teacher_id, payment_id, tax_profile_id, pe_group, income_date,
      source_amount_minor, source_currency, fx_source, fx_rate, fx_rate_date,
      tax_base_uah_minor, single_tax_basis, single_tax_rate,
      military_levy_basis, military_levy_rate, single_tax_minor,
      military_levy_minor, total_income_taxes_minor, status, resolved_at
    )
    values (
      v_payment.teacher_id, v_payment.id, v_profile.id, v_profile.pe_group,
      v_income_date, v_payment.amount_minor, v_payment.currency,
      'native_uah', 1, v_income_date, v_tax_base,
      v_profile.single_tax_basis, v_single_rate,
      v_profile.military_levy_basis, v_military_rate,
      v_single_tax, v_military, v_single_tax + v_military,
      'ready'::public.payment_tax_accrual_status, now()
    )
    returning * into v_result;
  else
    insert into public.payment_tax_accruals (
      teacher_id, payment_id, tax_profile_id, pe_group, income_date,
      source_amount_minor, source_currency, fx_source,
      single_tax_basis, single_tax_rate, military_levy_basis,
      military_levy_rate, status
    )
    values (
      v_payment.teacher_id, v_payment.id, v_profile.id, v_profile.pe_group,
      v_income_date, v_payment.amount_minor, v_payment.currency, 'NBU',
      v_profile.single_tax_basis, v_single_rate,
      v_profile.military_levy_basis, v_military_rate,
      'fx_pending'::public.payment_tax_accrual_status
    )
    returning * into v_result;
  end if;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Monthly tax summary: group 1/2 fixed monthly taxes resolve the teacher's
-- parameters for that month; group 3 income taxes use per-payment snapshots.
-- ---------------------------------------------------------------------------

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
resolved as (
  select
    pm.*,
    least(
      (pm.month_start + interval '1 month - 1 day')::date,
      current_date
    ) as parameter_date
  from profile_months pm
),
resolved_values as (
  select
    r.*,
    public.get_effective_tax_parameter_value(r.teacher_id, 'minimum_wage_minor', r.parameter_date) as minimum_wage_minor,
    public.get_effective_tax_parameter_value(r.teacher_id, 'living_wage_minor', r.parameter_date) as living_wage_minor,
    public.get_effective_tax_parameter_value(r.teacher_id, 'esv_rate', r.parameter_date) as effective_esv_rate,
    case r.pe_group
      when 1 then public.get_effective_tax_parameter_value(r.teacher_id, 'group1_single_tax_rate', r.parameter_date)
      when 2 then public.get_effective_tax_parameter_value(r.teacher_id, 'group2_single_tax_rate', r.parameter_date)
      when 3 then public.get_effective_tax_parameter_value(r.teacher_id, 'group3_single_tax_rate', r.parameter_date)
    end as effective_single_tax_rate,
    case r.pe_group
      when 1 then public.get_effective_tax_parameter_value(r.teacher_id, 'group1_military_levy_rate', r.parameter_date)
      when 2 then public.get_effective_tax_parameter_value(r.teacher_id, 'group2_military_levy_rate', r.parameter_date)
      when 3 then public.get_effective_tax_parameter_value(r.teacher_id, 'group3_military_levy_rate', r.parameter_date)
    end as effective_military_levy_rate
  from resolved r
),
computed as (
  select
    r.teacher_id,
    r.month_start,
    coalesce(i.income_base_uah_minor, 0)::bigint as income_base_uah_minor,
    coalesce(i.pending_fx_count, 0)::integer as pending_fx_count,
    case r.single_tax_basis
      when 'income_percent'::public.tax_calculation_basis
        then coalesce(i.income_single_tax_minor, 0)::bigint
      when 'minimum_wage_percent'::public.tax_calculation_basis
        then round(r.minimum_wage_minor * r.effective_single_tax_rate)::bigint
      when 'living_wage_percent'::public.tax_calculation_basis
        then round(r.living_wage_minor * r.effective_single_tax_rate)::bigint
      else 0::bigint
    end as single_tax_minor,
    case r.military_levy_basis
      when 'income_percent'::public.tax_calculation_basis
        then coalesce(i.income_military_levy_minor, 0)::bigint
      when 'minimum_wage_percent'::public.tax_calculation_basis
        then round(r.minimum_wage_minor * r.effective_military_levy_rate)::bigint
      when 'living_wage_percent'::public.tax_calculation_basis
        then round(r.living_wage_minor * r.effective_military_levy_rate)::bigint
      else 0::bigint
    end as military_levy_minor,
    case r.esv_basis
      when 'minimum_wage_percent'::public.tax_calculation_basis
        then round(r.minimum_wage_minor * r.effective_esv_rate)::bigint
      when 'living_wage_percent'::public.tax_calculation_basis
        then round(r.living_wage_minor * r.effective_esv_rate)::bigint
      when 'income_percent'::public.tax_calculation_basis
        then round(coalesce(i.income_base_uah_minor, 0) * r.effective_esv_rate)::bigint
      else 0::bigint
    end as esv_minor
  from resolved_values r
  left join income i
    on i.teacher_id = r.teacher_id
   and i.month_start = r.month_start
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
  'Teacher-specific monthly PE tax summary using versioned teacher tax parameters. No rows are produced for non-PE profiles.';

revoke all on table public.teacher_monthly_tax_summary from anon, authenticated;
grant select on table public.teacher_monthly_tax_summary to authenticated, service_role;

commit;
