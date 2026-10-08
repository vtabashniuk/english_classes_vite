-- Central learning-pause policy.
--
-- A pause may be initiated by either teacher or student and does not require
-- approval. The period is inclusive and may contain at most 14 calendar days,
-- counted from the selected pause start date (end <= start + 13 days).
--
-- Teacher-initiated pause: every affected future lesson is cancelled without
-- charge. Student-initiated pause: the existing free_cancellation_hours setting
-- is applied immediately; late affected lessons are cancelled with full charge.
-- Recurring series remain active during the short pause to reserve the recurring
-- slot, while concrete cancelled occurrences may be reused by one-time lessons
-- or one-time schedule blocks.

begin;

alter table public.teacher_students
  add column if not exists pause_from date,
  add column if not exists pause_initiated_by public.lesson_cancelled_by;

-- Existing dated pauses started immediately under the previous model.
update public.teacher_students rel
set pause_from = coalesce(
  rel.pause_from,
  (rel.status_changed_at at time zone coalesce(
    (select ts.schedule_timezone from public.teacher_settings ts where ts.teacher_id = rel.teacher_id),
    'Europe/Kyiv'
  ))::date
)
where rel.learning_status = 'paused'::public.student_learning_status
  and rel.pause_until is not null
  and rel.pause_from is null;

alter table public.teacher_students
  drop constraint if exists teacher_students_pause_until_status_check;
alter table public.teacher_students
  drop constraint if exists teacher_students_pause_period_status_check;
alter table public.teacher_students
  add constraint teacher_students_pause_period_status_check
  check (
    (
      learning_status = 'paused'::public.student_learning_status
      and pause_from is not null
      and pause_until is not null
      and pause_until >= pause_from
      and pause_until <= pause_from + 13
    )
    or
    (
      learning_status <> 'paused'::public.student_learning_status
      and pause_from is null
      and pause_until is null
      and pause_initiated_by is null
    )
  );

comment on column public.teacher_students.pause_from is
  'Inclusive first local date of a scheduled/active learning pause.';
comment on column public.teacher_students.pause_until is
  'Inclusive final local date of a learning pause. Maximum duration is 14 calendar days from pause_from.';
comment on column public.teacher_students.pause_initiated_by is
  'Who applied the current learning pause: teacher or student.';

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
  v_count integer := 0;
