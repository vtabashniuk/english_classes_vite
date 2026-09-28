SET local check_function_bodies = off;

CREATE EXTENSION "btree_gist" SCHEMA "public";

CREATE TABLE "public"."assignment_materials" (
  "assignment_id" uuid NOT NULL,
  "material_id"   uuid NOT NULL,
  CONSTRAINT "assignment_materials_pkey" PRIMARY KEY (assignment_id, material_id)
);

ALTER TABLE "public"."assignment_materials"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."assignments" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "teacher_id"   uuid                     NOT NULL,
  "student_id"   uuid                     NOT NULL,
  "lesson_id"    uuid,
  "title"        text                     NOT NULL,
  "description"  text,
  "due_date"     date,
  "completed_at" timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "assignments_pkey" PRIMARY KEY (id),
  CONSTRAINT "assignments_title_check" CHECK (((char_length(TRIM(BOTH FROM title)) >= 1) AND (char_length(TRIM(BOTH FROM title)) <= 200)))
);

ALTER TABLE "public"."assignments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."lesson_requests" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "student_id"          uuid                     NOT NULL,
  "teacher_id"          uuid                     NOT NULL,
  "requested_starts_at" timestamp with time zone NOT NULL,
  "duration_minutes"    smallint                 NOT NULL,
  "message"             text,
  "created_lesson_id"   uuid,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"         timestamp with time zone,
  "resolved_by"         uuid,
  "resolution_comment"  text,
  CONSTRAINT "lesson_requests_duration_minutes_check" CHECK (((duration_minutes >= 30) AND (duration_minutes <= 120))),
  CONSTRAINT "lesson_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "lesson_requests_resolution_comment_length" CHECK (((resolution_comment IS NULL) OR (char_length(resolution_comment) <= 500)))
);

ALTER TABLE "public"."lesson_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."lessons" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "student_id"          uuid                     NOT NULL,
  "teacher_id"          uuid                     NOT NULL,
  "recurring_lesson_id" uuid,
  "starts_at"           timestamp with time zone NOT NULL,
  "duration_minutes"    smallint                 NOT NULL DEFAULT 50,
  "zoom_url"            text,
  "teacher_note"        text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "ends_at"             timestamp with time zone NOT NULL,
  "cancelled_at"        timestamp with time zone,
  "cancellation_reason" text,
  "completed_at"        timestamp with time zone,
  "missed_at"           timestamp with time zone,
  CONSTRAINT "lessons_duration_minutes_check" CHECK (((duration_minutes >= 30) AND (duration_minutes <= 120))),
  CONSTRAINT "lessons_pkey" PRIMARY KEY (id),
  CONSTRAINT "lessons_valid_time_range" CHECK ((ends_at > starts_at))
);

ALTER TABLE "public"."lessons"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."materials" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "teacher_id"  uuid                     NOT NULL,
  "title"       text                     NOT NULL,
  "description" text,
  "url"         text                     NOT NULL,
  "category"    text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "materials_category_check" CHECK (((category IS NULL) OR (char_length(TRIM(BOTH FROM category)) <= 100))),
  CONSTRAINT "materials_pkey" PRIMARY KEY (id),
  CONSTRAINT "materials_title_check" CHECK (((char_length(TRIM(BOTH FROM title)) >= 1) AND (char_length(TRIM(BOTH FROM title)) <= 200))),
  CONSTRAINT "materials_url_check" CHECK (((char_length(TRIM(BOTH FROM url)) >= 1) AND (char_length(TRIM(BOTH FROM url)) <= 2000)))
);

ALTER TABLE "public"."materials"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."notifications" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                     NOT NULL,
  "lesson_id"  uuid,
  "title_key"  text                     NOT NULL,
  "body_key"   text                     NOT NULL,
  "data"       jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "is_read"    boolean                  NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."notifications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "email"      text,
  "full_name"  text,
  "phone"      text,
  "is_active"  boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "timezone"   text                     NOT NULL DEFAULT 'Europe/Kyiv'::text,
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."recurring_lessons" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "student_id"       uuid                     NOT NULL,
  "teacher_id"       uuid                     NOT NULL,
  "weekday"          smallint                 NOT NULL,
  "start_time"       time without time zone   NOT NULL,
  "timezone"         text                     NOT NULL,
  "duration_minutes" smallint                 NOT NULL DEFAULT 50,
  "valid_from"       date                     NOT NULL DEFAULT CURRENT_DATE,
  "valid_until"      date,
  "zoom_url"         text,
  "is_active"        boolean                  NOT NULL DEFAULT true,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "interval_weeks"   smallint                 NOT NULL DEFAULT 1,
  "anchor_date"      date                     NOT NULL,
  CONSTRAINT "recurring_lessons_anchor_weekday_check" CHECK (((EXTRACT(isodow FROM anchor_date))::integer = weekday)),
  CONSTRAINT "recurring_lessons_check" CHECK (((valid_until IS NULL) OR (valid_until >= valid_from))),
  CONSTRAINT "recurring_lessons_duration_range_check" CHECK (((duration_minutes >= 30) AND (duration_minutes <= 120))),
  CONSTRAINT "recurring_lessons_interval_weeks_check" CHECK (((interval_weeks >= 1) AND (interval_weeks <= 52))),
  CONSTRAINT "recurring_lessons_pkey" PRIMARY KEY (id),
  CONSTRAINT "recurring_lessons_start_time_seconds_check" CHECK ((EXTRACT(second FROM start_time) = (0)::numeric)),
  CONSTRAINT "recurring_lessons_weekday_check" CHECK (((weekday >= 1) AND (weekday <= 5)))
);

ALTER TABLE "public"."recurring_lessons"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."student_materials" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "student_id"  uuid                     NOT NULL,
  "material_id" uuid                     NOT NULL,
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "student_materials_pkey" PRIMARY KEY (id),
  CONSTRAINT "student_materials_student_id_material_id_key" UNIQUE (student_id, material_id)
);

ALTER TABLE "public"."student_materials"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."teacher_settings" (
  "teacher_id"              uuid                     NOT NULL,
  "schedule_timezone"       text                     NOT NULL DEFAULT 'Europe/Kyiv'::text,
  "workday_start"           time without time zone   NOT NULL DEFAULT '09:00:00'::time WITHOUT time zone,
  "workday_end"             time without time zone   NOT NULL DEFAULT '19:00:00'::time WITHOUT time zone,
  "lesson_duration_minutes" smallint                 NOT NULL DEFAULT 50,
  "slot_interval_minutes"   smallint                 NOT NULL DEFAULT 30,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "teacher_settings_check" CHECK ((workday_end > workday_start)),
  CONSTRAINT "teacher_settings_lesson_duration_minutes_check" CHECK (((lesson_duration_minutes >= 30) AND (lesson_duration_minutes <= 120))),
  CONSTRAINT "teacher_settings_pkey" PRIMARY KEY (teacher_id),
  CONSTRAINT "teacher_settings_slot_interval_minutes_check" CHECK ((slot_interval_minutes = 30))
);

ALTER TABLE "public"."teacher_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TYPE "public"."assignment_status" AS ENUM (
  'assigned',
  'completed'
);

ALTER TABLE "public"."assignments"
  ADD COLUMN "status" public.assignment_status NOT NULL DEFAULT 'assigned'::public.assignment_status;

CREATE TYPE "public"."lesson_cancelled_by" AS ENUM (
  'teacher',
  'student'
);

ALTER TABLE "public"."lessons"
  ADD COLUMN "cancelled_by" public.lesson_cancelled_by;

CREATE TYPE "public"."lesson_request_status" AS ENUM (
  'pending',
  'approved',
  'rejected',
  'cancelled'
);

ALTER TABLE "public"."lesson_requests"
  ADD COLUMN "status" public.lesson_request_status NOT NULL DEFAULT 'pending'::public.lesson_request_status;

