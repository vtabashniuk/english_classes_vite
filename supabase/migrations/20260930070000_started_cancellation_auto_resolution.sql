-- Refine lesson cancellation lifecycle after lesson start.
--
-- Rules:
--   * missed <-> completed corrections are allowed; both are fully charged,
--     therefore switching between them does not change the balance;
--   * a pending EARLY student cancellation request automatically cancels the
--     lesson without charge once starts_at is reached;
--   * a pending LATE student cancellation request automatically cancels the
--     lesson once starts_at is reached, but leaves the financial decision
--     pending for the teacher (charge / waive);
--   * manual cancellation remains impossible once starts_at is reached;
--   * auto-missed processing must never process a lesson that had a pending
--     cancellation request at lesson start.

begin;

-- Process pending student cancellation requests whose lesson has started.
-- Early requests are fully resolved automatically (no charge).
-- Late requests cancel the lesson, but intentionally keep request.status=pending
-- until the teacher decides whether to charge or waive.
create or replace function public.process_started_lesson_cancellation_requests(
  p_lesson_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request record;
  v_early_cancelled integer := 0;
  v_late_payment_pending integer := 0;
begin
  for v_request in
    select
      r.id,
      r.lesson_id,
      r.teacher_id,
      r.student_id,
      r.requested_at,
      r.reason,
      r.is_late,
      r.minutes_before_start,
      r.free_cancellation_hours_snapshot,
      l.starts_at,
      l.ends_at,
      l.price_amount_minor,
      l.price_currency
    from public.lesson_cancellation_requests r
    join public.lessons l
      on l.id = r.lesson_id
    where r.status = 'pending'::public.lesson_cancellation_request_status
      and l.status = 'scheduled'::public.lesson_status
      and l.starts_at <= now()
      and (p_lesson_id is null or r.lesson_id = p_lesson_id)
    order by l.starts_at
    for update of r, l skip locked
  loop
    if v_request.is_late then
      -- The cancellation itself becomes effective automatically at lesson start,
      -- but the teacher still has to decide whether the late cancellation is
      -- charged or waived. NULL charge mode means "payment decision pending".
      update public.lessons
      set
        status = 'cancelled'::public.lesson_status,
        cancelled_by = 'student',
        cancelled_at = now(),
        cancellation_reason = v_request.reason,
        cancellation_request_id = v_request.id,
        cancellation_charge_mode = null,
        cancellation_waiver_reason = null,
        completed_at = null,
        missed_at = null,
        updated_at = now()
      where id = v_request.lesson_id
        and status = 'scheduled'::public.lesson_status;

      if found then
        v_late_payment_pending := v_late_payment_pending + 1;

        -- Mark the original request notification as handled visually and create
        -- a fresh notification explaining that only the payment decision remains.
        update public.notifications
        set is_read = true
        where user_id = v_request.teacher_id
          and lesson_id = v_request.lesson_id
          and type = 'lesson_cancellation_requested'::public.notification_type
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
          v_request.teacher_id,
          'lesson_cancellation_requested'::public.notification_type,
          v_request.lesson_id,
          'notifications.lessonCancellationAuto.teacherLateTitle',
          'notifications.lessonCancellationAuto.teacherLateBody',
          jsonb_build_object(
            'requestId', v_request.id,
            'lessonId', v_request.lesson_id,
            'startsAt', v_request.starts_at,
            'requestedAt', v_request.requested_at,
            'minutesBeforeStart', v_request.minutes_before_start,
            'priceAmountMinor', v_request.price_amount_minor,
            'priceCurrency', v_request.price_currency,
            'paymentDecisionPending', true
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
          v_request.student_id,
          'lesson_cancelled'::public.notification_type,
          v_request.lesson_id,
          'notifications.lessonCancellationAuto.studentLateTitle',
          'notifications.lessonCancellationAuto.studentLateBody',
          jsonb_build_object(
            'requestId', v_request.id,
            'lessonId', v_request.lesson_id,
            'startsAt', v_request.starts_at,
            'priceAmountMinor', v_request.price_amount_minor,
            'priceCurrency', v_request.price_currency,
            'paymentDecisionPending', true
          )
        );
      end if;
    else
      -- Early cancellation request: cancellation is automatically accepted at
      -- lesson start and is always free of charge.
      update public.lessons
      set
        status = 'cancelled'::public.lesson_status,
        cancelled_by = 'student',
        cancelled_at = now(),
        cancellation_reason = v_request.reason,
        cancellation_request_id = v_request.id,
        cancellation_charge_mode = 'no_charge'::public.lesson_cancellation_charge_mode,
        cancellation_waiver_reason = null,
        completed_at = null,
        missed_at = null,
        updated_at = now()
      where id = v_request.lesson_id
        and status = 'scheduled'::public.lesson_status;

      if found then
        update public.lesson_cancellation_requests
        set
          status = 'approved'::public.lesson_cancellation_request_status,
          resolved_at = now(),
          resolved_by = v_request.teacher_id,
          charge_mode = 'no_charge'::public.lesson_cancellation_charge_mode,
          waiver_reason = null,
          updated_at = now()
        where id = v_request.id
          and status = 'pending'::public.lesson_cancellation_request_status;

        perform public.set_lesson_finance_charge_state(
          v_request.lesson_id,
          false,
          'auto_early_student_cancellation',
          v_request.starts_at
        );

        update public.notifications
        set is_read = true
        where user_id = v_request.teacher_id
          and lesson_id = v_request.lesson_id
          and type = 'lesson_cancellation_requested'::public.notification_type
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
          v_request.teacher_id,
          'lesson_cancelled'::public.notification_type,
          v_request.lesson_id,
          'notifications.lessonCancellationAuto.teacherEarlyTitle',
          'notifications.lessonCancellationAuto.teacherEarlyBody',
          jsonb_build_object(
            'requestId', v_request.id,
            'lessonId', v_request.lesson_id,
            'startsAt', v_request.starts_at,
            'chargeMode', 'no_charge',
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
          v_request.student_id,
          'lesson_cancelled'::public.notification_type,
          v_request.lesson_id,
          'notifications.lessonCancellationAuto.studentEarlyTitle',
          'notifications.lessonCancellationAuto.studentEarlyBody',
          jsonb_build_object(
            'requestId', v_request.id,
            'lessonId', v_request.lesson_id,
            'startsAt', v_request.starts_at,
            'chargeMode', 'no_charge',
            'automatic', true
          )
        );

        v_early_cancelled := v_early_cancelled + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'earlyCancelled', v_early_cancelled,
    'latePaymentPending', v_late_payment_pending,
    'processedAt', now()
  );
