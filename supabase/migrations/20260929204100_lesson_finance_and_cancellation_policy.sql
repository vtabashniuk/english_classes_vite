-- Finance Step 9: lesson charging + cancellation-request policy.
--
-- Final business rules:
--   completed                         -> charge 100%
--   missed                            -> charge 100%
--   student request >= free window    -> cancel with no charge
--   student request < free window     -> charge 100% unless teacher waives
--   teacher cancellation              -> never charge
--
-- Important: early/late classification is frozen at the moment the student
-- submits the cancellation request, not when the teacher reviews it.

begin;

-- ---------------------------------------------------------------------------
-- Finance preference: free cancellation window.
-- ---------------------------------------------------------------------------

alter table public.teacher_settings
  add column if not exists free_cancellation_hours smallint not null default 6;

alter table public.teacher_settings
  drop constraint if exists teacher_settings_free_cancellation_hours_check;

alter table public.teacher_settings
  add constraint teacher_settings_free_cancellation_hours_check
  check (free_cancellation_hours between 1 and 168);

comment on column public.teacher_settings.free_cancellation_hours is
  'Student cancellation requests submitted at least this many hours before lesson start are free of charge. Default: 6.';

-- Keep the previous one-argument overload for backwards compatibility while
-- adding the new preference-aware overload used by Step 9 UI.
create or replace function public.update_my_finance_preferences(
  p_low_balance_threshold_lessons smallint,
  p_free_cancellation_hours smallint
)
returns public.teacher_settings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result public.teacher_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_low_balance_threshold_lessons is null
     or p_low_balance_threshold_lessons < 1
     or p_low_balance_threshold_lessons > 20 then
    raise exception 'INVALID_LOW_BALANCE_THRESHOLD';
  end if;

  if p_free_cancellation_hours is null
     or p_free_cancellation_hours < 1
     or p_free_cancellation_hours > 168 then
    raise exception 'INVALID_FREE_CANCELLATION_HOURS';
  end if;

  update public.teacher_settings
  set
    low_balance_threshold_lessons = p_low_balance_threshold_lessons,
    free_cancellation_hours = p_free_cancellation_hours,
    updated_at = now()
  where teacher_id = auth.uid()
  returning * into v_result;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.update_my_finance_preferences(smallint, smallint)
  from public, anon;
grant execute on function public.update_my_finance_preferences(smallint, smallint)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cancellation request model.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'lesson_cancellation_request_status'
  ) then
    create type public.lesson_cancellation_request_status as enum (
      'pending',
      'approved'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'lesson_cancellation_charge_mode'
  ) then
    create type public.lesson_cancellation_charge_mode as enum (
      'no_charge',
      'charged',
      'waived'
    );
  end if;
end
$$;

create table if not exists public.lesson_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  teacher_id uuid not null,
  student_id uuid not null,
  status public.lesson_cancellation_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  reason text,
  free_cancellation_hours_snapshot smallint not null,
  minutes_before_start integer not null,
  is_late boolean not null,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  charge_mode public.lesson_cancellation_charge_mode,
  waiver_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_cancellation_requests_teacher_student_fkey
    foreign key (teacher_id, student_id)
    references public.teacher_students(teacher_id, student_id)
    on delete cascade,
  constraint lesson_cancellation_requests_free_hours_check
    check (free_cancellation_hours_snapshot between 1 and 168),
  constraint lesson_cancellation_requests_minutes_check
    check (minutes_before_start >= 0),
  constraint lesson_cancellation_requests_resolution_check
    check (
      (status = 'pending' and resolved_at is null and resolved_by is null and charge_mode is null)
      or
      (status <> 'pending' and resolved_at is not null and resolved_by is not null)
    ),
  constraint lesson_cancellation_requests_waiver_check
    check (
      charge_mode <> 'waived'
      or nullif(btrim(waiver_reason), '') is not null
    )
);

create unique index if not exists lesson_cancellation_requests_one_pending_idx
  on public.lesson_cancellation_requests (lesson_id)
  where status = 'pending'::public.lesson_cancellation_request_status;

create index if not exists lesson_cancellation_requests_teacher_status_idx
  on public.lesson_cancellation_requests (teacher_id, status, requested_at desc);

create index if not exists lesson_cancellation_requests_student_status_idx
  on public.lesson_cancellation_requests (student_id, status, requested_at desc);

