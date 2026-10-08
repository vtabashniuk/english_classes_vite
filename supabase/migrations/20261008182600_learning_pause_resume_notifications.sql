-- Central learning-pause resume flow and notifications.
--
-- Both teacher and student may end/cancel a pause. Natural expiry is reconciled
-- centrally and emits one notification to both parties when the lifecycle moves
-- from paused -> active.

begin;

create or replace function public.reconcile_expired_student_pauses(
  p_teacher_id uuid default null,
  p_student_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_student_name text;
  v_count integer := 0;
begin
  for v_row in
    select
      rel.teacher_id,
      rel.student_id,
      rel.pause_from,
      rel.pause_until,
      rel.pause_initiated_by
    from public.teacher_students rel
    where rel.is_active = true
      and rel.learning_status = 'paused'::public.student_learning_status
      and rel.pause_until is not null
      and rel.pause_until < public.get_teacher_local_date(rel.teacher_id)
      and (p_teacher_id is null or rel.teacher_id = p_teacher_id)
      and (p_student_id is null or rel.student_id = p_student_id)
    order by rel.teacher_id, rel.student_id
    for update
  loop
    update public.teacher_students rel
    set
      learning_status = 'active'::public.student_learning_status,
      pause_from = null,
      pause_until = null,
      pause_initiated_by = null,
      status_changed_at = now(),
      status_changed_by = null,
      updated_at = now()
    where rel.teacher_id = v_row.teacher_id
      and rel.student_id = v_row.student_id
      and rel.is_active = true
      and rel.learning_status = 'paused'::public.student_learning_status;

    if not found then
      continue;
    end if;

    select coalesce(nullif(btrim(p.full_name), ''), p.email)
    into v_student_name
    from public.profiles p
    where p.id = v_row.student_id;

    insert into public.notifications (
      user_id, type, title_key, body_key, data
    ) values (
      v_row.student_id,
      'learning_pause_ended'::public.notification_type,
      'notifications.learningPauseEnded.title',
      'notifications.learningPauseEnded.automaticStudentBody',
      jsonb_build_object(
        'studentName', v_student_name,
        'pauseFrom', v_row.pause_from,
        'pauseUntil', v_row.pause_until,
        'resumeReason', 'expired'
      )
    );

    insert into public.notifications (
      user_id, type, title_key, body_key, data
    ) values (
      v_row.teacher_id,
      'learning_pause_ended'::public.notification_type,
      'notifications.learningPauseEnded.title',
      'notifications.learningPauseEnded.automaticTeacherBody',
      jsonb_build_object(
        'studentName', v_student_name,
        'pauseFrom', v_row.pause_from,
        'pauseUntil', v_row.pause_until,
        'resumeReason', 'expired'
      )
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.reconcile_expired_student_pauses(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_expired_student_pauses(uuid, uuid)
  to service_role;

create or replace function public.resume_student_learning_pause(
  p_student_id uuid default null
)
returns table (
  student_id uuid,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  status_changed_at timestamptz,
  pause_from date,
  pause_until date,
  pause_initiated_by public.lesson_cancelled_by,
  pause_is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_teacher_id uuid;
  v_student_id uuid;
  v_today date;
  v_old_pause_from date;
  v_old_pause_until date;
  v_student_name text;
  v_was_active_pause boolean := false;
  v_student_body_key text;
  v_teacher_body_key text;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED'; end if;

  if public.is_teacher() then
    v_teacher_id := v_actor_id;
    v_student_id := p_student_id;
    if v_student_id is null then raise exception 'STUDENT_REQUIRED'; end if;
  else
    v_student_id := v_actor_id;
    v_teacher_id := public.resolve_my_teacher_id();
    if p_student_id is not null and p_student_id <> v_student_id then
      raise exception 'STUDENT_MISMATCH';
    end if;
  end if;

  -- If the pause already expired, central reconciliation performs the transition
  -- and sends the automatic end notifications exactly once.
  perform public.reconcile_expired_student_pauses(v_teacher_id, v_student_id);

  select rel.pause_from, rel.pause_until
  into v_old_pause_from, v_old_pause_until
  from public.teacher_students rel
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true
    and rel.learning_status = 'paused'::public.student_learning_status
  for update;

  if not found then raise exception 'STUDENT_NOT_PAUSED'; end if;

  v_today := public.get_teacher_local_date(v_teacher_id);
  v_was_active_pause := v_today between v_old_pause_from and v_old_pause_until;

  update public.teacher_students rel
  set
    learning_status = 'active'::public.student_learning_status,
    pause_from = null,
    pause_until = null,
    pause_initiated_by = null,
    status_changed_at = now(),
    status_changed_by = v_actor_id,
    updated_at = now()
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true
    and rel.learning_status = 'paused'::public.student_learning_status;

  select coalesce(nullif(btrim(p.full_name), ''), p.email)
  into v_student_name
  from public.profiles p
  where p.id = v_student_id;

  if v_was_active_pause then
    v_student_body_key := 'notifications.learningPauseEnded.studentBody';
    v_teacher_body_key := 'notifications.learningPauseEnded.teacherBody';
  else
    v_student_body_key := 'notifications.learningPauseEnded.scheduledStudentBody';
    v_teacher_body_key := 'notifications.learningPauseEnded.scheduledTeacherBody';
  end if;

  insert into public.notifications (
    user_id, type, title_key, body_key, data
  ) values (
    v_student_id,
    'learning_pause_ended'::public.notification_type,
    'notifications.learningPauseEnded.title',
    v_student_body_key,
    jsonb_build_object(
      'studentName', v_student_name,
      'pauseFrom', v_old_pause_from,
      'pauseUntil', v_old_pause_until,
      'resumeReason', case when v_was_active_pause then 'manual_resume' else 'scheduled_pause_cancelled' end,
      'resumedBy', case when public.is_teacher() then 'teacher' else 'student' end
    )
  );

  insert into public.notifications (
    user_id, type, title_key, body_key, data
  ) values (
    v_teacher_id,
    'learning_pause_ended'::public.notification_type,
    'notifications.learningPauseEnded.title',
    v_teacher_body_key,
    jsonb_build_object(
      'studentName', v_student_name,
      'pauseFrom', v_old_pause_from,
      'pauseUntil', v_old_pause_until,
      'resumeReason', case when v_was_active_pause then 'manual_resume' else 'scheduled_pause_cancelled' end,
      'resumedBy', case when public.is_teacher() then 'teacher' else 'student' end
    )
  );

  return query
  select
    rel.student_id,
    p.is_active,
    rel.learning_status,
    rel.status_changed_at,
    rel.pause_from,
    rel.pause_until,
    rel.pause_initiated_by,
    false
  from public.teacher_students rel
  join public.profiles p on p.id = rel.student_id
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true;
end;
$function$;

revoke all on function public.resume_student_learning_pause(uuid)
  from public, anon;
grant execute on function public.resume_student_learning_pause(uuid)
  to authenticated, service_role;

-- Lightweight authenticated reconciliation hook used before notification reads.
-- It makes natural pause-end notifications appear as soon as either party opens
-- the application, without requiring a page-specific lifecycle request.
create or replace function public.reconcile_my_expired_learning_pauses()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  if public.is_teacher() then
    return public.reconcile_expired_student_pauses(auth.uid(), null);
  end if;

  v_teacher_id := public.resolve_my_teacher_id();
  return public.reconcile_expired_student_pauses(v_teacher_id, auth.uid());
end;
$function$;

revoke all on function public.reconcile_my_expired_learning_pauses()
  from public, anon;
grant execute on function public.reconcile_my_expired_learning_pauses()
  to authenticated, service_role;

commit;
