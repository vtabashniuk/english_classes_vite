-- Require a description for batch sharing, consistently with single-material sharing.
-- Preserve tenant isolation: validate ownership before checking metadata completeness.
begin;

create or replace function public.grant_collection_materials_to_student(
  p_student_id uuid, p_material_ids uuid[]
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count integer := 0;
  v_distinct uuid[];
begin
  if not public.is_teacher() or not public.is_my_active_student(p_student_id) then
    raise exception 'ACCESS_DENIED';
  end if;

  select coalesce(array_agg(distinct selected.material_id), '{}'::uuid[])
    into v_distinct
  from unnest(coalesce(p_material_ids, '{}'::uuid[])) as selected(material_id);

  if cardinality(v_distinct) = 0 or cardinality(v_distinct) > 100 then
    raise exception 'INVALID_MATERIAL_SELECTION';
  end if;

  -- Deny foreign/archived material IDs without leaking their metadata.
  if (select count(*) from public.materials m
      where m.id = any(v_distinct)
        and m.teacher_id = auth.uid()
        and m.archived_at is null) <> cardinality(v_distinct) then
    raise exception 'ACCESS_DENIED';
  end if;

  -- A legacy material without a description cannot bypass the single-share rule.
  if exists (select 1 from public.materials m
      where m.id = any(v_distinct)
        and nullif(btrim(coalesce(m.description, '')), '') is null) then
    raise exception 'MATERIAL_METADATA_INCOMPLETE';
  end if;

  foreach v_id in array v_distinct loop
    if exists (select 1 from public.student_materials sm
        where sm.material_id = v_id
          and sm.student_id = p_student_id
          and sm.revoked_at is null) then
      continue;
    elsif exists (select 1 from public.student_materials sm
        where sm.material_id = v_id
          and sm.student_id = p_student_id) then
      perform public.restore_material_access(v_id, p_student_id);
    else
      insert into public.student_materials(student_id, material_id)
        values(p_student_id, v_id)
        on conflict(student_id, material_id) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.notifications(user_id, type, title_key, body_key, data)
    values (p_student_id, 'material_shared',
      'notifications.materialsSharedBulk.title',
      'notifications.materialsSharedBulk.body',
      jsonb_build_object('count', v_count));
  end if;

  return v_count;
end $$;

revoke all on function public.grant_collection_materials_to_student(uuid, uuid[])
  from public, anon;
grant execute on function public.grant_collection_materials_to_student(uuid, uuid[])
  to authenticated;

commit;
notify pgrst, 'reload schema';
