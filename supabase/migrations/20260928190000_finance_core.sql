-- Finance Core
-- Multi-currency student billing, payment records and immutable financial ledger.
-- This migration intentionally does NOT charge lessons yet. Integration with
-- set_lesson_outcome() is added only after the finance core is verified.

begin;

-- ---------------------------------------------------------------------------
-- Domain enums
-- ---------------------------------------------------------------------------

create type public.finance_currency as enum (
  'UAH',
  'USD',
  'EUR'
);

create type public.payment_account_type as enum (
  'bank_account',
  'cash',
  'merchant'
);

create type public.payment_provider as enum (
  'manual',
  'monobank'
);

create type public.payment_method as enum (
  'cash',
  'bank_transfer',
  'card',
  'apple_pay',
  'google_pay',
  'monopay'
);

create type public.payment_status as enum (
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'refunded'
);

create type public.finance_transaction_type as enum (
  'payment',
  'lesson_charge',
  'refund',
  'adjustment',
  'reversal'
);

-- ---------------------------------------------------------------------------
-- Student finance settings
-- ---------------------------------------------------------------------------

create table public.student_billing_settings (
  teacher_id uuid not null,
  student_id uuid not null,
  billing_currency public.finance_currency not null default 'UAH',
  online_payments_enabled boolean not null default false,
  charge_missed_lessons boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (teacher_id, student_id),

  constraint student_billing_settings_relationship_fkey
    foreign key (teacher_id, student_id)
    references public.teacher_students (teacher_id, student_id)
    on delete cascade
);

alter table public.student_billing_settings enable row level security;

comment on table public.student_billing_settings is
  'Per teacher/student finance preferences. Balance is never stored here.';

comment on column public.student_billing_settings.billing_currency is
  'Default/current billing currency used by the UI. Historical lesson rates keep their own currency.';

-- ---------------------------------------------------------------------------
-- Versioned lesson rates
-- ---------------------------------------------------------------------------

create table public.student_lesson_rates (
  id uuid not null default gen_random_uuid(),
  teacher_id uuid not null,
  student_id uuid not null,
  amount_minor bigint not null,
  currency public.finance_currency not null,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint student_lesson_rates_pkey primary key (id),

  constraint student_lesson_rates_relationship_fkey
    foreign key (teacher_id, student_id)
    references public.teacher_students (teacher_id, student_id)
    on delete restrict,

  constraint student_lesson_rates_positive_amount
    check (amount_minor > 0),

  constraint student_lesson_rates_valid_period
    check (effective_to is null or effective_to > effective_from)
);

alter table public.student_lesson_rates enable row level security;

