-- Assignments reference shared materials; adding to an assignment does not grant access.
-- A previously linked material stays in assignment history after revoke.
-- This migration deliberately does not create a lesson_materials table.
begin;

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

  if exists (
    select 1 from unnest(coalesce(p_material_ids, '{}'::uuid[])) x(id)
    where not exists (
      select 1 from public.student_materials sm
      join public.materials m on m.id = sm.material_id
      where sm.material_id = x.id and sm.student_id = p_student_id
        and sm.revoked_at is null and m.archived_at is null
        and m.teacher_id = v_teacher_id
    )
  ) then raise exception 'MATERIAL_NOT_SHARED'; end if;

  insert into public.assignments(teacher_id, student_id, lesson_id, title, description, due_date)
  values (v_teacher_id, p_student_id, p_lesson_id, trim(p_title), nullif(trim(p_description),''), p_due_date)
  returning id into v_assignment_id;

  foreach v_material_id in array coalesce(p_material_ids,'{}'::uuid[]) loop
    insert into public.assignment_materials(assignment_id, material_id) values(v_assignment_id,v_material_id) on conflict do nothing;
  end loop;

  insert into public.notifications(user_id, type, title_key, body_key, data)
  values (p_student_id, 'assignment_created', 'notifications.assignmentCreated.title', 'notifications.assignmentCreated.body', jsonb_build_object('assignmentId',v_assignment_id,'assignmentTitle',trim(p_title)));

  return v_assignment_id;
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
  v_existing_student_id uuid;
  v_material_id uuid;
begin
  if v_teacher_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  select a.status, a.student_id
  into v_status, v_existing_student_id
  from public.assignments a
  where a.id = p_assignment_id
    and a.teacher_id = v_teacher_id
  for update;

  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_existing_student_id is distinct from p_student_id then
    raise exception 'ASSIGNMENT_STUDENT_IMMUTABLE';
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

  -- Existing revoked links can remain in the assignment history when unchanged.
  -- Any newly added material requires an active grant.
  if exists (
    select 1 from unnest(coalesce(p_material_ids, '{}'::uuid[])) x(id)
    where not exists (
      select 1 from public.assignment_materials am
      where am.assignment_id = p_assignment_id and am.material_id = x.id
    )
    and not exists (
      select 1 from public.student_materials sm
      join public.materials m on m.id = sm.material_id
      where sm.material_id = x.id and sm.student_id = p_student_id
        and sm.revoked_at is null and m.archived_at is null
        and m.teacher_id = v_teacher_id
    )
  ) then raise exception 'MATERIAL_NOT_SHARED'; end if;

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

  end loop;
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
  if not exists (
    select 1 from public.materials m
    where m.id = p_material_id and m.teacher_id = v_teacher_id
      and m.archived_at is null and nullif(btrim(coalesce(m.description,'')), '') is not null
      and cardinality(m.tags) > 0
  ) then raise exception 'MATERIAL_METADATA_INCOMPLETE'; end if;

  if not public.is_my_active_student(p_student_id) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.student_materials sm
    where sm.student_id = p_student_id and sm.material_id = p_material_id
      and sm.revoked_at is not null
  ) then raise exception 'MATERIAL_ACCESS_REVOKED_USE_RESTORE'; end if;

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



-- These existing SECURITY DEFINER RPCs remain executable by authenticated users.
revoke all on function public.share_material_with_student(uuid,uuid) from public,anon;
grant execute on function public.share_material_with_student(uuid,uuid) to authenticated;
revoke all on function public.create_assignment(uuid,text,text,date,uuid,uuid[]) from public,anon;
revoke all on function public.update_assignment(uuid,uuid,text,text,date,uuid,uuid[]) from public,anon;
grant execute on function public.create_assignment(uuid,text,text,date,uuid,uuid[]) to authenticated;
grant execute on function public.update_assignment(uuid,uuid,text,text,date,uuid,uuid[]) to authenticated;

commit;