end;
$function$;

revoke all on function public.process_started_lesson_cancellation_requests(uuid)
  from public, anon, authenticated;
grant execute on function public.process_started_lesson_cancellation_requests(uuid)
  to service_role;

-- Keep the old function name as a compatibility wrapper. It no longer expires
-- requests; it applies the business rules above.
create or replace function public.expire_started_lesson_cancellation_requests(
  p_lesson_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  v_result := public.process_started_lesson_cancellation_requests(p_lesson_id);
  return coalesce((v_result ->> 'earlyCancelled')::integer, 0)
       + coalesce((v_result ->> 'latePaymentPending')::integer, 0);
end;
$function$;

revoke all on function public.expire_started_lesson_cancellation_requests(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_started_lesson_cancellation_requests(uuid)
  to service_role;

-- Teacher outcome changes. Correcting missed <-> completed is explicitly
-- supported. Both statuses are fully charged, so no balance adjustment occurs
-- when switching between them.
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

  if v_starts_at > now() then
    raise exception 'LESSON_NOT_STARTED';
  end if;

  -- Close any student cancellation request that reached lesson start before
  -- allowing a lesson outcome. A pending request takes precedence over an
  -- outcome because the student had already requested cancellation in time.
  if v_current_status = 'scheduled'::public.lesson_status then
    perform public.process_started_lesson_cancellation_requests(p_lesson_id);

    select l.status
    into v_current_status
    from public.lessons l
    where l.id = p_lesson_id
      and l.teacher_id = v_teacher_id
    for update;
  end if;

  if v_current_status = 'cancelled'::public.lesson_status then
    raise exception 'LESSON_CANCELLED';
  end if;

  if v_current_status not in (
    'scheduled'::public.lesson_status,
    'completed'::public.lesson_status,
    'missed'::public.lesson_status
  ) then
    raise exception 'INVALID_LESSON_STATUS_TRANSITION';
  end if;

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

  -- completed and missed are both 100% charged. The charge-state helper is
  -- idempotent, so missed -> completed does not create another charge.
  perform public.set_lesson_finance_charge_state(
    p_lesson_id,
    true,
    format('lesson_status:%s_to_%s', v_current_status::text, p_status::text),
    v_starts_at
  );

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
      'lesson_status_changed'::public.notification_type,
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

-- Resolve a cancellation request. Before lesson start this preserves the
-- existing workflow. After lesson start only a LATE request may remain pending,
-- and the teacher resolves only the financial decision (charge / waive).
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
  v_started boolean;
  v_payment_pending boolean;
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

  v_started := v_lesson.starts_at <= now();

  -- Close the race between lesson start and the cron run.
  if v_started and v_lesson.status = 'scheduled'::public.lesson_status then
    perform public.process_started_lesson_cancellation_requests(v_lesson.id);

    select l.*
    into v_lesson
    from public.lessons l
    where l.id = v_request.lesson_id
      and l.teacher_id = v_teacher_id
    for update;

    select r.*
    into v_request
    from public.lesson_cancellation_requests r
    where r.id = p_request_id
      and r.teacher_id = v_teacher_id
    for update;
  end if;

  -- An early request is auto-approved once the lesson starts, so there is
  -- nothing left for the teacher to resolve.
  if v_request.status <> 'pending'::public.lesson_cancellation_request_status then
    raise exception 'CANCELLATION_REQUEST_NOT_PENDING';
  end if;

  v_payment_pending :=
    v_request.is_late
    and v_lesson.status = 'cancelled'::public.lesson_status
    and v_lesson.cancelled_by = 'student'
    and v_lesson.cancellation_request_id = v_request.id
    and v_lesson.cancellation_charge_mode is null;

  if v_payment_pending then
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
      raise exception 'LATE_CANCELLATION_PAYMENT_DECISION_REQUIRED';
    end if;

    update public.lessons
    set
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
          then 'late_student_cancellation_payment_decision_charged'
        else 'late_student_cancellation_payment_decision_waived'
      end,
      now()
    );

    update public.notifications
    set is_read = true
    where user_id = v_teacher_id
      and lesson_id = v_lesson.id
      and type = 'lesson_cancellation_requested'::public.notification_type
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
        end,
        'paymentDecisionAfterStart', true
      )
    );

    return;
  end if;

  -- From this point on, the lesson must still be scheduled and before start.
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
    status = 'cancelled'::public.lesson_status,
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

