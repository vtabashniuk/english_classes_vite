-- Switch from next-day reminders to same-day reminders.
-- 09:00 Europe/Kyiv unless this assignment is linked to a scheduled lesson on
-- its due date; in that case send about 1 hour before that lesson.
-- One notification per assignment per deadline; never notify the teacher on completion.
begin;

-- The previous job must not run in parallel with the replacement.
select cron.unschedule(jobid)
from cron.job where jobname = 'assignment-overdue-reminders';

-- Keep audit entries for a rescheduled deadline as well as for the original one.
alter table public.assignment_reminder_events add column if not exists due_date date;
update public.assignment_reminder_events e
set due_date = a.due_date
from public.assignments a
where a.id = e.assignment_id and e.due_date is null;
delete from public.assignment_reminder_events where due_date is null;
alter table public.assignment_reminder_events alter column due_date set not null;
alter table public.assignment_reminder_events drop constraint assignment_reminder_events_pkey;
alter table public.assignment_reminder_events
  add constraint assignment_reminder_events_pkey primary key(assignment_id, due_date);

-- Pure helper to make DST-aware reminder timing independently testable.
create or replace function public.assignment_reminder_eligible_at(
  p_due_date date, p_lesson_starts_at timestamptz, p_now timestamptz
) returns boolean language sql stable set search_path = '' as $$
  select p_due_date is not null
    and (p_now at time zone 'Europe/Kyiv')::date = p_due_date
    and p_now >= case
      when p_lesson_starts_at is not null
        and (p_lesson_starts_at at time zone 'Europe/Kyiv')::date = p_due_date
      then p_lesson_starts_at - interval '1 hour'
      else (p_due_date::timestamp + interval '9 hours') at time zone 'Europe/Kyiv'
    end;
$$;
revoke all on function public.assignment_reminder_eligible_at(date,timestamptz,timestamptz) from public,anon;
grant execute on function public.assignment_reminder_eligible_at(date,timestamptz,timestamptz) to authenticated;

create or replace function public.dispatch_due_assignment_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Kyiv')::date;
  v_count integer := 0;
  v_assignment record;
begin
  if session_user not in ('postgres','supabase_admin') then
    raise exception 'ACCESS_DENIED';
  end if;

  for v_assignment in
    select a.id, a.student_id, a.title, a.due_date
    from public.assignments a
    left join public.lessons l on l.id = a.lesson_id
      and l.student_id = a.student_id and l.status = 'scheduled'
    where a.status = 'assigned' and a.due_date = v_today
      and public.assignment_reminder_eligible_at(a.due_date, l.starts_at, v_now)
      and exists (select 1 from public.teacher_students ts
        where ts.teacher_id = a.teacher_id and ts.student_id = a.student_id
          and ts.is_active = true and ts.learning_status = 'active')
      and not exists (select 1 from public.assignment_reminder_events e
        where e.assignment_id = a.id and e.due_date = a.due_date)
    for update of a skip locked
  loop
    insert into public.assignment_reminder_events(assignment_id,student_id,due_date)
    values(v_assignment.id,v_assignment.student_id,v_assignment.due_date)
    on conflict do nothing;
    if found then
      insert into public.notifications(user_id,type,title_key,body_key,data)
      values(v_assignment.student_id,'assignment_due_reminder',
        'notifications.assignmentDue.title',
        'notifications.assignmentDue.body',
        jsonb_build_object('assignmentId',v_assignment.id,
          'assignmentTitle',v_assignment.title,'dueDate',v_assignment.due_date));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.dispatch_due_assignment_reminders() from public,anon,authenticated;

-- Five-minute polling keeps the 'hour before lesson' time reasonably close.
-- No external API, SMS, email or paid service is involved.
select cron.schedule('assignment-due-reminders','*/5 * * * *',
  $$select public.dispatch_due_assignment_reminders();$$);
commit;
notify pgrst, 'reload schema';
