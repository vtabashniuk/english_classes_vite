-- Finance dashboard read model: successful receipts with student/account context
-- and the payment date resolved in the teacher's configured schedule timezone.

begin;

create index if not exists payments_teacher_paid_at_succeeded_idx
  on public.payments (teacher_id, paid_at desc)
  where status = 'succeeded'::public.payment_status;

create or replace view public.teacher_finance_receipts
with (security_invoker = true)
as
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
  (p.paid_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv'))::date as payment_date,
  p.description
from public.payments p
left join public.payment_accounts a
  on a.id = p.payment_account_id
 and a.teacher_id = p.teacher_id
join public.profiles s
  on s.id = p.student_id
left join public.teacher_settings ts
  on ts.teacher_id = p.teacher_id
where p.status = 'succeeded'::public.payment_status
  and p.paid_at is not null;

comment on view public.teacher_finance_receipts is
  'Successful teacher receipts enriched with student/account data and teacher-local payment date for Finance dashboard reporting.';

revoke all on table public.teacher_finance_receipts from anon, authenticated;
grant select on table public.teacher_finance_receipts to authenticated, service_role;

commit;
