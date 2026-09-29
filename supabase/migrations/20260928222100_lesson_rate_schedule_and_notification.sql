-- Lesson-rate scheduling + student notification.
-- New rates may start today or in the future, never in the past.
-- Saving a real rate change creates an in-app notification for the student
-- in the same transaction as the rate change.

begin;

-- ---------------------------------------------------------------------------
-- Read model: nearest future rate for each teacher/student relationship.
-- ---------------------------------------------------------------------------

create or replace view public.student_next_lesson_rates
with (security_invoker = true)
as
select distinct on (r.teacher_id, r.student_id)
  r.id,
  r.teacher_id,
  r.student_id,
  r.amount_minor,
  r.currency,
  r.effective_from,
  r.effective_to,
  r.created_at,
  r.updated_at
from public.student_lesson_rates r
where r.effective_from > current_date
order by r.teacher_id, r.student_id, r.effective_from asc;

comment on view public.student_next_lesson_rates is
  'Nearest scheduled future lesson rate for each teacher/student relationship.';

revoke all on table public.student_next_lesson_rates from anon, authenticated;
grant select on table public.student_next_lesson_rates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Replace set_student_lesson_rate with scheduling + notification semantics.
--
-- Rules:
-- - effective_from must be today or later;
-- - a row with the same effective_from can be edited before it takes effect;
-- - a new row closes the overlapping previous rate and stops at the next
--   already-scheduled rate, if one exists;
-- - saving the same price/currency as the effective rate is rejected as a no-op;
-- - a successful meaningful change creates exactly one student notification;
-- - the notification is transactional: if it cannot be created, the rate
--   change is rolled back too.
-- ---------------------------------------------------------------------------

create or replace function public.set_student_lesson_rate(
  p_student_id uuid,
  p_amount_minor bigint,
  p_currency public.finance_currency,
  p_effective_from date default current_date
)
returns public.student_lesson_rates
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_next_from date;
  v_existing_id uuid;
  v_existing_amount bigint;
  v_existing_currency public.finance_currency;
  v_previous_amount bigint;
  v_previous_currency public.finance_currency;
  v_result public.student_lesson_rates%rowtype;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_ASSIGNED';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'INVALID_LESSON_RATE';
  end if;

  if p_effective_from is null or p_effective_from < current_date then
    raise exception 'LESSON_RATE_PAST_DATE_NOT_ALLOWED';
  end if;

  -- Serialize rate changes for this student.
  perform r.id
  from public.student_lesson_rates r
  where r.teacher_id = v_teacher_id
    and r.student_id = p_student_id
  order by r.effective_from
  for update;

  -- If a rate already starts on this exact date, it is the row being edited.
  select
    r.id,
    r.amount_minor,
    r.currency
  into
    v_existing_id,
    v_existing_amount,
    v_existing_currency
  from public.student_lesson_rates r
  where r.teacher_id = v_teacher_id
    and r.student_id = p_student_id
    and r.effective_from = p_effective_from
  limit 1;

  if v_existing_id is not null then
    if v_existing_amount = p_amount_minor
       and v_existing_currency = p_currency then
      raise exception 'LESSON_RATE_UNCHANGED';
    end if;

    v_previous_amount := v_existing_amount;
    v_previous_currency := v_existing_currency;

    update public.student_lesson_rates
    set
      amount_minor = p_amount_minor,
      currency = p_currency,
      updated_at = now()
    where id = v_existing_id
    returning * into v_result;
  else
    -- Rate that would apply immediately before/at the new start date.
    select
      r.amount_minor,
      r.currency
    into
      v_previous_amount,
      v_previous_currency
    from public.student_lesson_rates r
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.effective_from < p_effective_from
      and (r.effective_to is null or r.effective_to > p_effective_from)
    order by r.effective_from desc
    limit 1;

    if v_previous_amount = p_amount_minor
       and v_previous_currency = p_currency then
      raise exception 'LESSON_RATE_UNCHANGED';
    end if;

    select min(r.effective_from)
    into v_next_from
    from public.student_lesson_rates r
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.effective_from > p_effective_from;

    -- Close the rate that overlaps the new start date.
    update public.student_lesson_rates r
    set
      effective_to = p_effective_from,
      updated_at = now()
    where r.teacher_id = v_teacher_id
      and r.student_id = p_student_id
      and r.effective_from < p_effective_from
      and (r.effective_to is null or r.effective_to > p_effective_from);

    insert into public.student_lesson_rates (
      teacher_id,
      student_id,
      amount_minor,
      currency,
      effective_from,
      effective_to
    )
    values (
      v_teacher_id,
      p_student_id,
      p_amount_minor,
      p_currency,
      p_effective_from,
      v_next_from
    )
    returning * into v_result;
  end if;

  -- Ensure finance settings exist. The stored billing currency is a fallback;
  -- the effective lesson rate is the source of truth for the current tariff.
  insert into public.student_billing_settings (
    teacher_id,
    student_id,
    billing_currency
  )
  values (
    v_teacher_id,
    p_student_id,
    p_currency
  )
  on conflict (teacher_id, student_id)
  do update set
    billing_currency = case
      when p_effective_from = current_date then excluded.billing_currency
      else public.student_billing_settings.billing_currency
    end,
    updated_at = now();

  insert into public.notifications (
    user_id,
    type,
    title_key,
    body_key,
    data
  )
  values (
    p_student_id,
    'lesson_rate_changed'::public.notification_type,
    'notifications.lessonRateChanged.title',
    'notifications.lessonRateChanged.body',
    jsonb_strip_nulls(
      jsonb_build_object(
        'rateId', v_result.id,
        'oldAmountMinor', v_previous_amount,
        'oldCurrency', v_previous_currency,
        'newAmountMinor', p_amount_minor,
        'newCurrency', p_currency,
        'effectiveFrom', p_effective_from,
        'changedBy', v_teacher_id
      )
    )
  );

  return v_result;
end;
$function$;

revoke execute on function public.set_student_lesson_rate(
  uuid,
  bigint,
  public.finance_currency,
  date
) from public, anon;

grant execute on function public.set_student_lesson_rate(
  uuid,
  bigint,
  public.finance_currency,
  date
) to authenticated, service_role;

commit;
