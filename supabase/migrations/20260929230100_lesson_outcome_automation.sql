-- Lesson lifecycle automation.
--
-- Rules:
--   * cancellation is impossible once starts_at has been reached;
--   * after the lesson ends, a scheduled lesson generates one teacher reminder;
--   * 18 hours after ends_at, an unresolved scheduled lesson becomes missed;
--   * missed lessons are charged in full using the lesson price snapshot;
--   * pending student cancellation requests expire once the lesson starts;
--   * historical lessons that had already ended before this feature was enabled
--     are not auto-processed (no surprise backfill / charges).

begin;

-- Supabase Cron is backed by pg_cron. The hosted platform supports this
-- extension and the job below calls a database function directly.
create extension if not exists pg_cron;

create table if not exists public.lesson_outcome_automation_state (
  singleton boolean primary key default true,
  activated_at timestamptz not null default now(),
  constraint lesson_outcome_automation_state_singleton_check
    check (singleton = true)
);

insert into public.lesson_outcome_automation_state (singleton, activated_at)
values (true, now())
on conflict (singleton) do nothing;

revoke all on table public.lesson_outcome_automation_state from anon, authenticated;
grant select, insert, update on table public.lesson_outcome_automation_state to service_role;

create unique index if not exists notifications_one_lesson_outcome_required_idx
  on public.notifications (user_id, lesson_id, type)
  where type = 'lesson_outcome_required'::public.notification_type;

create unique index if not exists notifications_one_lesson_auto_missed_idx
  on public.notifications (user_id, lesson_id, type)
  where type = 'lesson_auto_missed'::public.notification_type;

