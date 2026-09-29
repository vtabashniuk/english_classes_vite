-- Read model for all scheduled future lesson rates.
-- Keeps student_next_lesson_rates for backwards compatibility, while the UI can
-- render the complete future tariff schedule in chronological order.

begin;

create or replace view public.student_scheduled_lesson_rates
with (security_invoker = true)
as
select
  r.id,
  r.teacher_id,
  r.student_id,
  r.amount_minor,
  r.currency,
  r.effective_from,
  r.effective_to,
  r.created_at,
  r.updated_at
from public.student_lesson_rates r
where r.effective_from > current_date;

comment on view public.student_scheduled_lesson_rates is
  'All future scheduled lesson rates for each teacher/student relationship.';

revoke all on table public.student_scheduled_lesson_rates from anon, authenticated;
grant select on table public.student_scheduled_lesson_rates to authenticated, service_role;

commit;