-- A student has one standard lesson rate at any given date. If different lesson
-- types are introduced later, lesson_type can be added to this exclusion key.
alter table public.student_lesson_rates
  add constraint student_lesson_rates_no_overlap
  exclude using gist (
    teacher_id with =,
    student_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index student_lesson_rates_lookup_idx
  on public.student_lesson_rates (teacher_id, student_id, effective_from desc);

comment on table public.student_lesson_rates is
  'Versioned standard lesson prices. Money is stored in minor units (e.g. 60000 = 600.00 UAH).';

-- ---------------------------------------------------------------------------
-- Teacher payment accounts
-- ---------------------------------------------------------------------------

create table public.payment_accounts (
  id uuid not null default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  provider text not null,
  account_type public.payment_account_type not null,
  currency public.finance_currency not null,
  external_ref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_accounts_pkey primary key (id),
  constraint payment_accounts_id_teacher_currency_key unique (id, teacher_id, currency),
  constraint payment_accounts_name_length
    check (char_length(trim(name)) between 1 and 100),
  constraint payment_accounts_provider_length
    check (char_length(trim(provider)) between 1 and 50),
  constraint payment_accounts_external_ref_length
    check (external_ref is null or char_length(external_ref) <= 200)
);

alter table public.payment_accounts enable row level security;

create unique index payment_accounts_teacher_name_idx
  on public.payment_accounts (teacher_id, lower(trim(name)));

create index payment_accounts_teacher_active_idx
  on public.payment_accounts (teacher_id, currency, is_active);

comment on table public.payment_accounts is
  'Teacher receiving accounts such as Monobank UAH/USD/EUR or cash. API secrets must never be stored here.';

comment on column public.payment_accounts.external_ref is
  'Optional non-secret provider/account reference. Never store API tokens, PAN/CVV or other card credentials.';

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid not null default gen_random_uuid(),
  teacher_id uuid not null,
  student_id uuid not null,
  payment_account_id uuid,
  amount_minor bigint not null,
  currency public.finance_currency not null,
  provider public.payment_provider not null,
  payment_method public.payment_method not null,
  status public.payment_status not null default 'pending',
  provider_invoice_id text,
  provider_payment_id text,
  description text,
  provider_metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payments_pkey primary key (id),
  constraint payments_id_owner_currency_key unique (id, teacher_id, student_id, currency),

  constraint payments_relationship_fkey
    foreign key (teacher_id, student_id)
    references public.teacher_students (teacher_id, student_id)
    on delete restrict,

  constraint payments_account_fkey
    foreign key (payment_account_id, teacher_id, currency)
    references public.payment_accounts (id, teacher_id, currency)
    on delete restrict,

  constraint payments_positive_amount
    check (amount_minor > 0),

  constraint payments_description_length
    check (description is null or char_length(description) <= 500),

  constraint payments_provider_invoice_id_length
    check (provider_invoice_id is null or char_length(provider_invoice_id) <= 200),

  constraint payments_provider_payment_id_length
    check (provider_payment_id is null or char_length(provider_payment_id) <= 200),

  constraint payments_provider_metadata_object
    check (jsonb_typeof(provider_metadata) = 'object'),

  constraint payments_succeeded_has_paid_at
    check (status <> 'succeeded'::public.payment_status or paid_at is not null)
);

alter table public.payments enable row level security;

create index payments_teacher_student_created_idx
  on public.payments (teacher_id, student_id, created_at desc);

create index payments_student_created_idx
  on public.payments (student_id, created_at desc);

create unique index payments_provider_invoice_unique_idx
  on public.payments (teacher_id, provider, provider_invoice_id)
  where provider_invoice_id is not null;

create unique index payments_provider_payment_unique_idx
  on public.payments (teacher_id, provider, provider_payment_id)
  where provider_payment_id is not null;

comment on table public.payments is
  'Payment attempts and completed payments. A payment changes student balance only through a separate ledger transaction.';

-- ---------------------------------------------------------------------------
-- Immutable student financial ledger
-- ---------------------------------------------------------------------------

