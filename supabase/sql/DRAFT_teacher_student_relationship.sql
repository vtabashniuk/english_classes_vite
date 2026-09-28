-- DRAFT ONLY — do not apply together with the hardening script yet.
-- This addresses the current implicit student -> teacher resolution.
-- It should be applied only together with the corresponding invite-student
-- Edge Function update so every newly invited student is linked to the inviter.

begin;

create table if not exists public.teacher_students (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (teacher_id, student_id),
  constraint teacher_students_different_users check (teacher_id <> student_id)
);

alter table public.teacher_students enable row level security;

create policy "Teacher can view own student relationships"
on public.teacher_students
for select
to authenticated
using (teacher_id = auth.uid() and public.is_teacher());

create policy "Student can view own teacher relationship"
on public.teacher_students
for select
to authenticated
using (student_id = auth.uid());

create index if not exists teacher_students_student_active_idx
  on public.teacher_students (student_id)
  where is_active = true;

-- Backfill from the most recent existing lesson for each student.
insert into public.teacher_students (teacher_id, student_id)
select x.teacher_id, x.student_id
from (
  select distinct on (l.student_id)
    l.teacher_id,
    l.student_id
  from public.lessons l
  order by l.student_id, l.starts_at desc
) x
on conflict (teacher_id, student_id) do nothing;

-- Backfill students with no lessons for the current single-teacher installation.
insert into public.teacher_students (teacher_id, student_id)
select t.id, s.id
from public.profiles s
cross join lateral (
  select p.id
  from public.profiles p
  join public.teacher_settings ts on ts.teacher_id = p.id
  where p.role = 'teacher' and p.is_active = true
  order by p.created_at
  limit 1
) t
where s.role = 'student'
  and not exists (
    select 1
    from public.teacher_students rel
    where rel.student_id = s.id and rel.is_active = true
  )
on conflict (teacher_id, student_id) do nothing;

create or replace function public.resolve_my_teacher_id()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_teacher_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select rel.teacher_id
  into v_teacher_id
  from public.teacher_students rel
  join public.profiles teacher on teacher.id = rel.teacher_id
  where rel.student_id = v_user_id
    and rel.is_active = true
    and teacher.role = 'teacher'
    and teacher.is_active = true
  order by rel.created_at
  limit 1;

  if v_teacher_id is null then
    raise exception 'TEACHER_NOT_FOUND';
  end if;

  return v_teacher_id;
end;
$function$;

commit;
