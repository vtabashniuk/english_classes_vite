-- Teacher can reject a student's cancellation request without cancelling the lesson.
-- Approved late cancellation with charge continues to notify the student with the
-- charged amount; approved early/waived cancellation continues to notify no charge.

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

  if p_action = 'reject' then
    update public.lesson_cancellation_requests
    set
      status = 'rejected',
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
      'lesson_cancellation_rejected',
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
    status = 'approved',
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
    'lesson_cancelled',
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