-- Expire pending student cancellation requests once the lesson has started.
-- The teacher_id is stored in resolved_by so the existing resolution invariant
-- remains valid; data.expiredAutomatically makes the system decision explicit.
create or replace function public.expire_started_lesson_cancellation_requests(
  p_lesson_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request record;
  v_count integer := 0;
begin
  for v_request in
    select
      r.id,
      r.lesson_id,
      r.teacher_id,
      r.student_id,
      l.starts_at
    from public.lesson_cancellation_requests r
    join public.lessons l
      on l.id = r.lesson_id
    where r.status = 'pending'::public.lesson_cancellation_request_status
      and l.starts_at <= now()
      and (p_lesson_id is null or r.lesson_id = p_lesson_id)
    order by l.starts_at
    for update of r skip locked
  loop
    update public.lesson_cancellation_requests
    set
      status = 'expired'::public.lesson_cancellation_request_status,
      resolved_at = now(),
      resolved_by = v_request.teacher_id,
      charge_mode = null,
      waiver_reason = null,
      updated_at = now()
    where id = v_request.id
      and status = 'pending'::public.lesson_cancellation_request_status;

    if found then
      v_count := v_count + 1;

      insert into public.notifications (
        user_id,
        type,
        lesson_id,
        title_key,
        body_key,
        data
      )
      values (
        v_request.student_id,
        'lesson_cancellation_expired'::public.notification_type,
        v_request.lesson_id,
        'notifications.lessonCancellationExpired.title',
        'notifications.lessonCancellationExpired.body',
        jsonb_build_object(
          'requestId', v_request.id,
          'lessonId', v_request.lesson_id,
          'startsAt', v_request.starts_at,
          'expiredAutomatically', true
        )
      );
    end if;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.expire_started_lesson_cancellation_requests(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_started_lesson_cancellation_requests(uuid)
  to service_role;

-- Teacher outcome changes now automatically expire a pending cancellation
-- request if the lesson has already started, then proceed normally.
create or replace function public.set_lesson_outcome(
  p_lesson_id uuid,
  p_status public.lesson_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_student_id uuid;
  v_current_status public.lesson_status;
  v_starts_at timestamptz;
  v_duration_minutes smallint;
  v_should_notify boolean := false;
  v_title_key text;
  v_body_key text;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_status not in (
    'completed'::public.lesson_status,
    'missed'::public.lesson_status
  ) then
    raise exception 'INVALID_LESSON_OUTCOME';
  end if;

  select
    l.student_id,
    l.status,
    l.starts_at,
    l.duration_minutes
  into
    v_student_id,
    v_current_status,
    v_starts_at,
    v_duration_minutes
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_current_status = 'cancelled'::public.lesson_status then
    raise exception 'LESSON_CANCELLED';
  end if;

  if v_starts_at > now() then
    raise exception 'LESSON_NOT_STARTED';
  end if;

  -- Once the lesson starts, cancellation is no longer possible. A previously
  -- submitted request can therefore no longer block the lesson outcome.
  perform public.expire_started_lesson_cancellation_requests(p_lesson_id);

  if v_current_status = p_status then
    return;
  end if;

  if p_status = 'missed'::public.lesson_status then
    v_should_notify := true;
    v_title_key := 'notifications.lessonStatusChanged.missed.title';
    v_body_key := 'notifications.lessonStatusChanged.missed.body';
  elsif p_status = 'completed'::public.lesson_status
        and v_current_status = 'missed'::public.lesson_status then
    v_should_notify := true;
    v_title_key := 'notifications.lessonStatusChanged.completed.title';
    v_body_key := 'notifications.lessonStatusChanged.completed.body';
  end if;

  if p_status = 'completed'::public.lesson_status then
    update public.lessons
    set
      status = 'completed',
      completed_at = now(),
      missed_at = null,
      updated_at = now()
    where id = p_lesson_id;
  else
    update public.lessons
    set
      status = 'missed',
      missed_at = now(),
      completed_at = null,
      updated_at = now()
    where id = p_lesson_id;
  end if;

  -- completed and missed are both charged 100%.
  perform public.set_lesson_finance_charge_state(
    p_lesson_id,
    true,
    format('lesson_status:%s_to_%s', v_current_status::text, p_status::text),
    v_starts_at
  );

  -- A stale "please update the lesson status" notification no longer needs
  -- attention once the teacher has set an outcome.
  update public.notifications
  set is_read = true
  where user_id = v_teacher_id
    and lesson_id = p_lesson_id
    and type = 'lesson_outcome_required'::public.notification_type
    and is_read = false;

  if v_should_notify then
    insert into public.notifications (
      user_id,
      type,
      lesson_id,
      title_key,
      body_key,
      data
    )
    values (
      v_student_id,
      'lesson_status_changed',
      p_lesson_id,
      v_title_key,
      v_body_key,
      jsonb_build_object(
        'lessonId', p_lesson_id,
        'startsAt', v_starts_at,
        'durationMinutes', v_duration_minutes,
        'oldStatus', v_current_status::text,
        'newStatus', p_status::text
      )
    );
  end if;
end;
$function$;

revoke all on function public.set_lesson_outcome(uuid, public.lesson_status)
  from public, anon, authenticated;
grant execute on function public.set_lesson_outcome(uuid, public.lesson_status)
  to authenticated, service_role;

-- Student cancellation resolution is also blocked server-side after starts_at.
-- This closes the race between the lesson starting and the 5-minute cron run.
create or replace function public.resolve_lesson_cancellation_request(
  p_request_id uuid,
  p_action text,
  p_waiver_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_request public.lesson_cancellation_requests%rowtype;
  v_lesson public.lessons%rowtype;
  v_charge_mode public.lesson_cancellation_charge_mode;
  v_should_charge boolean := false;
  v_body_key text;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select r.*
  into v_request
  from public.lesson_cancellation_requests r
  where r.id = p_request_id
    and r.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'CANCELLATION_REQUEST_NOT_FOUND';
  end if;

  if v_request.status <> 'pending'::public.lesson_cancellation_request_status then
    raise exception 'CANCELLATION_REQUEST_NOT_PENDING';
  end if;

  select l.*
  into v_lesson
  from public.lessons l
  where l.id = v_request.lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_lesson.status = 'cancelled'::public.lesson_status then
    raise exception 'LESSON_ALREADY_CANCELLED';
  end if;

  if v_lesson.status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;

  if v_lesson.starts_at <= now() then
    raise exception 'LESSON_ALREADY_STARTED_CANNOT_BE_CANCELLED';
  end if;

  if p_action = 'reject' then
    update public.lesson_cancellation_requests
    set
      status = 'rejected'::public.lesson_cancellation_request_status,
      resolved_at = now(),
      resolved_by = v_teacher_id,
      charge_mode = null,
      waiver_reason = null,
      updated_at = now()
    where id = v_request.id;

    insert into public.notifications (
      user_id,
      type,
      lesson_id,
      title_key,
      body_key,
      data
    )
    values (
      v_request.student_id,
      'lesson_cancellation_rejected'::public.notification_type,
      v_lesson.id,
      'notifications.lessonCancellationRejected.title',
      'notifications.lessonCancellationRejected.body',
      jsonb_build_object(
        'requestId', v_request.id,
        'lessonId', v_lesson.id,
        'startsAt', v_lesson.starts_at
      )
    );

    return;
  end if;

  if v_request.is_late then
    if p_action = 'cancel_charge' then
      v_charge_mode := 'charged'::public.lesson_cancellation_charge_mode;
      v_should_charge := true;
      v_body_key := 'notifications.lessonCancelled.studentLateCharged';
    elsif p_action = 'cancel_waive' then
      if nullif(btrim(p_waiver_reason), '') is null then
        raise exception 'WAIVER_REASON_REQUIRED';
      end if;
      v_charge_mode := 'waived'::public.lesson_cancellation_charge_mode;
      v_should_charge := false;
      v_body_key := 'notifications.lessonCancelled.studentLateWaived';
    else
      raise exception 'INVALID_LATE_CANCELLATION_ACTION';
    end if;
  else
    if p_action <> 'cancel' then
      raise exception 'INVALID_EARLY_CANCELLATION_ACTION';
    end if;
    v_charge_mode := 'no_charge'::public.lesson_cancellation_charge_mode;
    v_should_charge := false;
    v_body_key := 'notifications.lessonCancelled.studentEarly';
  end if;

  update public.lessons
  set
    status = 'cancelled',
    cancelled_by = 'student',
    cancelled_at = now(),
    cancellation_reason = v_request.reason,
    cancellation_request_id = v_request.id,
    cancellation_charge_mode = v_charge_mode,
    cancellation_waiver_reason = case
      when v_charge_mode = 'waived'::public.lesson_cancellation_charge_mode
        then nullif(btrim(p_waiver_reason), '')
      else null
    end,
    updated_at = now()
  where id = v_lesson.id;

  update public.lesson_cancellation_requests
  set
    status = 'approved'::public.lesson_cancellation_request_status,
    resolved_at = now(),
    resolved_by = v_teacher_id,
    charge_mode = v_charge_mode,
    waiver_reason = case
      when v_charge_mode = 'waived'::public.lesson_cancellation_charge_mode
        then nullif(btrim(p_waiver_reason), '')
      else null
    end,
    updated_at = now()
  where id = v_request.id;

  perform public.set_lesson_finance_charge_state(
    v_lesson.id,
    v_should_charge,
    case
      when v_charge_mode = 'charged'::public.lesson_cancellation_charge_mode
        then 'late_student_cancellation'
      when v_charge_mode = 'waived'::public.lesson_cancellation_charge_mode
        then 'late_student_cancellation_waived'
      else 'early_student_cancellation'
    end,
    now()
  );

  insert into public.notifications (
    user_id,
    type,
    lesson_id,
    title_key,
    body_key,
    data
  )
  values (
    v_request.student_id,
    'lesson_cancelled'::public.notification_type,
    v_lesson.id,
    'notifications.lessonCancelled.title',
    v_body_key,
    jsonb_build_object(
      'requestId', v_request.id,
      'lessonId', v_lesson.id,
      'startsAt', v_lesson.starts_at,
      'chargeMode', v_charge_mode::text,
      'priceAmountMinor', v_lesson.price_amount_minor,
      'priceCurrency', v_lesson.price_currency,
      'waiverReason', case
        when v_charge_mode = 'waived'::public.lesson_cancellation_charge_mode
          then nullif(btrim(p_waiver_reason), '')
        else null
      end
    )
  );
end;
$function$;

revoke all on function public.resolve_lesson_cancellation_request(uuid, text, text)
  from public, anon;
grant execute on function public.resolve_lesson_cancellation_request(uuid, text, text)
  to authenticated, service_role;

-- Server-side lifecycle worker. Runs from Supabase Cron every 5 minutes.
create or replace function public.process_lesson_outcome_automation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_activated_at timestamptz;
  v_expired_requests integer := 0;
  v_reminders integer := 0;
  v_auto_missed integer := 0;
  v_lesson public.lessons%rowtype;
  v_inserted integer;
begin
  select s.activated_at
  into v_activated_at
  from public.lesson_outcome_automation_state s
  where s.singleton = true;

  if v_activated_at is null then
    v_activated_at := now();
  end if;

  v_expired_requests := public.expire_started_lesson_cancellation_requests(null);

  -- Reminder after the planned lesson has ended. Only lessons that had not
  -- already ended when this feature was activated are eligible, preventing an
  -- accidental historical notification/backfill storm.
  insert into public.notifications (
    user_id,
    type,
    lesson_id,
    title_key,
    body_key,
    data
  )
  select
    l.teacher_id,
    'lesson_outcome_required'::public.notification_type,
    l.id,
    'notifications.lessonOutcomeRequired.title',
    'notifications.lessonOutcomeRequired.body',
    jsonb_build_object(
      'lessonId', l.id,
      'startsAt', l.starts_at,
      'endsAt', l.ends_at,
      'durationMinutes', l.duration_minutes,
      'autoMissedAt', l.ends_at + interval '18 hours',
      'graceHours', 18,
      'priceAmountMinor', l.price_amount_minor,
      'priceCurrency', l.price_currency
    )
  from public.lessons l
  where l.status = 'scheduled'::public.lesson_status
    and l.ends_at <= now()
    and l.ends_at >= v_activated_at
    and l.ends_at > now() - interval '18 hours'
  on conflict do nothing;

  get diagnostics v_reminders = row_count;

  -- After 18 hours, automatically mark still-scheduled lessons as missed.
  -- A lesson without a price snapshot is deliberately left scheduled because
  -- our business rule requires a missed lesson to be charged in full.
  for v_lesson in
    select l.*
    from public.lessons l
    where l.status = 'scheduled'::public.lesson_status
      and l.ends_at <= now() - interval '18 hours'
      and l.ends_at >= v_activated_at
    order by l.ends_at
    for update skip locked
  loop
    begin
      if v_lesson.price_amount_minor is null
         or v_lesson.price_currency is null
         or v_lesson.price_rate_id is null then
        continue;
      end if;

      perform public.expire_started_lesson_cancellation_requests(v_lesson.id);

      update public.lessons
      set
        status = 'missed'::public.lesson_status,
        missed_at = now(),
        completed_at = null,
        updated_at = now()
      where id = v_lesson.id
        and status = 'scheduled'::public.lesson_status;

      if not found then
        continue;
      end if;

      perform public.set_lesson_finance_charge_state(
        v_lesson.id,
        true,
        'auto_missed_after_18_hours',
        v_lesson.starts_at
      );

      update public.notifications
      set is_read = true
      where user_id = v_lesson.teacher_id
        and lesson_id = v_lesson.id
        and type = 'lesson_outcome_required'::public.notification_type
        and is_read = false;

      insert into public.notifications (
        user_id,
        type,
        lesson_id,
        title_key,
        body_key,
        data
      )
      values (
        v_lesson.student_id,
        'lesson_status_changed'::public.notification_type,
        v_lesson.id,
        'notifications.lessonStatusChanged.missed.title',
        'notifications.lessonStatusChanged.missed.body',
        jsonb_build_object(
          'lessonId', v_lesson.id,
          'startsAt', v_lesson.starts_at,
          'durationMinutes', v_lesson.duration_minutes,
          'oldStatus', 'scheduled',
          'newStatus', 'missed',
          'automatic', true
        )
      );

      insert into public.notifications (
        user_id,
        type,
        lesson_id,
        title_key,
        body_key,
        data
      )
      values (
        v_lesson.teacher_id,
        'lesson_auto_missed'::public.notification_type,
        v_lesson.id,
        'notifications.lessonAutoMissed.title',
        'notifications.lessonAutoMissed.body',
        jsonb_build_object(
          'lessonId', v_lesson.id,
          'startsAt', v_lesson.starts_at,
          'endsAt', v_lesson.ends_at,
          'durationMinutes', v_lesson.duration_minutes,
          'graceHours', 18,
          'priceAmountMinor', v_lesson.price_amount_minor,
          'priceCurrency', v_lesson.price_currency
        )
      )
      on conflict do nothing;

      v_auto_missed := v_auto_missed + 1;
    exception
      when others then
        -- Keep one malformed legacy lesson from blocking automation for every
        -- other teacher/lesson. The cron run remains observable in pg_cron.
        raise warning 'Lesson outcome automation skipped lesson %: %',
          v_lesson.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'expiredCancellationRequests', v_expired_requests,
    'createdReminders', v_reminders,
    'autoMissedLessons', v_auto_missed,
    'processedAt', now()
  );
end;
$function$;

revoke all on function public.process_lesson_outcome_automation()
  from public, anon, authenticated;
grant execute on function public.process_lesson_outcome_automation()
  to service_role;

-- Named jobs are overwritten when scheduled again with the same name.
select cron.schedule(
  'lesson-outcome-automation',
  '*/5 * * * *',
  'select public.process_lesson_outcome_automation();'
);

commit;