CREATE TYPE "public"."lesson_request_type" AS ENUM (
  'extra_lesson'
);

ALTER TABLE "public"."lesson_requests"
  ADD COLUMN "request_type" public.lesson_request_type NOT NULL DEFAULT 'extra_lesson'::public.lesson_request_type;

CREATE TYPE "public"."lesson_status" AS ENUM (
  'scheduled',
  'completed',
  'cancelled',
  'missed'
);

ALTER TABLE "public"."lessons"
  ADD COLUMN "status" public.lesson_status NOT NULL DEFAULT 'scheduled'::public.lesson_status;

CREATE TYPE "public"."notification_type" AS ENUM (
  'lesson_cancelled',
  'lesson_request_approved',
  'lesson_request_rejected',
  'lesson_status_changed',
  'recurring_series_changed',
  'assignment_created',
  'material_shared'
);

ALTER TABLE "public"."notifications"
  ADD COLUMN "type" public.notification_type NOT NULL;

CREATE TYPE "public"."user_role" AS ENUM (
  'teacher',
  'student'
);

ALTER TABLE "public"."profiles"
  ADD COLUMN "role" public.user_role NOT NULL DEFAULT 'student'::public.user_role;

CREATE OR REPLACE FUNCTION public.approve_lesson_request (
  p_request_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_request public.lesson_requests%rowtype;

  v_ends_at timestamptz;
  v_lesson_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  /*
   * Блокуємо request, щоб його не можна було
   * одночасно approve/reject двома запитами.
   */
  select *
  into v_request
  from public.lesson_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_request.teacher_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'REQUEST_ALREADY_RESOLVED';
  end if;

  if v_request.requested_starts_at <= now() then
    raise exception 'REQUEST_TIME_PASSED';
  end if;

  v_ends_at :=
    v_request.requested_starts_at
    + make_interval(mins => v_request.duration_minutes);

  /*
   * Повторна перевірка availability.
   * Після створення request слот міг бути зайнятий.
   */
  if exists (
    select 1
    from public.lessons l
    where l.teacher_id = v_request.teacher_id
      and l.status <> 'cancelled'
      and l.starts_at < v_ends_at
      and l.ends_at > v_request.requested_starts_at
  ) then
    raise exception 'LESSON_TIME_CONFLICT';
  end if;

  /*
   * Створюємо справжній lesson.
   */
  begin
    insert into public.lessons (
      student_id,
      teacher_id,
      starts_at,
      ends_at,
      duration_minutes,
      status
    )
    values (
      v_request.student_id,
      v_request.teacher_id,
      v_request.requested_starts_at,
      v_ends_at,
      v_request.duration_minutes,
      'scheduled'
    )
    returning id
    into v_lesson_id;

  exception
    when exclusion_violation then
      raise exception 'LESSON_TIME_CONFLICT';
  end;

  /*
   * Закриваємо request.
   */
  update public.lesson_requests
  set
    status = 'approved',
    created_lesson_id = v_lesson_id,
    resolved_at = now(),
    resolved_by = v_user_id
  where id = p_request_id;

  /*
   * Notification учню.
   */
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
    'lesson_request_approved',
    v_lesson_id,
    'notifications.lessonRequestApproved.title',
    'notifications.lessonRequestApproved.body',
    jsonb_build_object(
      'startsAt', v_request.requested_starts_at,
      'durationMinutes', v_request.duration_minutes,
      'requestId', v_request.id,
      'lessonId', v_lesson_id
    )
  );

  return v_lesson_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_extra_lesson_request (
  p_request_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_status public.lesson_request_status;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select r.status
  into v_status
  from public.lesson_requests r
  where r.id = p_request_id
    and r.student_id = v_user_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  update public.lesson_requests
  set status = 'cancelled',
      resolved_at = now(),
      resolved_by = v_user_id
  where id = p_request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_lesson (
  p_lesson_id uuid,
  p_reason    text DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;

  v_lesson public.lessons%rowtype;

  v_cancelled_by
    public.lesson_cancelled_by;

  v_notification_user_id uuid;

  v_student_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into v_lesson
  from public.lessons
  where id = p_lesson_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_lesson.status = 'cancelled' then
    raise exception 'LESSON_ALREADY_CANCELLED';
  end if;

  if v_lesson.status = 'completed' then
    raise exception 'COMPLETED_LESSON_CANNOT_BE_CANCELLED';
  end if;

  if v_lesson.starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_CANCELLED';
  end if;

  if v_user_id = v_lesson.teacher_id then

    v_cancelled_by := 'teacher';

    v_notification_user_id :=
      v_lesson.student_id;

  elsif v_user_id = v_lesson.student_id then

    v_cancelled_by := 'student';

    v_notification_user_id :=
      v_lesson.teacher_id;

  else
    raise exception 'FORBIDDEN';
  end if;

  select
    coalesce(
      nullif(trim(full_name), ''),
      email
    )
  into v_student_name
  from public.profiles
  where id = v_lesson.student_id;

  update public.lessons
  set
    status = 'cancelled',
    cancelled_by = v_cancelled_by,
    cancelled_at = now(),
    cancellation_reason =
      nullif(trim(p_reason), ''),
    updated_at = now()
  where id = p_lesson_id;

  if v_cancelled_by = 'student' then

    insert into public.notifications (
      user_id,
      type,
      lesson_id,
      title_key,
      body_key,
      data
    )
    values (
      v_notification_user_id,
      'lesson_cancelled',
      p_lesson_id,
      'notifications.lessonCancelled.title',
      'notifications.lessonCancelled.byStudent',
      jsonb_build_object(
        'studentName',
        v_student_name,
        'startsAt',
        v_lesson.starts_at,
        'cancelledBy',
        'student'
      )
    );

  else

    insert into public.notifications (
      user_id,
      type,
      lesson_id,
      title_key,
      body_key,
      data
    )
    values (
      v_notification_user_id,
      'lesson_cancelled',
      p_lesson_id,
      'notifications.lessonCancelled.title',
      'notifications.lessonCancelled.byTeacher',
      jsonb_build_object(
        'startsAt',
        v_lesson.starts_at,
        'cancelledBy',
        'teacher'
      )
    );

  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_recurring_series_from_lesson (
  p_lesson_id uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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

  if v_status <> 'scheduled' then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;

  if v_starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_CANCELLED';
  end if;

  select
    r.timezone,
    r.anchor_date
  into
    v_timezone,
    v_anchor_date
  from public.recurring_lessons r
  where r.id = v_recurring_lesson_id
    and r.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'RECURRING_LESSON_NOT_FOUND';
  end if;

  v_selected_local_date := (v_starts_at at time zone v_timezone)::date;
  v_cutoff_date := v_selected_local_date - 1;

  -- If the selected lesson is the first occurrence, the rule has no
  -- occurrence that should remain active. Otherwise we simply close
  -- the rule on the day before the selected lesson.
  if v_selected_local_date <= v_anchor_date then
    update public.recurring_lessons
    set
      is_active = false,
      updated_at = now()
    where id = v_recurring_lesson_id;
  else
    update public.recurring_lessons
    set
      valid_until = case
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
    updated_at = now()
  where recurring_lesson_id = v_recurring_lesson_id
    and starts_at >= v_starts_at
    and status = 'scheduled';

  get diagnostics v_cancelled_count = row_count;

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
      'cancelledCount', v_cancelled_count
    )
  );

  return v_cancelled_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_recurring_lesson_conflict (
  p_student_id  uuid,
  p_weekday     smallint,
  p_start_time  time without time zone,
  p_valid_from  date,
  p_valid_until date                   DEFAULT NULL::date
)
  RETURNS TABLE (
    teacher_conflict boolean,
    student_conflict boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid;
  v_duration smallint;
  v_timezone text;
  v_end_time time;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select
    ts.lesson_duration_minutes,
    ts.schedule_timezone
  into
    v_duration,
    v_timezone
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  v_end_time :=
    p_start_time + make_interval(mins => v_duration);

  return query
  select

    /*
     * Конфлікт розкладу викладача.
     */
    exists (
      select 1
      from public.recurring_lessons r
      where r.teacher_id = v_teacher_id
        and r.is_active = true
        and r.weekday = p_weekday

        /*
         * Періоди дії серій перетинаються.
         */
        and r.valid_from
              <= coalesce(p_valid_until, 'infinity'::date)

        and coalesce(r.valid_until, 'infinity'::date)
              >= p_valid_from

        /*
         * Часові інтервали перетинаються.
         */
        and r.start_time < v_end_time

        and (
          r.start_time
          + make_interval(mins => r.duration_minutes)
        ) > p_start_time
    ),

    /*
     * Конфлікт регулярного розкладу самого учня.
     */
    exists (
      select 1
      from public.recurring_lessons r
      where r.student_id = p_student_id
        and r.is_active = true
        and r.weekday = p_weekday

        and r.valid_from
              <= coalesce(p_valid_until, 'infinity'::date)

        and coalesce(r.valid_until, 'infinity'::date)
              >= p_valid_from

        and r.start_time < v_end_time

        and (
          r.start_time
          + make_interval(mins => r.duration_minutes)
        ) > p_start_time
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_assignment (
  p_assignment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.assignments
  set status='completed', completed_at=coalesce(completed_at,now()), updated_at=now()
  where id=p_assignment_id and student_id=auth.uid();
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_lesson (
  p_lesson_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid;
  v_status public.lesson_status;
  v_starts_at timestamptz;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select
    l.status,
    l.starts_at
  into
    v_status,
    v_starts_at
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_status = 'cancelled' then
    raise exception 'LESSON_CANCELLED';
  end if;

  if v_status = 'completed' then
    raise exception 'LESSON_ALREADY_COMPLETED';
  end if;

  if v_starts_at > now() then
    raise exception 'LESSON_NOT_STARTED';
  end if;

  update public.lessons
  set
    status = 'completed',
    completed_at = now(),
    updated_at = now()
  where id = p_lesson_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_assignment (
  p_student_id   uuid,
  p_title        text,
  p_description  text   DEFAULT NULL::text,
  p_due_date     date   DEFAULT NULL::date,
  p_lesson_id    uuid   DEFAULT NULL::uuid,
  p_material_ids uuid[] DEFAULT '{}'::uuid[]
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid := auth.uid();
  v_assignment_id uuid;
  v_material_id uuid;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
  if nullif(trim(p_title),'') is null or char_length(trim(p_title)) > 200 then raise exception 'INVALID_TITLE'; end if;

  if not exists (select 1 from public.profiles p where p.id=p_student_id and p.role='student' and p.is_active=true) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  if p_lesson_id is not null and not exists (
    select 1 from public.lessons l where l.id=p_lesson_id and l.teacher_id=v_teacher_id and l.student_id=p_student_id
  ) then raise exception 'LESSON_NOT_FOUND'; end if;

  if exists (
    select 1 from unnest(coalesce(p_material_ids,'{}'::uuid[])) x(id)
    where not exists (select 1 from public.materials m where m.id=x.id and m.teacher_id=v_teacher_id)
  ) then raise exception 'MATERIAL_NOT_FOUND'; end if;

  insert into public.assignments(teacher_id, student_id, lesson_id, title, description, due_date)
  values (v_teacher_id, p_student_id, p_lesson_id, trim(p_title), nullif(trim(p_description),''), p_due_date)
  returning id into v_assignment_id;

  foreach v_material_id in array coalesce(p_material_ids,'{}'::uuid[]) loop
    insert into public.assignment_materials(assignment_id, material_id) values(v_assignment_id,v_material_id) on conflict do nothing;
    insert into public.student_materials(student_id, material_id) values(p_student_id,v_material_id) on conflict do nothing;
  end loop;

  insert into public.notifications(user_id, type, title_key, body_key, data)
  values (p_student_id, 'assignment_created', 'notifications.assignmentCreated.title', 'notifications.assignmentCreated.body', jsonb_build_object('assignmentId',v_assignment_id,'assignmentTitle',trim(p_title)));

  return v_assignment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_extra_lesson_request (
  p_requested_starts_at timestamp with time zone,
  p_message             text                     DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_teacher_id uuid;
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_duration smallint;
  v_slot_interval smallint;
  v_local_start timestamp;
  v_local_day_start timestamp;
  v_local_day_end timestamp;
  v_requested_end timestamptz;
  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
  v_request_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'student'
      and is_active = true
  ) then
    raise exception 'STUDENT_REQUIRED';
  end if;

  v_teacher_id := public.resolve_my_teacher_id();

  select
    ts.schedule_timezone,
    ts.workday_start,
    ts.workday_end,
    ts.lesson_duration_minutes,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_workday_start,
    v_workday_end,
    v_duration,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  v_local_start := p_requested_starts_at at time zone v_timezone;

  if extract(isodow from v_local_start::date) not between 1 and 5 then
    raise exception 'NON_WORKING_DAY';
  end if;

  if p_requested_starts_at <= now() then
    raise exception 'LESSON_MUST_BE_IN_FUTURE';
  end if;

  v_local_day_start := v_local_start::date + v_workday_start;
  v_local_day_end := v_local_start::date + v_workday_end;

  if v_local_start < v_local_day_start
     or v_local_start + make_interval(mins => v_duration) > v_local_day_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_minutes_from_midnight :=
      extract(hour from v_local_start)::integer * 60
    + extract(minute from v_local_start)::integer;

  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(v_minutes_from_midnight - v_workday_start_minutes, v_slot_interval) <> 0
     or extract(second from v_local_start) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_requested_end := p_requested_starts_at + make_interval(mins => v_duration);

  if exists (
    select 1
    from public.lessons l
    where l.teacher_id = v_teacher_id
      and l.status <> 'cancelled'
      and l.starts_at < v_requested_end
      and l.ends_at > p_requested_starts_at
  ) then
    raise exception 'LESSON_TIME_CONFLICT';
  end if;

  if exists (
    select 1
    from public.lesson_requests r
    where r.student_id = v_user_id
      and r.status = 'pending'
      and r.requested_starts_at < v_requested_end
      and r.requested_starts_at + make_interval(mins => r.duration_minutes) > p_requested_starts_at
  ) then
    raise exception 'REQUEST_TIME_CONFLICT';
  end if;

  insert into public.lesson_requests (
    request_type,
    student_id,
    teacher_id,
    requested_starts_at,
    duration_minutes,
    message,
    status
  )
  values (
    'extra_lesson',
    v_user_id,
    v_teacher_id,
    p_requested_starts_at,
    v_duration,
    nullif(trim(p_message), ''),
    'pending'
  )
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_lesson (
  p_student_id  uuid,
  p_lesson_date date,
  p_start_time  time without time zone,
  p_zoom_url    text                   DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid;

  v_timezone text;

  v_workday_start time;
  v_workday_end time;

  v_duration integer;
  v_slot_interval integer;

  v_starts_at timestamptz;
  v_ends_at timestamptz;

  v_lesson_id uuid;

  v_student_exists boolean;

  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select exists (
    select 1
    from public.profiles
    where
      id = p_student_id
      and role = 'student'
      and is_active = true
  )
  into v_student_exists;

  if not v_student_exists then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  select
    schedule_timezone,
    workday_start,
    workday_end,
    lesson_duration_minutes,
    slot_interval_minutes
  into
    v_timezone,
    v_workday_start,
    v_workday_end,
    v_duration,
    v_slot_interval
  from public.teacher_settings
  where teacher_id =
    v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  if extract(
    isodow
    from p_lesson_date
  ) not between 1 and 5 then
    raise exception 'WEEKEND_NOT_ALLOWED';
  end if;

  /*
    Перевіряємо крок відносно
    ПОЧАТКУ робочого дня.

    Наприклад:
    робочий день 09:15,
    interval 30 ->
    дозволено 09:15, 09:45...
  */

  v_minutes_from_midnight :=
    extract(
      hour
      from p_start_time
    )::integer * 60
    +
    extract(
      minute
      from p_start_time
    )::integer;

  v_workday_start_minutes :=
    extract(
      hour
      from v_workday_start
    )::integer * 60
    +
    extract(
      minute
      from v_workday_start
    )::integer;

  if (
    mod(
      v_minutes_from_midnight
      -
      v_workday_start_minutes,
      v_slot_interval
    ) <> 0
    or
    extract(
      second
      from p_start_time
    ) <> 0
  ) then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  if p_start_time <
     v_workday_start then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  if (
    p_start_time
    +
    make_interval(
      mins => v_duration
    )
    >
    v_workday_end
  ) then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_starts_at :=
    (
      p_lesson_date::timestamp
      +
      p_start_time
    )
    at time zone
    v_timezone;

  v_ends_at :=
    v_starts_at
    +
    make_interval(
      mins => v_duration
    );

  if v_starts_at <= now() then
    raise exception 'LESSON_IN_PAST';
  end if;

  insert into public.lessons (
    student_id,
    teacher_id,
    starts_at,
    ends_at,
    duration_minutes,
    status,
    zoom_url
  )
  values (
    p_student_id,
    v_teacher_id,
    v_starts_at,
    v_ends_at,
    v_duration,
    'scheduled',
    nullif(
      trim(p_zoom_url),
      ''
    )
  )
  returning id
  into v_lesson_id;

  return v_lesson_id;

exception
  when exclusion_violation then
    raise exception 'LESSON_TIME_CONFLICT';
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_recurring_lesson (
  p_student_id     uuid,
  p_weekday        smallint,
  p_start_time     time without time zone,
  p_valid_from     date,
  p_valid_until    date                   DEFAULT NULL::date,
  p_zoom_url       text                   DEFAULT NULL::text,
  p_interval_weeks smallint               DEFAULT 1
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid;

  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_duration smallint;
  v_slot_interval smallint;

  v_local_today date;
  v_anchor_date date;

  v_minutes_from_midnight integer;
  v_workday_start_minutes integer;

  v_end_time time;

  v_recurring_lesson_id uuid;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_student_id
      and p.role = 'student'
      and p.is_active = true
  ) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  select
    ts.schedule_timezone,
    ts.workday_start,
    ts.workday_end,
    ts.lesson_duration_minutes,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_workday_start,
    v_workday_end,
    v_duration,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = v_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  if p_weekday < 1 or p_weekday > 5 then
    raise exception 'INVALID_WEEKDAY';
  end if;

  if p_interval_weeks < 1
     or p_interval_weeks > 52 then
    raise exception 'INVALID_INTERVAL_WEEKS';
  end if;

  if extract(second from p_start_time) <> 0 then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  v_local_today :=
    (now() at time zone v_timezone)::date;

  if p_valid_from < v_local_today then
    raise exception 'VALID_FROM_IN_PAST';
  end if;

  if p_valid_until is not null
     and p_valid_until < p_valid_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  /*
   * Перша реальна дата уроку:
   * перший потрібний weekday від valid_from.
   */
  v_anchor_date :=
    p_valid_from
    + (
        (
          p_weekday
          - extract(isodow from p_valid_from)::integer
          + 7
        ) % 7
      );

  if p_valid_until is not null
     and v_anchor_date > p_valid_until then
    raise exception 'NO_OCCURRENCE_IN_DATE_RANGE';
  end if;

  if p_start_time < v_workday_start then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_end_time :=
    p_start_time
    + make_interval(mins => v_duration);

  if v_end_time > v_workday_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_minutes_from_midnight :=
      extract(hour from p_start_time)::integer * 60
    + extract(minute from p_start_time)::integer;

  v_workday_start_minutes :=
      extract(hour from v_workday_start)::integer * 60
    + extract(minute from v_workday_start)::integer;

  if mod(
       v_minutes_from_midnight - v_workday_start_minutes,
       v_slot_interval
     ) <> 0
  then
    raise exception 'INVALID_TIME_SLOT';
  end if;

  /*
   * Перевірка конфліктів саме реальних
   * occurrence нового правила з існуючими rules.
   *
   * Перевіряємо горизонт до valid_until,
   * або 2 роки для безстрокового правила.
   */
  if exists (
    select 1
    from public.recurring_lessons r
    cross join lateral generate_series(
      greatest(v_anchor_date, r.anchor_date)::timestamp,
      least(
        coalesce(p_valid_until, v_anchor_date + 730),
        coalesce(r.valid_until, v_anchor_date + 730)
      )::timestamp,
      interval '1 day'
    ) d(day)
    where r.teacher_id = v_teacher_id
      and r.is_active = true

      and extract(isodow from d.day)::integer = p_weekday
      and extract(isodow from d.day)::integer = r.weekday

      and d.day::date >= v_anchor_date
      and d.day::date >= r.anchor_date

      and mod(
        ((d.day::date - v_anchor_date) / 7),
        p_interval_weeks
      ) = 0

      and mod(
        ((d.day::date - r.anchor_date) / 7),
        r.interval_weeks
      ) = 0

      and r.start_time < v_end_time

      and (
        r.start_time
        + make_interval(mins => r.duration_minutes)
      ) > p_start_time
  ) then
    raise exception 'RECURRING_TEACHER_CONFLICT';
  end if;

  insert into public.recurring_lessons (
    student_id,
    teacher_id,
    weekday,
    start_time,
    timezone,
    duration_minutes,
    valid_from,
    valid_until,
    anchor_date,
    interval_weeks,
    zoom_url,
    is_active
  )
  values (
    p_student_id,
    v_teacher_id,
    p_weekday,
    p_start_time,
    v_timezone,
    v_duration,
    p_valid_from,
    p_valid_until,
    v_anchor_date,
    p_interval_weeks,
    nullif(trim(p_zoom_url), ''),
    true
  )
  returning id
  into v_recurring_lesson_id;

  return v_recurring_lesson_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_recurring_lesson_with_generation (
  p_student_id     uuid,
  p_weekday        smallint,
  p_start_time     time without time zone,
  p_valid_from     date,
  p_valid_until    date                   DEFAULT NULL::date,
  p_zoom_url       text                   DEFAULT NULL::text,
  p_interval_weeks smallint               DEFAULT 1,
  p_generate_weeks smallint               DEFAULT 8
)
  RETURNS TABLE (
    recurring_lesson_id uuid,
    created_count       integer,
    existing_count      integer,
    conflict_count      integer,
    past_count          integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_recurring_lesson_id uuid;

  v_timezone text;
  v_today date;
  v_generate_until date;

  v_created integer;
  v_existing integer;
  v_conflicts integer;
  v_past integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_generate_weeks < 1
     or p_generate_weeks > 52 then
    raise exception 'INVALID_GENERATION_WEEKS';
  end if;

  /*
   * Беремо timezone розкладу викладача,
   * щоб "сьогодні" рахувалося правильно.
   */
  select ts.schedule_timezone
  into v_timezone
  from public.teacher_settings ts
  where ts.teacher_id = v_user_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  v_today :=
    (now() at time zone v_timezone)::date;

  /*
   * Створюємо recurring rule.
   * Вся валідація виконується всередині
   * create_recurring_lesson().
   */
  v_recurring_lesson_id :=
    public.create_recurring_lesson(
      p_student_id,
      p_weekday,
      p_start_time,
      p_valid_from,
      p_valid_until,
      p_zoom_url,
      p_interval_weeks
    );

  /*
   * Генеруємо горизонт від сьогодні приблизно
   * на p_generate_weeks тижнів наперед.
   */
  v_generate_until :=
    v_today + (p_generate_weeks * 7);

  /*
   * Не виходимо за valid_until серії.
   */
  if p_valid_until is not null then
    v_generate_until :=
      least(
        v_generate_until,
        p_valid_until
      );
  end if;

  select
    g.created_count,
    g.existing_count,
    g.conflict_count,
    g.past_count
  into
    v_created,
    v_existing,
    v_conflicts,
    v_past
  from public.generate_recurring_lessons(
    v_recurring_lesson_id,
    v_generate_until
  ) g;

  return query
  select
    v_recurring_lesson_id,
    coalesce(v_created, 0),
    coalesce(v_existing, 0),
    coalesce(v_conflicts, 0),
    coalesce(v_past, 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.edit_recurring_series_from_lesson (
  p_lesson_id      uuid,
  p_weekday        smallint,
  p_start_time     time without time zone,
  p_interval_weeks smallint,
  p_valid_until    date                   DEFAULT NULL::date,
  p_zoom_url       text                   DEFAULT NULL::text,
  p_generate_weeks smallint               DEFAULT 8
)
  RETURNS TABLE (
    new_recurring_lesson_id uuid,
    created_count           integer,
    conflict_count          integer,
    cancelled_count         integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid;
  v_student_id uuid;
  v_old_recurring_lesson_id uuid;
  v_starts_at timestamptz;
  v_duration_minutes smallint;
  v_status public.lesson_status;
  v_timezone text;
  v_anchor_date date;
  v_selected_local_date date;
  v_cutoff_date date;
  v_create_result record;
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
    v_old_recurring_lesson_id,
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

  if v_old_recurring_lesson_id is null then
    raise exception 'NOT_RECURRING_LESSON';
  end if;

  if v_status <> 'scheduled' then
    raise exception 'LESSON_NOT_SCHEDULED';
  end if;

  if v_starts_at <= now() then
    raise exception 'PAST_LESSON_CANNOT_BE_EDITED';
  end if;

  select
    r.timezone,
    r.anchor_date
  into
    v_timezone,
    v_anchor_date
  from public.recurring_lessons r
  where r.id = v_old_recurring_lesson_id
    and r.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'RECURRING_LESSON_NOT_FOUND';
  end if;

  v_selected_local_date := (v_starts_at at time zone v_timezone)::date;
  v_cutoff_date := v_selected_local_date - 1;

  if p_valid_until is not null and p_valid_until < v_selected_local_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  -- Close the old rule immediately before the selected occurrence.
  if v_selected_local_date <= v_anchor_date then
    update public.recurring_lessons
    set
      is_active = false,
      updated_at = now()
    where id = v_old_recurring_lesson_id;
  else
    update public.recurring_lessons
    set
      valid_until = case
        when valid_until is null then v_cutoff_date
        else least(valid_until, v_cutoff_date)
      end,
      updated_at = now()
    where id = v_old_recurring_lesson_id;
  end if;

  -- Concrete lessons generated from the old rule must no longer occupy slots.
  update public.lessons
  set
    status = 'cancelled',
    cancelled_by = 'teacher',
    cancelled_at = now(),
    cancellation_reason = null,
    updated_at = now()
  where recurring_lesson_id = v_old_recurring_lesson_id
    and starts_at >= v_starts_at
    and status = 'scheduled';

  get diagnostics cancelled_count = row_count;

  -- Reuse the existing validated creation/generation flow. If this raises
  -- (for example because of a recurring conflict), this entire function is
  -- rolled back, so the old series remains untouched.
  select *
  into v_create_result
  from public.create_recurring_lesson_with_generation(
    p_student_id => v_student_id,
    p_weekday => p_weekday,
    p_start_time => p_start_time,
    p_valid_from => v_selected_local_date,
    p_valid_until => p_valid_until,
    p_zoom_url => nullif(trim(p_zoom_url), ''),
    p_interval_weeks => p_interval_weeks,
    p_generate_weeks => p_generate_weeks
  );

  new_recurring_lesson_id := v_create_result.recurring_lesson_id;
  created_count := coalesce(v_create_result.created_count, 0);
  conflict_count := coalesce(v_create_result.conflict_count, 0);

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
    'recurring_series_changed',
    p_lesson_id,
    'notifications.recurringSeriesChanged.title',
    'notifications.recurringSeriesChanged.body',
    jsonb_build_object(
      'lessonId', p_lesson_id,
      'startsAt', v_starts_at,
      'durationMinutes', v_duration_minutes,
      'oldRecurringLessonId', v_old_recurring_lesson_id,
      'newRecurringLessonId', new_recurring_lesson_id
    )
  );

  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_lessons (
  p_recurring_lesson_id uuid,
  p_until               date
)
  RETURNS TABLE (
    created_count  integer,
    existing_count integer,
    conflict_count integer,
    past_count     integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_rule public.recurring_lessons%rowtype;

  v_today date;
  v_start_date date;
  v_end_date date;
  v_date date;

  v_starts_at timestamptz;
  v_ends_at timestamptz;

  v_created integer := 0;
  v_existing integer := 0;
  v_conflicts integer := 0;
  v_past integer := 0;

  v_weeks_from_anchor integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select *
  into v_rule
  from public.recurring_lessons
  where id = p_recurring_lesson_id;

  if not found then
    raise exception 'RECURRING_LESSON_NOT_FOUND';
  end if;

  if v_rule.teacher_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if not v_rule.is_active then
    raise exception 'RECURRING_LESSON_INACTIVE';
  end if;

  if p_until is null then
    raise exception 'UNTIL_REQUIRED';
  end if;

  v_today :=
    (now() at time zone v_rule.timezone)::date;

  v_start_date :=
    greatest(
      v_rule.valid_from,
      v_rule.anchor_date,
      v_today
    );

  if v_rule.valid_until is null then
    v_end_date := p_until;
  else
    v_end_date :=
      least(
        p_until,
        v_rule.valid_until
      );
  end if;

  if v_end_date < v_start_date then
    return query
    select 0, 0, 0, 0;

    return;
  end if;

  for v_date in
    select d::date
    from generate_series(
      v_start_date::timestamp,
      v_end_date::timestamp,
      interval '1 day'
    ) as gs(d)
  loop

    /*
     * Правильний weekday.
     */
    if extract(isodow from v_date)::integer
         <> v_rule.weekday
    then
      continue;
    end if;

    /*
     * Скільки повних тижнів минуло
     * від anchor_date.
     */
    v_weeks_from_anchor :=
      (v_date - v_rule.anchor_date) / 7;

    /*
     * interval_weeks = 1:
     * 0,1,2,3... → усі тижні.
     *
     * interval_weeks = 2:
     * 0,2,4,6... → через тиждень.
     */
    if mod(
         v_weeks_from_anchor,
         v_rule.interval_weeks
       ) <> 0
    then
      continue;
    end if;

    v_starts_at :=
      (
        v_date + v_rule.start_time
      )
      at time zone v_rule.timezone;

    v_ends_at :=
      v_starts_at
      + make_interval(
          mins => v_rule.duration_minutes
        );

    if v_starts_at <= now() then
      v_past := v_past + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.recurring_lesson_id = v_rule.id
        and l.starts_at = v_starts_at
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_rule.teacher_id
        and l.status <> 'cancelled'
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.lessons l
      where l.student_id = v_rule.student_id
        and l.status <> 'cancelled'
        and l.starts_at < v_ends_at
        and l.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    begin
      insert into public.lessons (
        student_id,
        teacher_id,
        recurring_lesson_id,
        starts_at,
        ends_at,
        duration_minutes,
        status,
        zoom_url
      )
      values (
        v_rule.student_id,
        v_rule.teacher_id,
        v_rule.id,
        v_starts_at,
        v_ends_at,
        v_rule.duration_minutes,
        'scheduled',
        v_rule.zoom_url
      );

      v_created := v_created + 1;

    exception
      when exclusion_violation
        or unique_violation
      then
        v_conflicts := v_conflicts + 1;
    end;

  end loop;

  return query
  select
    v_created,
    v_existing,
    v_conflicts,
    v_past;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_extra_lesson_availability (
  p_date date
)
  RETURNS TABLE (
    starts_at         timestamp with time zone,
    ends_at           timestamp with time zone,
    schedule_timezone text,
    duration_minutes  smallint
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_teacher_id uuid;
  v_timezone text;
  v_workday_start time;
  v_workday_end time;
  v_duration smallint;
  v_slot_interval smallint;
  v_local_day_start timestamp;
  v_local_last_start timestamp;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'student'
      and is_active = true
  ) then
    raise exception 'STUDENT_REQUIRED';
  end if;

  v_teacher_id := public.resolve_my_teacher_id();

  select
    ts.schedule_timezone,
    ts.workday_start,
    ts.workday_end,
    ts.lesson_duration_minutes,
    ts.slot_interval_minutes
  into
    v_timezone,
    v_workday_start,
    v_workday_end,
    v_duration,
    v_slot_interval
  from public.teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  if extract(isodow from p_date) not between 1 and 5 then
    return;
  end if;

  v_local_day_start := p_date + v_workday_start;
  v_local_last_start := p_date + v_workday_end - make_interval(mins => v_duration);

  if v_local_last_start < v_local_day_start then
    return;
  end if;

  return query
  select
    slot.slot_local at time zone v_timezone as starts_at,
    (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration) as ends_at,
    v_timezone,
    v_duration
  from generate_series(
    v_local_day_start,
    v_local_last_start,
    make_interval(mins => v_slot_interval)
  ) as slot(slot_local)
  where
    (slot.slot_local at time zone v_timezone) > now()
    and not exists (
      select 1
      from public.lessons l
      where l.teacher_id = v_teacher_id
        and l.status <> 'cancelled'
        and l.starts_at < (slot.slot_local at time zone v_timezone) + make_interval(mins => v_duration)
        and l.ends_at > (slot.slot_local at time zone v_timezone)
    )
  order by starts_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(
      (new.raw_user_meta_data ->> 'role')::public.user_role,
      'student'
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_teacher()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'teacher'
      and is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.notifications
  set is_read = true
  where user_id = v_user_id
    and is_read = false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read (
  p_notification_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.notifications
  set is_read = true
  where id = p_notification_id
    and user_id = v_user_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_lesson_request (
  p_request_id uuid,
  p_comment    text DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_request public.lesson_requests%rowtype;
  v_comment text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  v_comment := nullif(trim(p_comment), '');

  if v_comment is not null
     and char_length(v_comment) > 500 then
    raise exception 'COMMENT_TOO_LONG';
  end if;

  select *
  into v_request
  from public.lesson_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_request.teacher_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'REQUEST_ALREADY_RESOLVED';
  end if;

  update public.lesson_requests
  set
    status = 'rejected',
    resolution_comment = v_comment,
    resolved_at = now(),
    resolved_by = v_user_id
  where id = p_request_id;

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
    'lesson_request_rejected',
    null,
    'notifications.lessonRequestRejected.title',
    'notifications.lessonRequestRejected.body',
    jsonb_build_object(
      'startsAt', v_request.requested_starts_at,
      'durationMinutes', v_request.duration_minutes,
      'requestId', v_request.id,
      'comment', v_comment
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_my_teacher_id()
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid;
  v_teacher_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select l.teacher_id
  into v_teacher_id
  from public.lessons l
  where l.student_id = v_user_id
  order by l.starts_at desc
  limit 1;

  if v_teacher_id is not null then
    return v_teacher_id;
  end if;

  select p.id
  into v_teacher_id
  from public.profiles p
  join public.teacher_settings ts
    on ts.teacher_id = p.id
  where p.role = 'teacher'
    and p.is_active = true
  order by p.created_at
  limit 1;

  if v_teacher_id is null then
    raise exception 'TEACHER_NOT_FOUND';
  end if;

  return v_teacher_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_lesson_outcome (
  p_lesson_id uuid,
  p_status    public.lesson_status
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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

  /*
   * Auth.
   */
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  /*
   * Через цю RPC можна встановлювати
   * тільки completed або missed.
   */
  if p_status not in (
    'completed'::public.lesson_status,
    'missed'::public.lesson_status
  ) then
    raise exception 'INVALID_LESSON_OUTCOME';
  end if;

  /*
   * Блокуємо lesson на час операції.
   */
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

  /*
   * Скасований урок не можна переводити
   * в completed / missed.
   */
  if v_current_status = 'cancelled' then
    raise exception 'LESSON_CANCELLED';
  end if;

  /*
   * Майбутньому уроку не можна
   * встановлювати результат.
   */
  if v_starts_at > now() then
    raise exception 'LESSON_NOT_STARTED';
  end if;

  /*
   * Якщо статус уже такий самий —
   * нічого не робимо.
   *
   * Це також не створить дубль notification.
   */
  if v_current_status = p_status then
    return;
  end if;

  /*
   * Визначаємо, чи потрібно
   * повідомити учня.
   */
  if p_status = 'missed'::public.lesson_status then

    /*
     * scheduled -> missed
     * completed -> missed
     */
    v_should_notify := true;

    v_title_key :=
      'notifications.lessonStatusChanged.missed.title';

    v_body_key :=
      'notifications.lessonStatusChanged.missed.body';

  elsif p_status = 'completed'::public.lesson_status
        and v_current_status = 'missed'::public.lesson_status then

    /*
     * missed -> completed
     */
    v_should_notify := true;

    v_title_key :=
      'notifications.lessonStatusChanged.completed.title';

    v_body_key :=
      'notifications.lessonStatusChanged.completed.body';

  end if;

  /*
   * Оновлюємо lesson.
   */
  if p_status = 'completed'::public.lesson_status then

    update public.lessons
    set
      status = 'completed',
      completed_at = now(),
      missed_at = null,
      updated_at = now()
    where id = p_lesson_id;

  elsif p_status = 'missed'::public.lesson_status then

    update public.lessons
    set
      status = 'missed',
      missed_at = now(),
      completed_at = null,
      updated_at = now()
    where id = p_lesson_id;

  end if;

  /*
   * Notification створюється тільки
   * для значущих змін статусу.
   */
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

CREATE OR REPLACE FUNCTION public.share_material_with_student (
  p_material_id uuid,
  p_student_id  uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid := auth.uid();
  v_title text;
  v_inserted_count integer := 0;
begin
  if v_teacher_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  select m.title into v_title from public.materials m
  where m.id = p_material_id and m.teacher_id = v_teacher_id;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;

  if not exists (select 1 from public.profiles p where p.id=p_student_id and p.role='student' and p.is_active=true) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  insert into public.student_materials(student_id, material_id)
  values (p_student_id, p_material_id)
  on conflict (student_id, material_id) do nothing;
  get diagnostics v_inserted_count = row_count;

  if v_inserted_count > 0 then
    insert into public.notifications(user_id, type, title_key, body_key, data)
    values (p_student_id, 'material_shared', 'notifications.materialShared.title', 'notifications.materialShared.body', jsonb_build_object('materialId', p_material_id, 'materialTitle', v_title));
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_assignment (
  p_assignment_id uuid,
  p_student_id    uuid,
  p_title         text,
  p_description   text   DEFAULT NULL::text,
  p_due_date      date   DEFAULT NULL::date,
  p_lesson_id     uuid   DEFAULT NULL::uuid,
  p_material_ids  uuid[] DEFAULT '{}'::uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid := auth.uid();
  v_status public.assignment_status;
  v_material_id uuid;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select a.status
  into v_status
  from public.assignments a
  where a.id = p_assignment_id
    and a.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_status = 'completed' then
    raise exception 'ASSIGNMENT_COMPLETED';
  end if;

  if nullif(trim(p_title), '') is null
    or char_length(trim(p_title)) > 200 then
    raise exception 'INVALID_TITLE';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_student_id
      and p.role = 'student'
      and p.is_active = true
  ) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  if p_lesson_id is not null and not exists (
    select 1
    from public.lessons l
    where l.id = p_lesson_id
      and l.teacher_id = v_teacher_id
      and l.student_id = p_student_id
  ) then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_material_ids, '{}'::uuid[])) x(id)
    where not exists (
      select 1
      from public.materials m
      where m.id = x.id
        and m.teacher_id = v_teacher_id
    )
  ) then
    raise exception 'MATERIAL_NOT_FOUND';
  end if;

  update public.assignments
  set student_id = p_student_id,
      lesson_id = p_lesson_id,
      title = trim(p_title),
      description = nullif(trim(p_description), ''),
      due_date = p_due_date,
      updated_at = now()
  where id = p_assignment_id;

  delete from public.assignment_materials
  where assignment_id = p_assignment_id;

  foreach v_material_id in array coalesce(p_material_ids, '{}'::uuid[]) loop
    insert into public.assignment_materials(assignment_id, material_id)
    values (p_assignment_id, v_material_id)
    on conflict do nothing;

    insert into public.student_materials(student_id, material_id)
    values (p_student_id, v_material_id)
    on conflict (student_id, material_id) do nothing;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_lesson_zoom (
  p_lesson_id uuid,
  p_zoom_url  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_teacher_id uuid;
  v_status public.lesson_status;
begin
  v_teacher_id := auth.uid();

  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select l.status
  into v_status
  from public.lessons l
  where l.id = p_lesson_id
    and l.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'LESSON_NOT_FOUND';
  end if;

  if v_status = 'cancelled' then
    raise exception 'LESSON_CANCELLED';
  end if;

  update public.lessons
  set
    zoom_url = nullif(trim(p_zoom_url), ''),
    updated_at = now()
  where id = p_lesson_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_profile (
  new_full_name text,
  new_phone     text,
  new_timezone  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = new_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  update public.profiles
  set
    full_name = nullif(trim(new_full_name), ''),
    phone = nullif(trim(new_phone), ''),
    timezone = new_timezone,
    updated_at = now()
  where id = auth.uid();
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_teacher_settings (
  p_schedule_timezone       text,
  p_workday_start           time without time zone,
  p_workday_end             time without time zone,
  p_lesson_duration_minutes smallint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = p_schedule_timezone
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  if p_workday_end <= p_workday_start then
    raise exception 'INVALID_WORKDAY';
  end if;

  if (
    p_lesson_duration_minutes < 30
    or
    p_lesson_duration_minutes > 120
  ) then
    raise exception 'INVALID_LESSON_DURATION';
  end if;

  if (
    p_workday_start
    +
    make_interval(
      mins => p_lesson_duration_minutes
    )
    >
    p_workday_end
  ) then
    raise exception 'WORKDAY_TOO_SHORT';
  end if;

  update public.teacher_settings
  set
    schedule_timezone =
      p_schedule_timezone,

    workday_start =
      p_workday_start,

    workday_end =
      p_workday_end,

    lesson_duration_minutes =
      p_lesson_duration_minutes,

    updated_at =
      now()
  where teacher_id =
    auth.uid();

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;
end;
$function$;

ALTER TABLE "public"."assignment_materials"
  ADD CONSTRAINT "assignment_materials_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;

ALTER TABLE "public"."assignments"
  ADD CONSTRAINT "assignments_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;

ALTER TABLE "public"."lesson_requests"
  ADD CONSTRAINT "lesson_requests_created_lesson_id_fkey" FOREIGN KEY (created_lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;

ALTER TABLE "public"."lessons"
  ADD CONSTRAINT "lessons_student_no_overlap" EXCLUDE USING gist (student_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&)
    WHERE ((status <> 'cancelled'::public.lesson_status));

ALTER TABLE "public"."lessons"
  ADD CONSTRAINT "lessons_teacher_no_overlap" EXCLUDE USING gist (teacher_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&)
    WHERE ((status <> 'cancelled'::public.lesson_status));

ALTER TABLE "public"."assignment_materials"
  ADD CONSTRAINT "assignment_materials_material_id_fkey" FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."assignments"
  ADD CONSTRAINT "assignments_student_id_fkey" FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."assignments"
  ADD CONSTRAINT "assignments_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."lesson_requests"
  ADD CONSTRAINT "lesson_requests_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."lesson_requests"
  ADD CONSTRAINT "lesson_requests_student_id_fkey" FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."lesson_requests"
  ADD CONSTRAINT "lesson_requests_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."lessons"
  ADD CONSTRAINT "lessons_student_id_fkey" FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."lessons"
  ADD CONSTRAINT "lessons_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."materials"
  ADD CONSTRAINT "materials_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."lessons"
  ADD CONSTRAINT "lessons_recurring_lesson_id_fkey" FOREIGN KEY (recurring_lesson_id) REFERENCES public.recurring_lessons(id) ON DELETE SET NULL;

ALTER TABLE "public"."recurring_lessons"
  ADD CONSTRAINT "recurring_lessons_student_id_fkey" FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."recurring_lessons"
  ADD CONSTRAINT "recurring_lessons_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."student_materials"
  ADD CONSTRAINT "student_materials_material_id_fkey" FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;

ALTER TABLE "public"."student_materials"
  ADD CONSTRAINT "student_materials_student_id_fkey" FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."teacher_settings"
  ADD CONSTRAINT "teacher_settings_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX assignments_student_id_idx ON public.assignments USING btree (student_id);

CREATE INDEX assignments_student_status_idx ON public.assignments USING btree (student_id, status);

CREATE INDEX assignments_teacher_id_idx ON public.assignments USING btree (teacher_id);

CREATE INDEX lesson_requests_student_idx ON public.lesson_requests USING btree (student_id, created_at DESC);

CREATE UNIQUE INDEX lesson_requests_student_pending_slot_idx ON public.lesson_requests USING btree (student_id, requested_starts_at)
  WHERE (status = 'pending'::public.lesson_request_status);

CREATE INDEX lesson_requests_teacher_status_idx ON public.lesson_requests USING btree (teacher_id, status, requested_starts_at);

CREATE UNIQUE INDEX lessons_recurring_occurrence_unique_idx ON public.lessons USING btree (recurring_lesson_id, starts_at)
  WHERE (recurring_lesson_id IS NOT NULL);

CREATE INDEX lessons_starts_at_idx ON public.lessons USING btree (starts_at);

CREATE INDEX lessons_student_id_idx ON public.lessons USING btree (student_id);

CREATE INDEX lessons_teacher_id_idx ON public.lessons USING btree (teacher_id);

CREATE INDEX materials_teacher_id_idx ON public.materials USING btree (teacher_id);

CREATE INDEX notifications_created_at_idx ON public.notifications USING btree (created_at DESC);

CREATE INDEX notifications_user_id_idx ON public.notifications USING btree (user_id);

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, is_read);

CREATE INDEX recurring_lessons_student_id_idx ON public.recurring_lessons USING btree (student_id);

CREATE INDEX recurring_lessons_teacher_active_idx ON public.recurring_lessons USING btree (teacher_id, weekday, start_time)
  WHERE (is_active = true);

CREATE INDEX recurring_lessons_teacher_id_idx ON public.recurring_lessons USING btree (teacher_id);

CREATE INDEX student_materials_student_id_idx ON public.student_materials USING btree (student_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "assignment_materials_select" ON "public"."assignment_materials"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.assignments a
  WHERE ((a.id = assignment_materials.assignment_id) AND ((a.student_id = auth.uid()) OR ((a.teacher_id = auth.uid()) AND public.is_teacher()))))));

CREATE POLICY "assignments_select" ON "public"."assignments"
  FOR SELECT
  TO "authenticated"
  USING (((student_id = auth.uid()) OR ((teacher_id = auth.uid()) AND public.is_teacher())));

CREATE POLICY "Students can view own lesson requests" ON "public"."lesson_requests"
  FOR SELECT
  TO "authenticated"
  USING ((student_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Teachers can view own lesson requests" ON "public"."lesson_requests"
  FOR SELECT
  TO "authenticated"
  USING ((teacher_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Students can view own lessons" ON "public"."lessons"
  FOR SELECT
  TO "authenticated"
  USING ((student_id = auth.uid()));

CREATE POLICY "Teacher can create lessons" ON "public"."lessons"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_teacher() AND (teacher_id = auth.uid())));

CREATE POLICY "Teacher can update lessons" ON "public"."lessons"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_teacher())
  WITH CHECK ((public.is_teacher() AND (teacher_id = auth.uid())));

CREATE POLICY "Teacher can view all lessons" ON "public"."lessons"
  FOR SELECT
  TO "authenticated"
  USING (public.is_teacher());

CREATE POLICY "materials_student_select" ON "public"."materials"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.student_materials sm
  WHERE ((sm.material_id = materials.id) AND (sm.student_id = auth.uid())))));

CREATE POLICY "materials_teacher_all" ON "public"."materials"
  FOR ALL
  TO "authenticated"
  USING (((teacher_id = auth.uid()) AND public.is_teacher()))
  WITH CHECK (((teacher_id = auth.uid()) AND public.is_teacher()));

CREATE POLICY "Users can view own notifications" ON "public"."notifications"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Teacher can view all profiles" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_teacher() AS is_teacher));

CREATE POLICY "Users can view own profile" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "Students can view own recurring lessons" ON "public"."recurring_lessons"
  FOR SELECT
  TO "authenticated"
  USING ((student_id = auth.uid()));

CREATE POLICY "Teacher can create recurring lessons" ON "public"."recurring_lessons"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_teacher() AND (teacher_id = auth.uid())));

CREATE POLICY "Teacher can update recurring lessons" ON "public"."recurring_lessons"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_teacher())
  WITH CHECK ((public.is_teacher() AND (teacher_id = auth.uid())));

CREATE POLICY "Teacher can view all recurring lessons" ON "public"."recurring_lessons"
  FOR SELECT
  TO "authenticated"
  USING (public.is_teacher());

CREATE POLICY "student_materials_select" ON "public"."student_materials"
  FOR SELECT
  TO "authenticated"
  USING (((student_id = auth.uid()) OR public.is_teacher()));

CREATE POLICY "Teacher can update own settings" ON "public"."teacher_settings"
  FOR UPDATE
  TO "authenticated"
  USING (((teacher_id = auth.uid()) AND public.is_teacher()))
  WITH CHECK (((teacher_id = auth.uid()) AND public.is_teacher()));

CREATE POLICY "Teacher can view own settings" ON "public"."teacher_settings"
  FOR SELECT
  TO "authenticated"
  USING ((teacher_id = auth.uid()));

COMMENT ON EXTENSION "btree_gist" IS 'support for indexing common datatypes in GiST';

REVOKE ALL ON FUNCTION "public"."approve_lesson_request"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."approve_lesson_request"(uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_extra_lesson_request"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."cancel_extra_lesson_request"(uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_lesson"(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."cancel_lesson"(uuid, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_recurring_series_from_lesson"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."cancel_recurring_series_from_lesson"(uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."check_recurring_lesson_conflict"(uuid, smallint, time WITHOUT time zone, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."check_recurring_lesson_conflict"(uuid, smallint, time WITHOUT time zone, date, date) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."complete_assignment"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."complete_assignment"(uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."complete_lesson"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."complete_lesson"(uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."create_assignment"(uuid, text, text, date, uuid, uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_assignment"(uuid, text, text, date, uuid, uuid[]) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."create_extra_lesson_request"(timestamp WITH time zone, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_extra_lesson_request"(timestamp WITH time zone, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."create_lesson"(uuid, date, time WITHOUT time zone, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_lesson"(uuid, date, time WITHOUT time zone, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."create_recurring_lesson"(uuid, smallint, time WITHOUT time zone, date, date, text, smallint) FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION "public"."create_recurring_lesson"(uuid, smallint, time WITHOUT time zone, date, date, text, smallint)
  TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."create_recurring_lesson_with_generation"(uuid, smallint, time WITHOUT time zone, date, date, text, smallint, smallint) FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION "public"."create_recurring_lesson_with_generation"(uuid, smallint, time WITHOUT time zone, date, date, text, smallint, smallint)
  TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."edit_recurring_series_from_lesson"(uuid, smallint, time WITHOUT time zone, smallint, date, text, smallint) FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION "public"."edit_recurring_series_from_lesson"(uuid, smallint, time WITHOUT time zone, smallint, date, text, smallint)
  TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."generate_recurring_lessons"(uuid, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."generate_recurring_lessons"(uuid, date) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_extra_lesson_availability"(date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_extra_lesson_availability"(date) TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_teacher"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."mark_all_notifications_read"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."mark_all_notifications_read"() TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."mark_notification_read"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."mark_notification_read"(uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."reject_lesson_request"(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."reject_lesson_request"(uuid, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_my_teacher_id"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."resolve_my_teacher_id"() TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_lesson_outcome"(uuid, public.lesson_status) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_lesson_outcome"(uuid, public.lesson_status) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."share_material_with_student"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."share_material_with_student"(uuid, uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_assignment"(uuid, uuid, text, text, date, uuid, uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_assignment"(uuid, uuid, text, text, date, uuid, uuid[]) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_lesson_zoom"(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_lesson_zoom"(uuid, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_my_profile"(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_my_profile"(text, text, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_my_teacher_settings"(text, time WITHOUT time zone, time WITHOUT time zone, smallint) FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION "public"."update_my_teacher_settings"(text, time WITHOUT time zone, time WITHOUT time zone, smallint)
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assignment_materials" TO "anon";

REVOKE ALL ON TABLE "public"."assignment_materials" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."assignment_materials" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assignment_materials" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assignments" TO "anon";

REVOKE ALL ON TABLE "public"."assignments" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."assignments" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assignments" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."lesson_requests" TO "anon";

REVOKE ALL ON TABLE "public"."lesson_requests" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."lesson_requests" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."lesson_requests" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."lessons" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."materials" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."recurring_lessons" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."student_materials" TO "anon";

REVOKE ALL ON TABLE "public"."student_materials" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."student_materials" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."student_materials" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."teacher_settings" TO "anon", "authenticated", "postgres", "service_role";

GRANT USAGE ON TYPE "public"."assignment_status" TO "postgres";

GRANT USAGE ON TYPE "public"."lesson_cancelled_by" TO "postgres";

GRANT USAGE ON TYPE "public"."lesson_request_status" TO "postgres";

GRANT USAGE ON TYPE "public"."lesson_request_type" TO "postgres";

GRANT USAGE ON TYPE "public"."lesson_status" TO "postgres";

GRANT USAGE ON TYPE "public"."notification_type" TO "postgres";

GRANT USAGE ON TYPE "public"."user_role" TO "postgres";

