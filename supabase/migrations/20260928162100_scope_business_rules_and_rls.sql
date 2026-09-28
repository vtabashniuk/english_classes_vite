-- Scope teacher data to explicit teacher_students relationships and make
-- business RPCs reject students that are not assigned to the current teacher.

begin;

-- Profiles: teachers see only their assigned students (plus their own profile
-- through the existing "Users can view own profile" policy).
drop policy if exists "Teacher can view all profiles" on public.profiles;
create policy "Teacher can view assigned students"
on public.profiles
for select
to authenticated
using (
  role = 'student'
  and public.is_my_student(id)
);

-- Lessons and recurring lessons: a teacher sees only rows they own.
drop policy if exists "Teacher can view all lessons" on public.lessons;
create policy "Teacher can view own lessons"
on public.lessons
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

drop policy if exists "Teacher can view all recurring lessons" on public.recurring_lessons;
create policy "Teacher can view own recurring lessons"
on public.recurring_lessons
for select
to authenticated
using (
  teacher_id = auth.uid()
  and public.is_teacher()
);

-- Security-definer ownership helper avoids circular RLS recursion between
-- materials and student_materials policies.
create or replace function public.is_my_material(p_material_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.materials m
    where m.id = p_material_id
      and m.teacher_id = auth.uid()
  );
$function$;

revoke execute on function public.is_my_material(uuid)
  from public, anon;
grant execute on function public.is_my_material(uuid)
  to authenticated, service_role;

-- Sharing rows are visible to the student, or to the owning teacher when the
-- material belongs to that teacher and the student is assigned to that teacher.
drop policy if exists "student_materials_select" on public.student_materials;
create policy "student_materials_select"
on public.student_materials
for select
to authenticated
using (
  student_id = auth.uid()
  or (
    public.is_teacher()
    and public.is_my_student(student_id)
    and public.is_my_material(material_id)
  )
);

-- Business-critical schedule mutations must go through RPCs.
drop policy if exists "Teacher can create lessons" on public.lessons;
drop policy if exists "Teacher can update lessons" on public.lessons;
drop policy if exists "Teacher can create recurring lessons" on public.recurring_lessons;
drop policy if exists "Teacher can update recurring lessons" on public.recurring_lessons;
drop policy if exists "Teacher can update own settings" on public.teacher_settings;

CREATE OR REPLACE FUNCTION public.create_lesson(p_student_id uuid, p_lesson_date date, p_start_time time without time zone, p_zoom_url text DEFAULT NULL::text)
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

  if not public.is_my_active_student(p_student_id) then
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


CREATE OR REPLACE FUNCTION public.create_recurring_lesson(p_student_id uuid, p_weekday smallint, p_start_time time without time zone, p_valid_from date, p_valid_until date DEFAULT NULL::date, p_zoom_url text DEFAULT NULL::text, p_interval_weeks smallint DEFAULT 1)
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

  if not public.is_my_active_student(p_student_id) then
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


CREATE OR REPLACE FUNCTION public.check_recurring_lesson_conflict(p_student_id uuid, p_weekday smallint, p_start_time time without time zone, p_valid_from date, p_valid_until date DEFAULT NULL::date)
 RETURNS TABLE(teacher_conflict boolean, student_conflict boolean)
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

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_FOUND';
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


CREATE OR REPLACE FUNCTION public.create_assignment(p_student_id uuid, p_title text, p_description text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_lesson_id uuid DEFAULT NULL::uuid, p_material_ids uuid[] DEFAULT '{}'::uuid[])
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

  if not public.is_my_active_student(p_student_id) then
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


CREATE OR REPLACE FUNCTION public.share_material_with_student(p_material_id uuid, p_student_id uuid)
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

  if not public.is_my_active_student(p_student_id) then
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


CREATE OR REPLACE FUNCTION public.update_assignment(p_assignment_id uuid, p_student_id uuid, p_title text, p_description text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_lesson_id uuid DEFAULT NULL::uuid, p_material_ids uuid[] DEFAULT '{}'::uuid[])
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

  if not public.is_my_active_student(p_student_id) then
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

commit;
