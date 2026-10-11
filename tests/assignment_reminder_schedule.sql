-- Run only after 20261011170100, against LOCAL Supabase SQL Editor or psql.
-- Read-only assertions; no test students or notifications required.
do $$
begin
  if public.assignment_reminder_eligible_at('2026-10-11'::date, null, '2026-10-11 08:59:00+03'::timestamptz) then
    raise exception 'Default morning reminder arrived early';
  end if;
  if not public.assignment_reminder_eligible_at('2026-10-11'::date, null, '2026-10-11 09:00:00+03'::timestamptz) then
    raise exception 'Default reminder missed due date morning';
  end if;
  if public.assignment_reminder_eligible_at('2026-10-11'::date, '2026-10-11 12:00:00+03'::timestamptz, '2026-10-11 10:59:00+03'::timestamptz) then
    raise exception 'Lesson reminder arrived more than one hour before';
  end if;
  if not public.assignment_reminder_eligible_at('2026-10-11'::date, '2026-10-11 12:00:00+03'::timestamptz, '2026-10-11 11:00:00+03'::timestamptz) then
    raise exception 'One-hour-before-lesson reminder was missed';
  end if;
  if public.assignment_reminder_eligible_at('2026-10-11'::date, null, '2026-10-12 09:00:00+03'::timestamptz) then
    raise exception 'Next-day reminder must not be sent';
  end if;
  if not public.assignment_reminder_eligible_at('2026-10-11'::date, '2026-10-12 12:00:00+03'::timestamptz, '2026-10-11 09:00:00+03'::timestamptz) then
    raise exception 'Mismatched lesson date must fall back to due-day morning';
  end if;
end $$;
select jobname, schedule, active from cron.job where jobname like 'assignment-%reminders';
