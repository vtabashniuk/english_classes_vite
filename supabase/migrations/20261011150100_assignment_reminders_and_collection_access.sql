-- Assignment reminders: one internal notification per overdue assignment.
-- No due date => no scheduled reminder. No email/SMS.
begin;

create table public.assignment_reminder_events (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  sent_at timestamptz not null default now()
);
alter table public.assignment_reminder_events enable row level security;
-- Only the privileged scheduler may write reminders; neither role can forge them.
revoke all on public.assignment_reminder_events from public,anon,authenticated;

create index if not exists assignments_pending_due_idx
 on public.assignments(due_date,student_id) where status='assigned';
create index if not exists assignments_pending_lesson_idx
 on public.assignments(lesson_id) where status='assigned' and lesson_id is not null;

create or replace function public.dispatch_overdue_assignment_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/Kyiv')::date;
  v_count integer := 0;
  v_assignment record;
begin
  -- Restrict calls to the database scheduler/administrator; never authenticated users.
  if session_user not in ('postgres','supabase_admin') then
    raise exception 'ACCESS_DENIED';
  end if;
  -- One notification after the due date; respect the Kyiv local calendar.
  for v_assignment in
    select a.id,a.student_id,a.title,a.due_date
    from public.assignments a
    where a.status='assigned' and a.due_date < v_today
      and exists (select 1 from public.teacher_students rel
        where rel.teacher_id=a.teacher_id and rel.student_id=a.student_id
          and rel.is_active=true and rel.learning_status='active')
      and not exists (select 1 from public.assignment_reminder_events e where e.assignment_id=a.id)
    for update of a skip locked
  loop
    insert into public.assignment_reminder_events(assignment_id,student_id)
    values(v_assignment.id,v_assignment.student_id) on conflict do nothing;
    if found then
      insert into public.notifications(user_id,type,title_key,body_key,data)
      values(v_assignment.student_id,'assignment_overdue_reminder',
        'notifications.assignmentOverdue.title',
        'notifications.assignmentOverdue.body',
        jsonb_build_object('assignmentId',v_assignment.id,
          'assignmentTitle',v_assignment.title,'dueDate',v_assignment.due_date));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.dispatch_overdue_assignment_reminders() from public,anon,authenticated;

-- Aggregated counts in the database avoid client pagination/row-count limits.
create or replace function public.teacher_pending_assignment_counts()
returns table(student_id uuid,pending_count bigint)
language sql stable security invoker set search_path = '' as $$
 select a.student_id,count(*)::bigint as pending_count
 from public.assignments a
 where a.teacher_id=auth.uid() and a.status='assigned'
 group by a.student_id;
$$;
revoke all on function public.teacher_pending_assignment_counts() from public,anon;
grant execute on function public.teacher_pending_assignment_counts() to authenticated;

-- Atomic bulk grant/explicit restoration. Existing active grants are left unchanged.
create or replace function public.grant_collection_materials_to_student(
 p_student_id uuid, p_material_ids uuid[]
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer:=0; v_distinct uuid[];
begin
 if not public.is_teacher() or not public.is_my_active_student(p_student_id) then
   raise exception 'ACCESS_DENIED';
 end if;
 select coalesce(array_agg(distinct selected.material_id),'{}'::uuid[]) into v_distinct
 from unnest(coalesce(p_material_ids,'{}'::uuid[])) as selected(material_id);
 if cardinality(v_distinct)=0 or cardinality(v_distinct)>100 then
   raise exception 'INVALID_MATERIAL_SELECTION';
 end if;
 if (select count(*) from public.materials m where m.id=any(v_distinct)
     and m.teacher_id=auth.uid() and m.archived_at is null) <> cardinality(v_distinct) then
   raise exception 'ACCESS_DENIED';
 end if;
 foreach v_id in array v_distinct loop
   if exists(select 1 from public.student_materials sm
             where sm.material_id=v_id and sm.student_id=p_student_id
             and sm.revoked_at is null) then
      continue;
   elsif exists(select 1 from public.student_materials sm
                where sm.material_id=v_id and sm.student_id=p_student_id) then
      perform public.restore_material_access(v_id,p_student_id);
   else
      -- The existing insert trigger records the individual audit event.
      insert into public.student_materials(student_id,material_id)
      values(p_student_id,v_id) on conflict(student_id,material_id) do nothing;
   end if;
   v_count := v_count + 1;
 end loop;
 if v_count > 0 then
   -- A batch is ONE notification, never one notification per material.
   insert into public.notifications(user_id,type,title_key,body_key,data)
   values(p_student_id,'material_shared',
     'notifications.materialsSharedBulk.title',
     'notifications.materialsSharedBulk.body',
     jsonb_build_object('count',v_count));
 end if;
 return v_count;
end $$;
revoke all on function public.grant_collection_materials_to_student(uuid,uuid[]) from public,anon;
grant execute on function public.grant_collection_materials_to_student(uuid,uuid[]) to authenticated;

-- pg_cron is already enabled in the CRM. Schedule one local-morning check hourly,
-- so Kyiv summer/winter DST changes do not change the reminder's local time.
-- Job calls can run more often without duplicates thanks to the event PK.
select cron.schedule('assignment-overdue-reminders','5 * * * *',
 $$select public.dispatch_overdue_assignment_reminders()
   where extract(hour from now() at time zone 'Europe/Kyiv') = 9;$$);
commit;
notify pgrst, 'reload schema';