create table public.student_finance_transactions (
  id uuid not null default gen_random_uuid(),
  teacher_id uuid not null,
  student_id uuid not null,
  transaction_type public.finance_transaction_type not null,
  amount_minor bigint not null,
  currency public.finance_currency not null,
  lesson_id uuid references public.lessons(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  reversal_of_id uuid references public.student_finance_transactions(id) on delete restrict,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint student_finance_transactions_pkey primary key (id),

  constraint student_finance_transactions_relationship_fkey
    foreign key (teacher_id, student_id)
    references public.teacher_students (teacher_id, student_id)
    on delete restrict,

  constraint student_finance_transactions_nonzero_amount
    check (amount_minor <> 0),

  constraint student_finance_transactions_description_length
    check (description is null or char_length(description) <= 500),

  constraint student_finance_transactions_metadata_object
    check (jsonb_typeof(metadata) = 'object'),

  constraint student_finance_transactions_not_self_reversal
    check (reversal_of_id is null or reversal_of_id <> id),

  -- Keep the meaning of each ledger row explicit. More advanced settlement
  -- scenarios can be added later without changing historical rows.
  constraint student_finance_transactions_shape_check
    check (
      (
        transaction_type = 'payment'::public.finance_transaction_type
        and amount_minor > 0
        and payment_id is not null
        and lesson_id is null
        and reversal_of_id is null
      )
      or
      (
        transaction_type = 'lesson_charge'::public.finance_transaction_type
        and amount_minor < 0
        and lesson_id is not null
        and payment_id is null
        and reversal_of_id is null
      )
      or
      (
        transaction_type = 'refund'::public.finance_transaction_type
        and amount_minor < 0
        and payment_id is not null
        and lesson_id is null
        and reversal_of_id is null
      )
      or
      (
        transaction_type = 'adjustment'::public.finance_transaction_type
        and payment_id is null
        and lesson_id is null
        and reversal_of_id is null
      )
      or
      (
        transaction_type = 'reversal'::public.finance_transaction_type
        and reversal_of_id is not null
        and payment_id is null
        and lesson_id is null
      )
    )
);

alter table public.student_finance_transactions enable row level security;

create index student_finance_transactions_teacher_student_effective_idx
  on public.student_finance_transactions (
    teacher_id,
    student_id,
    effective_at desc,
    created_at desc
  );

create index student_finance_transactions_student_effective_idx
  on public.student_finance_transactions (student_id, effective_at desc, created_at desc);

-- Idempotency / accounting invariants.
create unique index student_finance_one_payment_credit_idx
  on public.student_finance_transactions (payment_id)
  where transaction_type = 'payment'::public.finance_transaction_type;

create unique index student_finance_one_lesson_charge_idx
  on public.student_finance_transactions (lesson_id)
  where transaction_type = 'lesson_charge'::public.finance_transaction_type;

create unique index student_finance_one_reversal_idx
  on public.student_finance_transactions (reversal_of_id)
  where transaction_type = 'reversal'::public.finance_transaction_type;

comment on table public.student_finance_transactions is
  'Append-only financial ledger. Student balance is derived from SUM(amount_minor) grouped by currency.';

-- Ledger history is corrected by reversal rows, never by UPDATE or DELETE.
create or replace function public.prevent_student_finance_transaction_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'FINANCE_LEDGER_IMMUTABLE';
end;
$function$;

revoke execute on function public.prevent_student_finance_transaction_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_student_finance_transaction_mutation()
  to service_role;

create trigger student_finance_transactions_immutable
before update or delete on public.student_finance_transactions
for each row execute function public.prevent_student_finance_transaction_mutation();

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------

create view public.student_finance_balances
with (security_invoker = true)
as
select
  teacher_id,
  student_id,
  currency,
  sum(amount_minor)::bigint as balance_minor
from public.student_finance_transactions
group by teacher_id, student_id, currency;

comment on view public.student_finance_balances is
  'Derived per-currency student balances. There is no mutable balance column.';

-- ---------------------------------------------------------------------------
-- RLS: read access only from the browser. All future finance mutations go RPC.
-- ---------------------------------------------------------------------------

create policy "Teacher can view student billing settings"
on public.student_billing_settings
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

create policy "Student can view own billing settings"
on public.student_billing_settings
for select
to authenticated
using (student_id = auth.uid());

create policy "Teacher can view student lesson rates"
on public.student_lesson_rates
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

create policy "Student can view own lesson rates"
on public.student_lesson_rates
for select
to authenticated
using (student_id = auth.uid());

create policy "Teacher can view own payment accounts"
on public.payment_accounts
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

create policy "Teacher can view student payments"
on public.payments
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

create policy "Student can view own payments"
on public.payments
for select
to authenticated
using (student_id = auth.uid());

create policy "Teacher can view student finance transactions"
on public.student_finance_transactions
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

create policy "Student can view own finance transactions"
on public.student_finance_transactions
for select
to authenticated
using (student_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Privileges: same model as the hardened existing application surface.
-- ---------------------------------------------------------------------------

revoke all on table public.student_billing_settings from anon, authenticated;
revoke all on table public.student_lesson_rates from anon, authenticated;
revoke all on table public.payment_accounts from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.student_finance_transactions from anon, authenticated;

revoke all on table public.student_finance_balances from anon, authenticated;

grant select on table public.student_billing_settings to authenticated;
grant select on table public.student_lesson_rates to authenticated;
grant select on table public.payment_accounts to authenticated;
grant select on table public.payments to authenticated;
grant select on table public.student_finance_transactions to authenticated;
grant select on table public.student_finance_balances to authenticated;

grant all on table public.student_billing_settings to service_role;
grant all on table public.student_lesson_rates to service_role;
grant all on table public.payment_accounts to service_role;
grant all on table public.payments to service_role;
grant all on table public.student_finance_transactions to service_role;
grant select on table public.student_finance_balances to service_role;

commit;
