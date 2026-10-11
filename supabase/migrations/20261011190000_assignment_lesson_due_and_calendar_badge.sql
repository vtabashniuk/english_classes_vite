-- Lesson-linked assignments always have the lesson date as their deadline.
-- No need to edit the earlier (already applied) migration files.
-- RLS-scoped weekly aggregate powers the unobtrusive calendar badge.
begin;

create or replace function public.enforce_assignment_lesson_due_date()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_date date;
begin
  if new.lesson_id is not null then
    select (l.starts_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv'))::date
      into v_date
    from public.lessons l
    left join public.teacher_settings ts on ts.teacher_id = l.teacher_id
    where l.id = new.lesson_id
      and l.teacher_id = new.teacher_id
      and l.student_id = new.student_id;
    if not found then raise exception 'LESSON_NOT_FOUND'; end if;
    new.due_date := v_date;
  end if;
  return new;
end $$;

-- Trigger covers both RPC and permitted direct writes. Linking replaces an explicitly
-- submitted deadline; unlinking leaves the caller's chosen deadline untouched.
drop trigger if exists assignments_lesson_due_date on public.assignments;
create trigger assignments_lesson_due_date
before insert or update of lesson_id, due_date, teacher_id, student_id on public.assignments
for each row execute function public.enforce_assignment_lesson_due_date();

-- Align previously saved unfinished assignments with the new policy as well.
update public.assignments a
  set due_date = (l.starts_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv'))::date,
      updated_at = now()
from public.lessons l
left join public.teacher_settings ts on ts.teacher_id = l.teacher_id
where a.lesson_id = l.id and a.status = 'assigned'
  and a.due_date is distinct from
    (l.starts_at at time zone coalesce(ts.schedule_timezone, 'Europe/Kyiv'))::date;

-- When a linked lesson is moved, unfinished homework follows its new local date.
-- Completed homework remains historical and is never reopened or re-dated.
create or replace function public.resync_assignment_due_on_lesson_move()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update public.assignments a
       set due_date = (new.starts_at at time zone coalesce(
           (select ts.schedule_timezone from public.teacher_settings ts
            where ts.teacher_id = new.teacher_id), 'Europe/Kyiv'))::date,
           updated_at = now()
     where a.lesson_id = new.id and a.status = 'assigned';
  end if;
  return new;
end $$;

drop trigger if exists lessons_assignment_due_date_sync on public.lessons;
create trigger lessons_assignment_due_date_sync
after update of starts_at on public.lessons
for each row when (new.starts_at is distinct from old.starts_at)
execute function public.resync_assignment_due_on_lesson_move();

-- RLS is applied because this function is SECURITY INVOKER. Teacher ID scoping
-- additionally prevents cross-teacher disclosure if assignments policies change.
create or replace function public.teacher_schedule_pending_homework(
  p_from timestamptz, p_to timestamptz
) returns table(lesson_id uuid, pending_count bigint)
language sql stable security invoker set search_path = '' as $$
  select a.lesson_id, count(*)::bigint
    from public.assignments a
    join public.lessons l on l.id = a.lesson_id
   where a.status = 'assigned'
     and a.lesson_id is not null
     and a.teacher_id = auth.uid()
     and l.teacher_id = auth.uid()
     and l.starts_at >= p_from and l.starts_at < p_to
   group by a.lesson_id;
$$;
revoke all on function public.enforce_assignment_lesson_due_date() from public,anon,authenticated;
revoke all on function public.resync_assignment_due_on_lesson_move() from public,anon,authenticated;
revoke all on function public.teacher_schedule_pending_homework(timestamptz,timestamptz) from public,anon;
grant execute on function public.teacher_schedule_pending_homework(timestamptz,timestamptz) to authenticated;

commit;
notify pgrst, 'reload schema';
