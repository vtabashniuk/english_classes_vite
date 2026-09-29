begin;

-- Finance hotfix: use teacher-local calendar date for tax profile/account logic.
-- Generated after Step 7.

-- Fix tax/profile "today" semantics to use each teacher's configured timezone.
-- Supabase/PostgreSQL sessions use UTC by default, which can be one calendar day
-- behind the teacher around local midnight.

create or replace function public.get_teacher_local_date(
  p_teacher_id uuid
)
returns date
language sql
stable
security definer
set search_path = ''
as $function$
  select (
    now() at time zone coalesce(
      (
        select ts.schedule_timezone
        from public.teacher_settings ts
        where ts.teacher_id = p_teacher_id
      ),
      'Europe/Kyiv'
    )
  )::date;
$function$;

revoke all on function public.get_teacher_local_date(uuid) from public, anon;
grant execute on function public.get_teacher_local_date(uuid) to authenticated, service_role;

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
where p.effective_from <= public.get_teacher_local_date(p.teacher_id)
  and (
    p.effective_to is null
    or public.get_teacher_local_date(p.teacher_id) < p.effective_to
  )
order by p.teacher_id, p.effective_from desc;

create or replace function public.set_my_tax_profile(
  p_taxpayer_type public.teacher_taxpayer_type,
  p_pe_group smallint default null,
  p_single_tax_rate numeric default null,
  p_military_levy_rate numeric default null,
  p_esv_rate numeric default null,
  p_effective_from date default null
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
  v_today date;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  v_today := public.get_teacher_local_date(v_teacher_id);

  if p_effective_from is null then
    p_effective_from := v_today;
  end if;

  if p_effective_from < v_today then
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
  v_today date;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  v_today := public.get_teacher_local_date(v_teacher_id);

  if p_effective_from is null then
    raise exception 'TAX_PARAMETER_DATE_REQUIRED';
  end if;

  if p_effective_from < v_today then
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
         and p.effective_from <= public.get_teacher_local_date(v_teacher_id)
         and (p.effective_to is null or public.get_teacher_local_date(v_teacher_id) < p.effective_to)
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
         and p.effective_from <= public.get_teacher_local_date(v_teacher_id)
         and (p.effective_to is null or public.get_teacher_local_date(v_teacher_id) < p.effective_to)
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
  v_timezone text;
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

  select ts.schedule_timezone
  into v_timezone
  from public.teacher_settings ts
  where ts.teacher_id = v_payment.teacher_id;

  v_income_date := (
    v_payment.paid_at at time zone coalesce(v_timezone, 'Europe/Kyiv')
  )::date;

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
  v_timezone text;
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
    select ts.schedule_timezone
    into v_timezone
    from public.teacher_settings ts
    where ts.teacher_id = v_teacher_id;

    v_income_date := (
      p_paid_at at time zone coalesce(v_timezone, 'Europe/Kyiv')
    )::date;

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
        coalesce(
          p.effective_to - 1,
          public.get_teacher_local_date(p.teacher_id)
        ),
        public.get_teacher_local_date(p.teacher_id)
      )::timestamp
    ),
    interval '1 month'
  ) gs
  where p.taxpayer_type = 'pe'::public.teacher_taxpayer_type
    and p.effective_from <= public.get_teacher_local_date(p.teacher_id)
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
      public.get_teacher_local_date(pm.teacher_id)
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
  'Teacher-specific monthly PE tax summary using teacher-local calendar dates and versioned teacher tax parameters.';

revoke all on table public.teacher_monthly_tax_summary from anon, authenticated;
grant select on table public.teacher_monthly_tax_summary to authenticated, service_role;

commit;