alter table public.lesson_cancellation_requests enable row level security;

drop policy if exists "Users can view related lesson cancellation requests"
  on public.lesson_cancellation_requests;
create policy "Users can view related lesson cancellation requests"
  on public.lesson_cancellation_requests
  for select
  to authenticated
  using (auth.uid() = teacher_id or auth.uid() = student_id);

revoke all on table public.lesson_cancellation_requests from anon, authenticated;
grant select on table public.lesson_cancellation_requests to authenticated;
grant select, insert, update, delete on table public.lesson_cancellation_requests to service_role;

comment on table public.lesson_cancellation_requests is
  'Student lesson-cancellation requests. Early/late classification and the cancellation-window setting are snapshotted at request time.';

-- Keep the resolved financial decision directly visible on the lesson as well.
alter table public.lessons
  add column if not exists cancellation_request_id uuid,
  add column if not exists cancellation_charge_mode public.lesson_cancellation_charge_mode,
  add column if not exists cancellation_waiver_reason text;

alter table public.lessons
  drop constraint if exists lessons_cancellation_request_id_fkey;
alter table public.lessons
  add constraint lessons_cancellation_request_id_fkey
  foreign key (cancellation_request_id)
  references public.lesson_cancellation_requests(id)
  on delete set null;

comment on column public.lessons.cancellation_charge_mode is
  'Resolved finance decision for a cancelled lesson: no_charge, charged, or waived.';

-- ---------------------------------------------------------------------------
-- Internal immutable-ledger helper.
-- ---------------------------------------------------------------------------

