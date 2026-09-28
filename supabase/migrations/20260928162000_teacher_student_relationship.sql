-- Introduce an explicit teacher <-> student relationship.
-- Safe for the current single-teacher installation and future multi-teacher growth.

begin;

create table public.teacher_students (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (teacher_id, student_id),
  constraint teacher_students_different_users check (teacher_id <> student_id)
);

alter table public.teacher_students enable row level security;

-- One active teacher per student for the current product model.
-- If multi-teacher students are introduced later, this index is the single place
-- that needs to be revisited together with the student-facing teacher selection UX.
create unique index teacher_students_one_active_teacher_per_student_idx
  on public.teacher_students (student_id)
  where is_active = true;

create index teacher_students_teacher_active_idx
  on public.teacher_students (teacher_id, student_id)
  where is_active = true;

create or replace function public.validate_teacher_student_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = new.teacher_id
      and p.role = 'teacher'
  ) then
    raise exception 'INVALID_TEACHER';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = new.student_id
      and p.role = 'student'
  ) then
    raise exception 'INVALID_STUDENT';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$function$;

revoke execute on function public.validate_teacher_student_relationship()
  from public, anon, authenticated;
grant execute on function public.validate_teacher_student_relationship()
  to service_role;

create trigger teacher_students_validate_roles
before insert or update on public.teacher_students
for each row execute function public.validate_teacher_student_relationship();

-- Backfill from the most recent lesson whose teacher still has a teacher profile.
-- This preserves the most recent real teacher/student relationship if historical
-- data ever contains more than one teacher for the same student.
insert into public.teacher_students (teacher_id, student_id)
select x.teacher_id, x.student_id
from (
  select distinct on (l.student_id)
    l.teacher_id,
    l.student_id
  from public.lessons l
  join public.profiles teacher
    on teacher.id = l.teacher_id
   and teacher.role = 'teacher'
  join public.profiles student
    on student.id = l.student_id
   and student.role = 'student'
  order by l.student_id, l.starts_at desc
) x
on conflict (teacher_id, student_id) do nothing;

-- Students without lessons cannot reveal their teacher from history. In the
-- current installation there is one active teacher, so link them to that teacher.
-- If the production data ever contains multiple active teachers, abort instead
-- of making an arbitrary assignment.
do $block$
declare
  v_active_teacher_count integer;
  v_active_teacher_id uuid;
  v_unlinked_count integer;
begin
  select count(*)
  into v_active_teacher_count
  from public.profiles p
  where p.role = 'teacher'
    and p.is_active = true;

  if v_active_teacher_count = 1 then
    select p.id
    into v_active_teacher_id
    from public.profiles p
    where p.role = 'teacher'
      and p.is_active = true
    limit 1;
  end if;

  select count(*)
  into v_unlinked_count
  from public.profiles s
  where s.role = 'student'
    and not exists (
      select 1
      from public.teacher_students rel
      where rel.student_id = s.id
        and rel.is_active = true
    );

  if v_unlinked_count > 0 then
    if v_active_teacher_count <> 1 then
      raise exception
        'TEACHER_STUDENT_BACKFILL_AMBIGUOUS: % unlinked students, % active teachers',
        v_unlinked_count,
        v_active_teacher_count;
    end if;

    insert into public.teacher_students (teacher_id, student_id)
    select v_active_teacher_id, s.id
    from public.profiles s
    where s.role = 'student'
      and not exists (
        select 1
        from public.teacher_students rel
        where rel.student_id = s.id
          and rel.is_active = true
      )
    on conflict (teacher_id, student_id)
    do update set
      is_active = true,
      updated_at = now();
  end if;
end;
$block$;

-- Defensive assertion: after backfill every student must have one active teacher.
do $block$
declare
  v_unlinked_count integer;
begin
  select count(*)
  into v_unlinked_count
  from public.profiles s
  where s.role = 'student'
    and not exists (
      select 1
      from public.teacher_students rel
      where rel.student_id = s.id
        and rel.is_active = true
    );

  if v_unlinked_count <> 0 then
    raise exception 'TEACHER_STUDENT_BACKFILL_INCOMPLETE: % students', v_unlinked_count;
  end if;
end;
$block$;

create policy "Teacher can view own student relationships"
on public.teacher_students
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

create policy "Student can view own teacher relationship"
on public.teacher_students
for select
to authenticated
using (student_id = auth.uid());

-- The application never mutates relationships directly from the browser.
revoke all on table public.teacher_students from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.teacher_students from authenticated;
grant select on table public.teacher_students to authenticated;
grant all on table public.teacher_students to service_role;

create or replace function public.is_my_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.teacher_students rel
    join public.profiles student
      on student.id = rel.student_id
    where rel.teacher_id = auth.uid()
      and rel.student_id = p_student_id
      and rel.is_active = true
      and student.role = 'student'
  );
$function$;

revoke execute on function public.is_my_student(uuid)
  from public, anon;
grant execute on function public.is_my_student(uuid)
  to authenticated, service_role;

create or replace function public.is_my_active_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.teacher_students rel
    join public.profiles student
      on student.id = rel.student_id
    where rel.teacher_id = auth.uid()
      and rel.student_id = p_student_id
      and rel.is_active = true
      and student.role = 'student'
      and student.is_active = true
  );
$function$;

revoke execute on function public.is_my_active_student(uuid)
  from public, anon, authenticated;
grant execute on function public.is_my_active_student(uuid)
  to service_role;

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
  join public.profiles teacher
    on teacher.id = rel.teacher_id
  where rel.student_id = v_user_id
    and rel.is_active = true
    and teacher.role = 'teacher'
    and teacher.is_active = true
  limit 1;

  if v_teacher_id is null then
    raise exception 'TEACHER_NOT_FOUND';
  end if;

  return v_teacher_id;
end;
$function$;

-- resolve_my_teacher_id() is an internal helper used by SECURITY DEFINER RPCs.
revoke execute on function public.resolve_my_teacher_id()
  from public, anon, authenticated;
grant execute on function public.resolve_my_teacher_id()
  to service_role;

commit;
