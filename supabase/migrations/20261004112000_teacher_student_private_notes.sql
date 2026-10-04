-- Private teacher notes for a student profile.
-- Notes are relationship-specific and are never visible to the student.

begin;

create table public.teacher_student_private_notes (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (teacher_id, student_id),
  constraint teacher_student_private_notes_length_check
    check (char_length(note) <= 5000),
  constraint teacher_student_private_notes_different_users_check
    check (teacher_id <> student_id)
);

alter table public.teacher_student_private_notes enable row level security;

create policy "Teacher can view own student private notes"
on public.teacher_student_private_notes
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
  and public.is_my_student(student_id)
);

-- Browser clients only read the table. Writes go through the security-definer RPC
-- below so teacher_id always comes from auth.uid() and cannot be spoofed.
revoke all on table public.teacher_student_private_notes from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.teacher_student_private_notes from authenticated;
grant select on table public.teacher_student_private_notes to authenticated;
grant all on table public.teacher_student_private_notes to service_role;

create or replace function public.save_my_student_private_note(
  p_student_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_note text := coalesce(p_note, '');
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_student(p_student_id) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  if char_length(v_note) > 5000 then
    raise exception 'PRIVATE_NOTE_TOO_LONG';
  end if;

  if btrim(v_note) = '' then
    delete from public.teacher_student_private_notes
    where teacher_id = v_teacher_id
      and student_id = p_student_id;

    return;
  end if;

  insert into public.teacher_student_private_notes (
    teacher_id,
    student_id,
    note
  )
  values (
    v_teacher_id,
    p_student_id,
    v_note
  )
  on conflict (teacher_id, student_id)
  do update set
    note = excluded.note,
    updated_at = now();
end;
$function$;

revoke all on function public.save_my_student_private_note(uuid, text)
  from public, anon;
grant execute on function public.save_my_student_private_note(uuid, text)
  to authenticated, service_role;

commit;