create or replace function public.set_lesson_finance_charge_state(
  p_lesson_id uuid,
  p_should_charge boolean,
  p_reason text default null,
  p_effective_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lesson public.lessons%rowtype;
  v_root public.student_finance_transactions%rowtype;
  v_head public.student_finance_transactions%rowtype;
  v_head_id uuid;
  v_head_depth integer := 0;
  v_is_charged boolean := false;
begin
  select l.*
  into v_lesson
  from public.lessons l
  where l.id = p_lesson_id;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  select t.*
  into v_root
  from public.student_finance_transactions t
  where t.lesson_id = p_lesson_id
    and t.transaction_type = 'lesson_charge'::public.finance_transaction_type
  limit 1;

  if not found then
    if not p_should_charge then
      return;
    end if;

    if v_lesson.price_amount_minor is null
       or v_lesson.price_currency is null
       or v_lesson.price_rate_id is null then
      raise exception 'LESSON_PRICE_NOT_SET';
    end if;

    insert into public.student_finance_transactions (
      teacher_id,
      student_id,
      transaction_type,
      amount_minor,
      currency,
      lesson_id,
      description,
      metadata,
      effective_at,
      created_by
    )
    values (
      v_lesson.teacher_id,
      v_lesson.student_id,
      'lesson_charge'::public.finance_transaction_type,
      -v_lesson.price_amount_minor,
      v_lesson.price_currency,
      v_lesson.id,
      null,
      jsonb_build_object(
        'reason', coalesce(p_reason, 'lesson_outcome'),
        'pricingDate', v_lesson.pricing_date,
        'priceRateId', v_lesson.price_rate_id,
        'lessonStartsAt', v_lesson.starts_at
      ),
      coalesce(p_effective_at, v_lesson.starts_at),
      v_lesson.teacher_id
    );

    return;
  end if;

  with recursive charge_chain as (
    select
      t.id,
      t.amount_minor,
      t.currency,
      t.reversal_of_id,
      0::integer as depth
    from public.student_finance_transactions t
    where t.id = v_root.id

    union all

    select
      r.id,
      r.amount_minor,
      r.currency,
      r.reversal_of_id,
      c.depth + 1
    from charge_chain c
    join public.student_finance_transactions r
      on r.reversal_of_id = c.id
     and r.transaction_type = 'reversal'::public.finance_transaction_type
  )
  select c.id, c.depth
  into v_head_id, v_head_depth
  from charge_chain c
  order by c.depth desc
  limit 1;

  select t.*
  into v_head
  from public.student_finance_transactions t
  where t.id = v_head_id;

  v_is_charged := (mod(v_head_depth, 2) = 0);

  if v_is_charged = p_should_charge then
    return;
  end if;

  insert into public.student_finance_transactions (
    teacher_id,
    student_id,
    transaction_type,
    amount_minor,
    currency,
    reversal_of_id,
    description,
    metadata,
    effective_at,
    created_by
  )
  values (
    v_lesson.teacher_id,
    v_lesson.student_id,
    'reversal'::public.finance_transaction_type,
    -v_head.amount_minor,
    v_head.currency,
    v_head.id,
    null,
    jsonb_build_object(
      'reason', coalesce(p_reason, 'lesson_outcome'),
      'lessonId', v_lesson.id,
      'reversedTransactionId', v_head.id,
      'targetChargedState', p_should_charge
    ),
    coalesce(p_effective_at, now()),
    v_lesson.teacher_id
  );
end;
$function$;

revoke all on function public.set_lesson_finance_charge_state(uuid, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_lesson_finance_charge_state(uuid, boolean, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Lesson outcomes: completed and missed are both fully charged.
-- ---------------------------------------------------------------------------

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

  if exists (
    select 1
    from public.lesson_cancellation_requests r
    where r.lesson_id = p_lesson_id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_PENDING';
  end if;

  if v_starts_at > now() then
    raise exception 'LESSON_NOT_STARTED';
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

  -- Both completed and missed lessons are charged in full. If the lesson was
  -- already charged (e.g. completed -> missed), the helper is idempotent.
  perform public.set_lesson_finance_charge_state(
    p_lesson_id,
    true,
    format('lesson_status:%s_to_%s', v_current_status::text, p_status::text),
    v_starts_at
  );

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

-- ---------------------------------------------------------------------------
-- Student cancellation request.
-- ---------------------------------------------------------------------------

create or replace function public.request_lesson_cancellation(
  p_lesson_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_id uuid;
  v_lesson public.lessons%rowtype;
  v_student_name text;
  v_free_hours smallint := 6;
  v_minutes_before_start integer;
  v_is_late boolean;
  v_request_id uuid;
begin
  v_student_id := auth.uid();

  if v_student_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if public.is_teacher() then
    raise exception 'STUDENT_REQUIRED';
  end if;

  select l.*
  into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.student_id = v_student_id
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
    raise exception 'PAST_LESSON_CANNOT_BE_CANCELLED';
  end if;

  if exists (
    select 1
    from public.lesson_cancellation_requests r
    where r.lesson_id = p_lesson_id
      and r.status = 'pending'::public.lesson_cancellation_request_status
  ) then
    raise exception 'CANCELLATION_REQUEST_ALREADY_PENDING';
  end if;

  select coalesce(ts.free_cancellation_hours, 6)
  into v_free_hours
  from public.teacher_settings ts
  where ts.teacher_id = v_lesson.teacher_id;

  v_free_hours := coalesce(v_free_hours, 6);
  v_minutes_before_start := greatest(
    floor(extract(epoch from (v_lesson.starts_at - now())) / 60)::integer,
    0
  );
  v_is_late := v_minutes_before_start < (v_free_hours::integer * 60);

  insert into public.lesson_cancellation_requests (
    lesson_id,
    teacher_id,
    student_id,
    reason,
    free_cancellation_hours_snapshot,
    minutes_before_start,
    is_late
  )
  values (
    v_lesson.id,
    v_lesson.teacher_id,
    v_lesson.student_id,
    nullif(btrim(p_reason), ''),
    v_free_hours,
    v_minutes_before_start,
    v_is_late
  )
  returning id into v_request_id;

  select coalesce(nullif(btrim(p.full_name), ''), p.email)
  into v_student_name
  from public.profiles p
  where p.id = v_lesson.student_id;

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
    'lesson_cancellation_requested',
    v_lesson.id,
    'notifications.lessonCancellationRequest.title',
    'notifications.lessonCancellationRequest.body',
    jsonb_build_object(
      'requestId', v_request_id,
      'lessonId', v_lesson.id,
      'studentName', v_student_name,
      'startsAt', v_lesson.starts_at,
      'requestedAt', now(),
      'reason', nullif(btrim(p_reason), ''),
      'freeCancellationHours', v_free_hours,
      'minutesBeforeStart', v_minutes_before_start,
      'isLate', v_is_late,
      'priceAmountMinor', v_lesson.price_amount_minor,
      'priceCurrency', v_lesson.price_currency
    )
  );
end;
$function$;

revoke all on function public.request_lesson_cancellation(uuid, text)
  from public, anon;
grant execute on function public.request_lesson_cancellation(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Teacher resolves a student's cancellation request.
-- p_action:
--   cancel         - early request, no charge
--   cancel_charge  - late request, charge 100%
--   cancel_waive   - late request, explicit exception, no charge
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Direct lesson cancellation is teacher-only and never charges the student.
-- Student cancellations must go through request_lesson_cancellation().
-- ---------------------------------------------------------------------------

create or replace function public.cancel_lesson(
  p_lesson_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_lesson public.lessons%rowtype;
  v_pending_request_id uuid;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'STUDENT_CANCELLATION_REQUIRES_REQUEST';
  end if;

  select l.*
  into v_lesson
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_lesson.status = 'cancelled'::public.lesson_status then
    raise exception 'LESSON_ALREADY_CANCELLED';
  end if;

  if v_lesson.status = 'completed'::public.lesson_status then
    raise exception 'COMPLETED_LESSON_CANNOT_BE_CANCELLED';
  end if;

  if v_lesson.starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_CANCELLED';
  end if;

  select r.id
  into v_pending_request_id
  from public.lesson_cancellation_requests r
  where r.lesson_id = p_lesson_id
    and r.status = 'pending'::public.lesson_cancellation_request_status
  limit 1;

  update public.lessons
  set
    status = 'cancelled',
    cancelled_by = 'teacher',
    cancelled_at = now(),
    cancellation_reason = nullif(btrim(p_reason), ''),
    cancellation_request_id = v_pending_request_id,
    cancellation_charge_mode = 'no_charge'::public.lesson_cancellation_charge_mode,
    cancellation_waiver_reason = null,
    updated_at = now()
  where id = p_lesson_id;

  -- Any pending student request for the lesson is considered resolved by the
  -- teacher's own cancellation. There is still no student charge.
  update public.lesson_cancellation_requests
  set
    status = 'approved',
    resolved_at = now(),
    resolved_by = v_teacher_id,
    charge_mode = 'no_charge'::public.lesson_cancellation_charge_mode,
    updated_at = now()
  where lesson_id = p_lesson_id
    and status = 'pending'::public.lesson_cancellation_request_status;

  perform public.set_lesson_finance_charge_state(
    p_lesson_id,
    false,
    'teacher_cancellation',
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
    v_lesson.student_id,
    'lesson_cancelled',
    p_lesson_id,
    'notifications.lessonCancelled.title',
    'notifications.lessonCancelled.byTeacher',
    jsonb_build_object(
      'lessonId', p_lesson_id,
      'startsAt', v_lesson.starts_at,
      'cancelledBy', 'teacher',
      'chargeMode', 'no_charge'
    )
  );
end;
$function$;

revoke all on function public.cancel_lesson(uuid, text)
  from public, anon;
grant execute on function public.cancel_lesson(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Recurring-series cancellation is teacher-initiated, so every affected
-- lesson is cancelled without charge. Pending student cancellation requests
-- for affected lessons are resolved as no-charge approvals.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_recurring_series_from_lesson(
  p_lesson_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_student_id uuid;
  v_recurring_lesson_id uuid;
  v_starts_at timestamptz;
  v_duration_minutes smallint;
  v_status public.lesson_status;
  v_timezone text;
  v_anchor_date date;
  v_selected_local_date date;
  v_cutoff_date date;
  v_cancelled_count integer := 0;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select
    l.student_id,
    l.recurring_lesson_id,
    l.starts_at,
    l.duration_minutes,
    l.status
  into
    v_student_id,
    v_recurring_lesson_id,
    v_starts_at,
    v_duration_minutes,
    v_status
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_recurring_lesson_id is null then
    raise exception 'NOT_RECURRING_LESSON';
  end if;

  if v_status <> 'scheduled'::public.lesson_status then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;

  if v_starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_CANCELLED';
  end if;

  select r.timezone, r.anchor_date
  into v_timezone, v_anchor_date
  from public.recurring_lessons r
  where r.id = v_recurring_lesson_id
    and r.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'RECURRING_LESSON_NOT_FOUND';
  end if;

  v_selected_local_date := (v_starts_at at time zone v_timezone)::date;
  v_cutoff_date := v_selected_local_date - 1;

  if v_selected_local_date <= v_anchor_date then
    update public.recurring_lessons
    set is_active = false,
        updated_at = now()
    where id = v_recurring_lesson_id;
  else
    update public.recurring_lessons
    set valid_until = case
          when valid_until is null then v_cutoff_date
          else least(valid_until, v_cutoff_date)
        end,
        updated_at = now()
    where id = v_recurring_lesson_id;
  end if;

  update public.lessons
  set
    status = 'cancelled',
    cancelled_by = 'teacher',
    cancelled_at = now(),
    cancellation_reason = null,
    cancellation_charge_mode = 'no_charge'::public.lesson_cancellation_charge_mode,
    cancellation_waiver_reason = null,
    updated_at = now()
  where recurring_lesson_id = v_recurring_lesson_id
    and starts_at >= v_starts_at
    and status = 'scheduled';

  get diagnostics v_cancelled_count = row_count;

  update public.lesson_cancellation_requests r
  set
    status = 'approved',
    resolved_at = now(),
    resolved_by = v_teacher_id,
    charge_mode = 'no_charge'::public.lesson_cancellation_charge_mode,
    updated_at = now()
  where r.status = 'pending'::public.lesson_cancellation_request_status
    and exists (
      select 1
      from public.lessons l
      where l.id = r.lesson_id
        and l.recurring_lesson_id = v_recurring_lesson_id
        and l.starts_at >= v_starts_at
        and l.status = 'cancelled'::public.lesson_status
        and l.cancelled_by = 'teacher'::public.lesson_cancelled_by
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
    v_student_id,
    'lesson_cancelled',
    p_lesson_id,
    'notifications.recurringSeriesCancelled.title',
    'notifications.recurringSeriesCancelled.body',
    jsonb_build_object(
      'lessonId', p_lesson_id,
      'startsAt', v_starts_at,
      'durationMinutes', v_duration_minutes,
      'recurringLessonId', v_recurring_lesson_id,
      'cancelledCount', v_cancelled_count,
      'chargeMode', 'no_charge'
    )
  );

  return v_cancelled_count;
end;
$function$;

revoke all on function public.cancel_recurring_series_from_lesson(uuid)
  from public, anon;
grant execute on function public.cancel_recurring_series_from_lesson(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finance-health analytics: an active lesson charge is determined by the
-- parity of the full immutable reversal chain.
-- ---------------------------------------------------------------------------

create or replace view public.teacher_student_finance_health
with (security_invoker = true)
as
with recursive
relationships as (
  select
    ts.teacher_id,
    ts.student_id,
    p.full_name as student_name,
    p.email as student_email,
    bs.billing_currency
  from public.teacher_students ts
  join public.profiles p
    on p.id = ts.student_id
  left join public.student_billing_settings bs
    on bs.teacher_id = ts.teacher_id
   and bs.student_id = ts.student_id
  where ts.is_active = true
),
active_rate as (
  select distinct on (r.teacher_id, r.student_id)
    r.teacher_id,
    r.student_id,
    r.amount_minor,
    r.currency
  from public.student_lesson_rates r
  where r.effective_from <= public.get_teacher_local_date(r.teacher_id)
    and (
      r.effective_to is null
      or public.get_teacher_local_date(r.teacher_id) < r.effective_to
    )
  order by r.teacher_id, r.student_id, r.effective_from desc
),
balance_base as (
  select
    rel.*,
    coalesce(b.balance_minor, 0)::bigint as balance_minor,
    greatest(-coalesce(b.balance_minor, 0), 0)::bigint as debt_minor
  from relationships rel
  left join public.student_finance_balances b
    on b.teacher_id = rel.teacher_id
   and b.student_id = rel.student_id
   and b.currency = rel.billing_currency
),
lesson_charge_chain as (
  select
    t.id as root_charge_id,
    t.id as node_id,
    t.teacher_id,
    t.student_id,
    t.currency,
    t.effective_at as root_effective_at,
    t.created_at as root_created_at,
    abs(t.amount_minor)::bigint as root_charge_minor,
    0::integer as depth
  from public.student_finance_transactions t
  where t.transaction_type = 'lesson_charge'::public.finance_transaction_type

  union all

  select
    c.root_charge_id,
    r.id,
    c.teacher_id,
    c.student_id,
    c.currency,
    c.root_effective_at,
    c.root_created_at,
    c.root_charge_minor,
    c.depth + 1
  from lesson_charge_chain c
  join public.student_finance_transactions r
    on r.reversal_of_id = c.node_id
   and r.transaction_type = 'reversal'::public.finance_transaction_type
),
lesson_charge_heads as (
  select distinct on (c.root_charge_id)
    c.root_charge_id,
    c.teacher_id,
    c.student_id,
    c.currency,
    c.root_effective_at,
    c.root_created_at,
    c.root_charge_minor,
    c.depth
  from lesson_charge_chain c
  order by c.root_charge_id, c.depth desc
),
active_lesson_charges as (
  select
    h.teacher_id,
    h.student_id,
    h.currency,
    h.root_charge_id as id,
    h.root_charge_minor as charge_minor,
    h.root_effective_at as effective_at,
    h.root_created_at as created_at
  from lesson_charge_heads h
  where mod(h.depth, 2) = 0
),
ranked_lesson_charges as (
  select
    c.*,
    sum(c.charge_minor) over (
      partition by c.teacher_id, c.student_id, c.currency
      order by c.effective_at desc, c.created_at desc, c.id desc
      rows between unbounded preceding and current row
    )::bigint as cumulative_charge_minor
  from active_lesson_charges c
),
unpaid_lessons as (
  select
    b.teacher_id,
    b.student_id,
    count(c.id) filter (
      where b.debt_minor > 0
        and (c.cumulative_charge_minor - c.charge_minor) < b.debt_minor
    )::integer as unpaid_lesson_count
  from balance_base b
  left join ranked_lesson_charges c
    on c.teacher_id = b.teacher_id
   and c.student_id = b.student_id
   and c.currency = b.billing_currency
  group by b.teacher_id, b.student_id
),
upcoming_priced as (
  select
    l.teacher_id,
    l.student_id,
    l.price_currency as currency,
    l.id,
    l.starts_at,
    l.price_amount_minor,
    sum(l.price_amount_minor) over (
      partition by l.teacher_id, l.student_id, l.price_currency
      order by l.starts_at asc, l.id asc
      rows between unbounded preceding and current row
    )::bigint as cumulative_price_minor
  from public.lessons l
  where l.status = 'scheduled'::public.lesson_status
    and l.starts_at >= now()
    and l.price_amount_minor is not null
    and l.price_currency is not null
),
coverage as (
  select
    b.teacher_id,
    b.student_id,
    count(u.id) filter (
      where b.balance_minor > 0
        and u.cumulative_price_minor <= b.balance_minor
    )::integer as covered_scheduled_lessons,
    count(u.id)::integer as priced_upcoming_lessons
  from balance_base b
  left join upcoming_priced u
    on u.teacher_id = b.teacher_id
   and u.student_id = b.student_id
   and u.currency = b.billing_currency
  group by b.teacher_id, b.student_id
)
select
  b.teacher_id,
  b.student_id,
  b.student_name,
  b.student_email,
  b.billing_currency,
  b.balance_minor,
  b.debt_minor,
  coalesce(u.unpaid_lesson_count, 0)::integer as unpaid_lesson_count,
  ar.amount_minor as current_rate_minor,
  ar.currency as current_rate_currency,
  coalesce(c.covered_scheduled_lessons, 0)::integer as covered_scheduled_lessons,
  coalesce(c.priced_upcoming_lessons, 0)::integer as priced_upcoming_lessons,
  case
    when b.balance_minor <= 0 then 0
    when coalesce(c.priced_upcoming_lessons, 0) > 0
      then coalesce(c.covered_scheduled_lessons, 0)
    when ar.amount_minor is not null
      and ar.amount_minor > 0
      and ar.currency = b.billing_currency
      then floor(b.balance_minor::numeric / ar.amount_minor::numeric)::integer
    else null
  end as remaining_lesson_count
from balance_base b
left join unpaid_lessons u
  on u.teacher_id = b.teacher_id
 and u.student_id = b.student_id
left join active_rate ar
  on ar.teacher_id = b.teacher_id
 and ar.student_id = b.student_id
left join coverage c
  on c.teacher_id = b.teacher_id
 and c.student_id = b.student_id;

revoke all on table public.teacher_student_finance_health from anon, authenticated;
grant select on table public.teacher_student_finance_health to authenticated, service_role;

commit;
