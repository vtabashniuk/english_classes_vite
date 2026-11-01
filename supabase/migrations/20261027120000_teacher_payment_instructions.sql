-- Teacher-managed student-visible payment instructions; informational only.
-- This migration does not change accounting, ledger or payment recording.
begin;

create table public.teacher_payment_instructions (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  currency public.finance_currency not null,
  recipient_name text not null default '',
  iban text not null default '',
  bank_name text not null default '',
  payment_purpose text not null default '',
  notes text not null default '',
  payment_url text,
  qr_image_url text,
  is_published boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (teacher_id, currency),
  constraint teacher_payment_recipient_length check (char_length(recipient_name) <= 200),
  constraint teacher_payment_iban_length check (char_length(iban) <= 200),
  constraint teacher_payment_bank_length check (char_length(bank_name) <= 200),
  constraint teacher_payment_purpose_length check (char_length(payment_purpose) <= 250),
  constraint teacher_payment_notes_length check (char_length(notes) <= 1000),
  constraint teacher_payment_url_https check (payment_url is null or (char_length(payment_url) <= 1000 and payment_url ~* '^https://[^[:space:]/]+(/[^[:space:]]*)?$')),
  constraint teacher_payment_qr_https check (qr_image_url is null or (char_length(qr_image_url) <= 1000 and qr_image_url ~* '^https://[^[:space:]/]+(/[^[:space:]]*)?$'))
);

alter table public.teacher_payment_instructions enable row level security;

create policy "Teacher reads own payment instructions"
on public.teacher_payment_instructions for select to authenticated
using (teacher_id = (select auth.uid()) and (select public.is_teacher()));

create policy "Active student reads published payment instructions"
on public.teacher_payment_instructions for select to authenticated
using (
  is_published
  and exists (
    select 1 from public.profiles student
    where student.id = (select auth.uid())
      and student.role = 'student'
      and student.is_active = true
  )
  and exists (
    select 1 from public.teacher_students rel
    where rel.teacher_id = teacher_payment_instructions.teacher_id
      and rel.student_id = (select auth.uid())
      and rel.is_active = true
  )
);

create policy "Teacher inserts own payment instructions"
on public.teacher_payment_instructions for insert to authenticated
with check (teacher_id = (select auth.uid()) and (select public.is_teacher()));

create policy "Teacher updates own payment instructions"
on public.teacher_payment_instructions for update to authenticated
using (teacher_id = (select auth.uid()) and (select public.is_teacher()))
with check (teacher_id = (select auth.uid()) and (select public.is_teacher()));

revoke all on public.teacher_payment_instructions from public, anon, authenticated;
grant select, insert, update on public.teacher_payment_instructions to authenticated;
grant all on public.teacher_payment_instructions to service_role;

comment on table public.teacher_payment_instructions is
  'Optional per-currency teacher payment instructions published to currently linked students. Never an instruction to charge a payment automatically.';

commit;