begin
  update public.teacher_students rel
  set
    learning_status = 'active'::public.student_learning_status,
    pause_from = null,
    pause_until = null,
    pause_initiated_by = null,
    status_changed_at = now(),
    status_changed_by = null,
    updated_at = now()
  where rel.is_active = true
    and rel.learning_status = 'paused'::public.student_learning_status
    and rel.pause_until is not null
    and rel.pause_until < public.get_teacher_local_date(rel.teacher_id)
    and (p_teacher_id is null or rel.teacher_id = p_teacher_id)
    and (p_student_id is null or rel.student_id = p_student_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.reconcile_expired_student_pauses(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_expired_student_pauses(uuid, uuid)
  to service_role;

-- "Active student" means eligible for new activity today. A future scheduled
-- pause does not restrict the student before pause_from.
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
    join public.profiles student on student.id = rel.student_id
    where rel.teacher_id = auth.uid()
      and rel.student_id = p_student_id
      and rel.is_active = true
      and (
        rel.learning_status = 'active'::public.student_learning_status
        or (
          rel.learning_status = 'paused'::public.student_learning_status
          and rel.pause_from is not null
          and rel.pause_until is not null
          and public.get_teacher_local_date(rel.teacher_id) not between rel.pause_from and rel.pause_until
        )
      )
      and student.role = 'student'
      and student.is_active = true
  );
$function$;

revoke execute on function public.is_my_active_student(uuid)
  from public, anon, authenticated;
grant execute on function public.is_my_active_student(uuid)
  to service_role;

-- Internal lesson cancellation used only by the central pause operation.
create or replace function public.cancel_lesson_for_learning_pause(
  p_lesson_id uuid,
  p_initiated_by public.lesson_cancelled_by
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lesson public.lessons%rowtype;
  v_free_hours smallint := 6;
  v_minutes_before integer := 0;
  v_is_late boolean := false;
  v_should_charge boolean := false;
  v_charge_mode public.lesson_cancellation_charge_mode;
  v_pending_request_id uuid;
  v_body_key text;
begin
  select l.* into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
  for update;

  if not found then raise exception 'LESSON_NOT_FOUND'; end if;
  if v_lesson.status <> 'scheduled'::public.lesson_status then return false; end if;
  if v_lesson.starts_at <= now() then return false; end if;

  select coalesce(ts.free_cancellation_hours, 6)
  into v_free_hours
  from public.teacher_settings ts
  where ts.teacher_id = v_lesson.teacher_id;

  v_minutes_before := greatest(
    floor(extract(epoch from (v_lesson.starts_at - now())) / 60)::integer,
    0
  );
  v_is_late := p_initiated_by = 'student'::public.lesson_cancelled_by
    and v_minutes_before < (coalesce(v_free_hours, 6)::integer * 60);
  v_should_charge := v_is_late;
  v_charge_mode := case
    when v_should_charge then 'charged'::public.lesson_cancellation_charge_mode
    else 'no_charge'::public.lesson_cancellation_charge_mode
  end;
  v_body_key := case
    when v_should_charge then 'notifications.lessonCancelled.pauseLateCharged'
    else 'notifications.lessonCancelled.pauseNoCharge'
  end;

  select r.id into v_pending_request_id
  from public.lesson_cancellation_requests r
  where r.lesson_id = p_lesson_id
    and r.status = 'pending'::public.lesson_cancellation_request_status
  limit 1;

  update public.lessons
  set
    status = 'cancelled'::public.lesson_status,
    cancelled_by = p_initiated_by,
    cancelled_at = now(),
    cancellation_reason = 'learning_pause',
    cancellation_request_id = v_pending_request_id,
    cancellation_charge_mode = v_charge_mode,
    cancellation_waiver_reason = null,
    updated_at = now()
  where id = p_lesson_id;

  -- Any pending reschedule request for this occurrence becomes stale as soon as
  -- the lesson is cancelled for the pause.
  perform public.expire_lesson_reschedule_requests_for_lesson(p_lesson_id);

  update public.lesson_cancellation_requests
  set
    status = 'approved'::public.lesson_cancellation_request_status,
    resolved_at = now(),
    resolved_by = case
      when p_initiated_by = 'teacher'::public.lesson_cancelled_by then v_lesson.teacher_id
      else v_lesson.student_id
    end,
    charge_mode = v_charge_mode,
    waiver_reason = null,
    updated_at = now()
  where lesson_id = p_lesson_id
    and status = 'pending'::public.lesson_cancellation_request_status;

  perform public.set_lesson_finance_charge_state(
    p_lesson_id,
    v_should_charge,
    case
      when v_should_charge then 'learning_pause_student_late_cancellation'
      when p_initiated_by = 'student'::public.lesson_cancelled_by then 'learning_pause_student_early_cancellation'
      else 'learning_pause_teacher_cancellation'
    end,
    v_lesson.starts_at
  );

  insert into public.notifications (
    user_id, type, lesson_id, title_key, body_key, data
  ) values (
    v_lesson.student_id,
    'lesson_cancelled'::public.notification_type,
    v_lesson.id,
    'notifications.lessonCancelled.title',
    v_body_key,
    jsonb_build_object(
      'lessonId', v_lesson.id,
      'startsAt', v_lesson.starts_at,
      'cancelledBy', p_initiated_by::text,
      'cancellationReason', 'learning_pause',
      'chargeMode', v_charge_mode::text,
      'priceAmountMinor', v_lesson.price_amount_minor,
      'priceCurrency', v_lesson.price_currency,
      'freeCancellationHours', coalesce(v_free_hours, 6),
      'minutesBeforeStart', v_minutes_before
    )
  );

  return v_should_charge;
end;
$function$;

revoke all on function public.cancel_lesson_for_learning_pause(uuid, public.lesson_cancelled_by)
  from public, anon, authenticated;
grant execute on function public.cancel_lesson_for_learning_pause(uuid, public.lesson_cancelled_by)
  to service_role;

create or replace function public.apply_student_learning_pause(
  p_pause_from date,
  p_pause_until date,
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
  cancelled_without_charge integer,
  cancelled_with_charge integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_teacher_id uuid;
  v_student_id uuid;
  v_initiated_by public.lesson_cancelled_by;
  v_today date;
  v_timezone text;
  v_student_name text;
  v_lesson record;
  v_series record;
  v_request record;
  v_charged boolean;
  v_free_count integer := 0;
  v_charged_count integer := 0;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED'; end if;

  if public.is_teacher() then
    v_teacher_id := v_actor_id;
    v_student_id := p_student_id;
    v_initiated_by := 'teacher'::public.lesson_cancelled_by;
    if v_student_id is null then raise exception 'STUDENT_REQUIRED'; end if;
  else
    v_student_id := v_actor_id;
    v_teacher_id := public.resolve_my_teacher_id();
    v_initiated_by := 'student'::public.lesson_cancelled_by;
    if p_student_id is not null and p_student_id <> v_student_id then
      raise exception 'STUDENT_MISMATCH';
    end if;
  end if;

  perform public.reconcile_expired_student_pauses(v_teacher_id, v_student_id);

  if not exists (
    select 1 from public.teacher_students rel
    join public.profiles p on p.id = rel.student_id
    where rel.teacher_id = v_teacher_id
      and rel.student_id = v_student_id
      and rel.is_active = true
      and p.role = 'student'
      and p.is_active = true
  ) then
    raise exception 'STUDENT_NOT_ASSIGNED_OR_INACTIVE';
  end if;

  if exists (
    select 1 from public.teacher_students rel
    where rel.teacher_id = v_teacher_id
      and rel.student_id = v_student_id
      and rel.learning_status = 'paused'::public.student_learning_status
  ) then
    raise exception 'STUDENT_ALREADY_PAUSED';
  end if;

  select ts.schedule_timezone into v_timezone
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;
  if not found then raise exception 'TEACHER_SETTINGS_NOT_FOUND'; end if;

  v_today := public.get_teacher_local_date(v_teacher_id);
  if p_pause_from is null then raise exception 'PAUSE_FROM_REQUIRED'; end if;
  if p_pause_until is null then raise exception 'PAUSE_UNTIL_REQUIRED'; end if;
  if p_pause_from < v_today then raise exception 'PAUSE_START_IN_PAST'; end if;
  if p_pause_until < p_pause_from then raise exception 'PAUSE_END_BEFORE_START'; end if;
  if p_pause_until > p_pause_from + 13 then raise exception 'PAUSE_TOO_LONG'; end if;

  -- Materialize the recurring series through the end of the pause so every
  -- affected occurrence can be cancelled explicitly while the series itself
  -- keeps reserving the regular slot from other recurring series.
  for v_series in
    select r.id
    from public.recurring_lessons r
    where r.teacher_id = v_teacher_id
      and r.student_id = v_student_id
      and r.is_active = true
      and (r.valid_until is null or r.valid_until >= p_pause_from)
  loop
    perform 1
    from public.materialize_recurring_lessons_internal(v_series.id, p_pause_until);
  end loop;

  update public.teacher_students rel
  set
    learning_status = 'paused'::public.student_learning_status,
    pause_from = p_pause_from,
    pause_until = p_pause_until,
    pause_initiated_by = v_initiated_by,
    status_changed_at = now(),
    status_changed_by = v_actor_id,
    updated_at = now()
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true;

  -- Only lessons whose LOCAL lesson date is inside the selected pause period
  -- are affected. Lessons before a future pause start remain untouched.
  for v_lesson in
    select l.id
    from public.lessons l
    where l.teacher_id = v_teacher_id
      and l.student_id = v_student_id
      and l.status = 'scheduled'::public.lesson_status
      and l.starts_at > now()
      and (l.starts_at at time zone v_timezone)::date between p_pause_from and p_pause_until
    order by l.starts_at
  loop
    v_charged := public.cancel_lesson_for_learning_pause(
      v_lesson.id,
      v_initiated_by
    );
    if v_charged then
      v_charged_count := v_charged_count + 1;
    else
      v_free_count := v_free_count + 1;
    end if;
  end loop;

  -- Pending extra-lesson requests targeting the pause period are no longer
  -- compatible with the pause. They are rejected without creating an approval
  -- workflow for the pause itself.
  for v_request in
    select r.id
    from public.lesson_requests r
    where r.teacher_id = v_teacher_id
      and r.student_id = v_student_id
      and r.status = 'pending'::public.lesson_request_status
      and r.request_type = 'extra_lesson'::public.lesson_request_type
      and (r.requested_starts_at at time zone v_timezone)::date between p_pause_from and p_pause_until
  loop
    -- Do not call the teacher-only reject RPC here: the pause may be initiated
    -- by the student. The pause itself is the resolution, so close the pending
    -- request atomically without a separate approval workflow.
    update public.lesson_requests
    set
      status = 'rejected'::public.lesson_request_status,
      resolution_comment = 'learning_pause',
      resolved_at = now(),
      resolved_by = v_actor_id
    where id = v_request.id
      and status = 'pending'::public.lesson_request_status;
  end loop;

  select coalesce(nullif(btrim(p.full_name), ''), p.email)
  into v_student_name
  from public.profiles p
  where p.id = v_student_id;

  -- Student always gets a confirmation of the applied pause and its duration.
  insert into public.notifications (
    user_id, type, title_key, body_key, data
  ) values (
    v_student_id,
    'learning_pause_applied'::public.notification_type,
    'notifications.learningPauseApplied.title',
    'notifications.learningPauseApplied.studentBody',
    jsonb_build_object(
      'pauseFrom', p_pause_from,
      'pauseUntil', p_pause_until,
      'initiatedBy', v_initiated_by::text,
      'cancelledWithoutCharge', v_free_count,
      'cancelledWithCharge', v_charged_count
    )
  );

  -- When the student applies the pause, the teacher is informed; no approval is
  -- requested or created.
  if v_initiated_by = 'student'::public.lesson_cancelled_by then
    insert into public.notifications (
      user_id, type, title_key, body_key, data
    ) values (
      v_teacher_id,
      'learning_pause_applied'::public.notification_type,
      'notifications.learningPauseApplied.title',
      'notifications.learningPauseApplied.teacherBody',
      jsonb_build_object(
        'studentName', v_student_name,
        'pauseFrom', p_pause_from,
        'pauseUntil', p_pause_until,
        'initiatedBy', 'student',
        'cancelledWithoutCharge', v_free_count,
        'cancelledWithCharge', v_charged_count
      )
    );
  end if;

  return query
  select
    rel.student_id,
    p.is_active,
    rel.learning_status,
    rel.status_changed_at,
    rel.pause_from,
    rel.pause_until,
    rel.pause_initiated_by,
    v_free_count,
    v_charged_count
  from public.teacher_students rel
  join public.profiles p on p.id = rel.student_id
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true;
end;
$function$;

revoke all on function public.apply_student_learning_pause(date, date, uuid)
  from public, anon;
grant execute on function public.apply_student_learning_pause(date, date, uuid)
  to authenticated, service_role;

-- Preserve the existing lifecycle RPC for active/inactive transitions. Old
-- callers that still send status=paused are routed through the central pause
-- operation with a start date of today. The return shape is extended, so the
-- previous function must be dropped first.
drop function if exists public.set_teacher_student_learning_status(
  uuid,
  public.student_learning_status,
  date
);

create function public.set_teacher_student_learning_status(
  p_student_id uuid,
  p_status public.student_learning_status,
  p_pause_until date default null
)
returns table (
  student_id uuid,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  status_changed_at timestamptz,
  pause_from date,
  pause_until date,
  pause_initiated_by public.lesson_cancelled_by
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid := auth.uid();
  v_now timestamptz := now();
  v_pause record;
  v_lesson record;
  v_request record;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  if p_status is null then raise exception 'INVALID_STUDENT_STATUS'; end if;

  if p_status = 'paused'::public.student_learning_status then
    select * into v_pause
    from public.apply_student_learning_pause(
      public.get_teacher_local_date(v_teacher_id),
      p_pause_until,
      p_student_id
    );

    return query select
      v_pause.student_id,
      v_pause.profile_is_active,
      v_pause.learning_status,
      v_pause.status_changed_at,
      v_pause.pause_from,
      v_pause.pause_until,
      v_pause.pause_initiated_by;
    return;
  end if;

  if not exists (
    select 1 from public.teacher_students rel
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true
  ) then raise exception 'STUDENT_NOT_ASSIGNED'; end if;

  if p_status = 'inactive'::public.student_learning_status then
    update public.teacher_students rel
    set
      learning_status = 'inactive'::public.student_learning_status,
      pause_from = null,
      pause_until = null,
      pause_initiated_by = null,
      status_changed_at = v_now,
      status_changed_by = v_teacher_id,
      updated_at = v_now
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true;

    update public.profiles p set is_active = false
    where p.id = p_student_id and p.role = 'student';

    update public.recurring_lessons r
    set is_active = false, lifecycle_suspended = true, updated_at = v_now
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.is_active = true;

    for v_lesson in
      select l.id from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.student_id = p_student_id
        and l.status = 'scheduled'::public.lesson_status
        and l.starts_at > v_now
      order by l.starts_at
    loop
      perform public.cancel_lesson(v_lesson.id, null);
    end loop;

    for v_request in
      select r.id from public.lesson_requests r
      where r.teacher_id = v_teacher_id
        and r.student_id = p_student_id
        and r.status = 'pending'::public.lesson_request_status
        and r.request_type = 'extra_lesson'::public.lesson_request_type
    loop
      perform public.reject_lesson_request(v_request.id, null);
    end loop;
  else
    update public.teacher_students rel
    set
      learning_status = 'active'::public.student_learning_status,
      pause_from = null,
      pause_until = null,
      pause_initiated_by = null,
      status_changed_at = v_now,
      status_changed_by = v_teacher_id,
      updated_at = v_now
    where rel.teacher_id = v_teacher_id
      and rel.student_id = p_student_id
      and rel.is_active = true;

    update public.profiles p set is_active = true
    where p.id = p_student_id and p.role = 'student';
  end if;

  return query
  select rel.student_id, p.is_active, rel.learning_status,
    rel.status_changed_at, rel.pause_from, rel.pause_until, rel.pause_initiated_by
  from public.teacher_students rel
  join public.profiles p on p.id = rel.student_id
  where rel.teacher_id = v_teacher_id
    and rel.student_id = p_student_id
    and rel.is_active = true;
end;
$function$;

revoke all on function public.set_teacher_student_learning_status(uuid, public.student_learning_status, date)
  from public, anon;
grant execute on function public.set_teacher_student_learning_status(uuid, public.student_learning_status, date)
  to authenticated, service_role;

-- Recreate lifecycle read RPCs with pause_from and pause state details.
drop function if exists public.get_teacher_student_lifecycle(uuid);
create function public.get_teacher_student_lifecycle(p_student_id uuid)
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
declare v_today date;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  perform public.reconcile_expired_student_pauses(auth.uid(), p_student_id);
  v_today := public.get_teacher_local_date(auth.uid());

  return query
  select rel.student_id, p.is_active, rel.learning_status, rel.status_changed_at,
    rel.pause_from, rel.pause_until, rel.pause_initiated_by,
    (rel.learning_status = 'paused'::public.student_learning_status
      and v_today between rel.pause_from and rel.pause_until)
  from public.teacher_students rel
  join public.profiles p on p.id = rel.student_id
  where rel.teacher_id = auth.uid()
    and rel.student_id = p_student_id
    and rel.is_active = true
    and p.role = 'student';
end;
$function$;
revoke all on function public.get_teacher_student_lifecycle(uuid) from public, anon;
grant execute on function public.get_teacher_student_lifecycle(uuid) to authenticated, service_role;

drop function if exists public.get_my_student_lifecycle();
create function public.get_my_student_lifecycle()
returns table (
  teacher_id uuid,
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
  v_student_id uuid := auth.uid();
  v_teacher_id uuid;
  v_today date;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;
  v_teacher_id := public.resolve_my_teacher_id();
  perform public.reconcile_expired_student_pauses(v_teacher_id, v_student_id);
  v_today := public.get_teacher_local_date(v_teacher_id);

  return query
  select rel.teacher_id, rel.learning_status, rel.status_changed_at,
    rel.pause_from, rel.pause_until, rel.pause_initiated_by,
    (rel.learning_status = 'paused'::public.student_learning_status
      and v_today between rel.pause_from and rel.pause_until)
  from public.teacher_students rel
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true
  limit 1;
end;
$function$;
revoke all on function public.get_my_student_lifecycle() from public, anon;
grant execute on function public.get_my_student_lifecycle() to authenticated, service_role;

-- Preserve debtor grouping fields and add pause_from / pause state.
drop function if exists public.list_teacher_students_lifecycle();
create function public.list_teacher_students_lifecycle()
returns table (
  student_id uuid,
  email text,
  full_name text,
  phone text,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  created_at timestamptz,
  status_changed_at timestamptz,
  pause_from date,
  pause_until date,
  pause_initiated_by public.lesson_cancelled_by,
  pause_is_active boolean,
  is_financially_blocked boolean,
  manual_unlock_active boolean,
  financial_access_restricted boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare v_today date;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  perform public.reconcile_expired_student_pauses(auth.uid(), null);
  v_today := public.get_teacher_local_date(auth.uid());

  return query
  select p.id, p.email, p.full_name, p.phone, p.is_active,
    rel.learning_status, p.created_at, rel.status_changed_at,
    rel.pause_from, rel.pause_until, rel.pause_initiated_by,
    (rel.learning_status = 'paused'::public.student_learning_status
      and v_today between rel.pause_from and rel.pause_until),
    coalesce(policy.is_financially_blocked, false),
    coalesce(policy.manual_unlock_active, false),
    coalesce(policy.access_restricted, false)
  from public.teacher_students rel
  join public.profiles p on p.id = rel.student_id
  left join public.teacher_student_financial_access_policy policy
    on policy.teacher_id = rel.teacher_id and policy.student_id = rel.student_id
  where rel.teacher_id = auth.uid()
    and rel.is_active = true
    and p.role = 'student'
  order by p.full_name nulls last, p.email;
end;
$function$;
revoke all on function public.list_teacher_students_lifecycle() from public, anon;
grant execute on function public.list_teacher_students_lifecycle() to authenticated, service_role;

-- Student-side lifecycle guard: a future scheduled pause does not restrict the
-- student before pause_from; an active pause does.
create or replace function public.assert_current_student_learning_active()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid := auth.uid();
  v_teacher_id uuid;
  v_status public.student_learning_status;
  v_profile_active boolean;
  v_pause_from date;
  v_pause_until date;
  v_today date;
begin
  if v_student_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.is_teacher() then raise exception 'STUDENT_REQUIRED'; end if;
  v_teacher_id := public.resolve_my_teacher_id();
  perform public.reconcile_expired_student_pauses(v_teacher_id, v_student_id);
  v_today := public.get_teacher_local_date(v_teacher_id);

  select rel.learning_status, p.is_active, rel.pause_from, rel.pause_until
  into v_status, v_profile_active, v_pause_from, v_pause_until
  from public.teacher_students rel
  join public.profiles p on p.id = rel.student_id
  where rel.teacher_id = v_teacher_id
    and rel.student_id = v_student_id
    and rel.is_active = true;

  if not found then raise exception 'STUDENT_NOT_ASSIGNED'; end if;
  if v_status = 'paused'::public.student_learning_status
     and v_today between v_pause_from and v_pause_until then
    raise exception 'STUDENT_LEARNING_PAUSED';
  end if;
  if v_status = 'inactive'::public.student_learning_status
     or not coalesce(v_profile_active, false) then
    raise exception 'STUDENT_LEARNING_INACTIVE';
  end if;
end;
$function$;
revoke all on function public.assert_current_student_learning_active()
  from public, anon, authenticated;
grant execute on function public.assert_current_student_learning_active()
  to service_role;

commit;
