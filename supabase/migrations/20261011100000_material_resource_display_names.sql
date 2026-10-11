-- Materials UX: preserve a human-readable title for each external resource.
-- This additive RPC wraps the existing, already deployed atomic save function.
-- No existing records or assignments are changed by this migration.
begin;

create or replace function public.save_external_material_named(
  p_material_id uuid, p_title text, p_description text, p_tags text[],
  p_category text, p_level text, p_folder_id uuid, p_resources jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_material_id uuid;
  v_urls text[];
  v_row record;
begin
  if p_resources is null or jsonb_typeof(p_resources) is distinct from 'array'
     or jsonb_array_length(p_resources) < 1 or jsonb_array_length(p_resources) > 50 then
    raise exception 'INVALID_MATERIAL_RESOURCES';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_resources) r(item)
    where jsonb_typeof(r.item) is distinct from 'object'
       or nullif(btrim(r.item->>'title'), '') is null
       or length(btrim(r.item->>'title')) > 200
       or nullif(btrim(r.item->>'url'), '') is null
  ) then raise exception 'INVALID_MATERIAL_RESOURCE_FIELDS'; end if;

  select array_agg(btrim(r.item->>'url') order by r.ordinality)
    into v_urls
  from jsonb_array_elements(p_resources) with ordinality r(item, ordinality);

  -- Same transaction: the existing RPC validates authorship, tags, URL, folder
  -- and writes the material/resources; any failure below rolls it all back.
  v_material_id := public.save_external_material(
    p_material_id, p_title, p_description, p_tags,
    p_category, p_level, p_folder_id, v_urls
  );

  for v_row in
    select btrim(r.item->>'title') as resource_title, r.ordinality::integer as ordinal
    from jsonb_array_elements(p_resources) with ordinality r(item, ordinality)
  loop
    update public.material_resources
      set title = v_row.resource_title
    where material_id = v_material_id and sort_order = v_row.ordinal;
  end loop;
  return v_material_id;
end $$;

revoke all on function public.save_external_material_named(uuid,text,text,text[],text,text,uuid,jsonb)
  from public, anon;
grant execute on function public.save_external_material_named(uuid,text,text,text[],text,text,uuid,jsonb)
  to authenticated;

commit;
