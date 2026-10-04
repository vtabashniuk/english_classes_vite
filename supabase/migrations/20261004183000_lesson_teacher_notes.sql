-- Teacher-only notes attached to a concrete lesson.
-- The note already exists as lessons.teacher_note; this migration exposes it
-- only through teacher-scoped RPCs and removes direct Data API access to the
-- column for authenticated clients.

begin;

alter table public.lessons
  drop constraint if exists lessons_teacher_note_length_check;

alter table public.lessons
  add constraint lessons_teacher_note_length_check
  check (teacher_note is null or char_length(teacher_note) <= 5000);

create or replace function public.get_my_lesson_teacher_note(
  p_lesson_id uuid
)
returns table (
  teacher_note text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  return query
  select l.teacher_note, l.updated_at
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = auth.uid();

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;
end;
$function$;

create or replace function public.update_my_lesson_teacher_note(
  p_lesson_id uuid,
  p_teacher_note text
)
returns table (
  teacher_note text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_note text := nullif(trim(p_teacher_note), '');
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if v_note is not null and char_length(v_note) > 5000 then
    raise exception 'TEACHER_NOTE_TOO_LONG';
  end if;

  update public.lessons l
  set
    teacher_note = v_note,
    updated_at = now()
  where l.id = p_lesson_id
    and l.teacher_id = auth.uid();

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  return query
  select l.teacher_note, l.updated_at
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = auth.uid();
end;
$function$;

revoke all on function public.get_my_lesson_teacher_note(uuid)
  from public, anon, authenticated;
revoke all on function public.update_my_lesson_teacher_note(uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_my_lesson_teacher_note(uuid)
  to authenticated, service_role;
grant execute on function public.update_my_lesson_teacher_note(uuid, text)
  to authenticated, service_role;

-- RLS is row-based, so a normal SELECT grant on lessons would still let a
-- student request teacher_note for their own lesson. Replace the table-level
-- SELECT privilege with explicit public columns. Teachers read teacher_note
-- only through the guarded RPCs above.
revoke select on table public.lessons from authenticated;

grant select (
  id,
  student_id,
  teacher_id,
  recurring_lesson_id,
  starts_at,
  duration_minutes,
  zoom_url,
  created_at,
  updated_at,
  ends_at,
  cancelled_at,
  cancellation_reason,
  completed_at,
  missed_at,
  cancelled_by,
  status,
  pricing_date,
  price_amount_minor,
  price_currency,
  price_rate_id,
  cancellation_request_id,
  cancellation_charge_mode,
  cancellation_waiver_reason,
  occurrence_date,
  reschedule_price_policy_applied
) on public.lessons to authenticated;

grant select on table public.lessons to service_role;

comment on column public.lessons.teacher_note is
  'Private teacher-only note for this concrete lesson. Exposed to browser clients only through teacher-scoped RPCs.';

commit;