-- Lifecycle worker: started cancellation requests are processed before outcome
-- reminders / auto-missed logic, so they can never become missed by accident.
create or replace function public.process_lesson_outcome_automation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_activated_at timestamptz;
  v_cancellation_result jsonb;
  v_reminders integer := 0;
  v_auto_missed integer := 0;
  v_lesson public.lessons%rowtype;
begin
  select s.activated_at
  into v_activated_at
  from public.lesson_outcome_automation_state s
  where s.singleton = true;

  if v_activated_at is null then
    v_activated_at := now();
  end if;

  v_cancellation_result := public.process_started_lesson_cancellation_requests(null);

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

      -- Race protection: if a request reached starts_at since the first worker
      -- pass, process it before auto-missed.
      perform public.process_started_lesson_cancellation_requests(v_lesson.id);

      if not exists (
        select 1
        from public.lessons l2
        where l2.id = v_lesson.id
          and l2.status = 'scheduled'::public.lesson_status
      ) then
        continue;
      end if;

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
        raise warning 'Lesson outcome automation skipped lesson %: %',
          v_lesson.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'earlyAutoCancelled', coalesce((v_cancellation_result ->> 'earlyCancelled')::integer, 0),
    'latePaymentPending', coalesce((v_cancellation_result ->> 'latePaymentPending')::integer, 0),
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

-- Run every minute so automatic cancellation happens close to starts_at.
select cron.schedule(
  'lesson-outcome-automation',
  '* * * * *',
  'select public.process_lesson_outcome_automation();'
);

commit;
