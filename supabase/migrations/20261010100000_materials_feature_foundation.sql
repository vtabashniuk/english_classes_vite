-- Materials feature: external-first resources, searchable metadata and revocable access.
-- Existing single-URL records continue to work; no external files are copied.
begin;

alter table public.materials
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists level text,
  add column if not exists folder_id uuid,
  add column if not exists archived_at timestamptz;

create table public.material_folders (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id),
  parent_id uuid references public.material_folders(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (id, teacher_id)
);
alter table public.material_folders enable row level security;
create policy material_folders_teacher on public.material_folders for all to authenticated
  using (teacher_id = auth.uid() and public.is_teacher())
  with check (teacher_id = auth.uid() and public.is_teacher());
-- Do not allow a teacher to attach a folder below another teacher’s folder.
create or replace function public.validate_material_folder_parent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.material_folders f
    where f.id=new.parent_id and f.teacher_id=new.teacher_id
  ) then raise exception 'INVALID_PARENT_FOLDER'; end if;
  if new.parent_id = new.id then raise exception 'FOLDER_CANNOT_PARENT_SELF'; end if;
  return new;
end $$;
create trigger material_folder_validate_parent before insert or update
on public.material_folders for each row
execute function public.validate_material_folder_parent();
grant select, insert, update, delete on public.material_folders to authenticated;
alter table public.materials
  add constraint materials_folder_fk foreign key (folder_id) references public.material_folders(id);

alter table public.student_materials
 add column if not exists revoked_at timestamptz,
 add column if not exists revoked_by uuid;

create table public.material_resources (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  resource_type text not null default 'link',
  storage_provider text not null default 'external',
  external_url text,
  storage_bucket text,
  storage_key text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint resource_location_check check (
    (external_url is not null and storage_bucket is null and storage_key is null
      and external_url ~* '^https?://[^[:space:]]+$')
    or (external_url is null and storage_bucket is not null and storage_key is not null)
  )
);
alter table public.material_resources enable row level security;
-- Only material owners manage resources; students may read resources of active grants.
create policy material_resources_teacher on public.material_resources for all to authenticated
 using (public.is_my_material(material_id) and public.is_teacher())
 with check (public.is_my_material(material_id) and public.is_teacher());
create policy material_resources_student on public.material_resources for select to authenticated
 using (exists(select 1 from public.student_materials sm
   where sm.material_id = material_resources.material_id and sm.student_id=auth.uid() and sm.revoked_at is null));
grant select on public.material_resources to authenticated;

-- Existing records are imported as one primary resource.
insert into public.material_resources(material_id, title, resource_type, storage_provider, external_url)
select id, title, 'link', 'external', url from public.materials
where url ~* '^https?://[^[:space:]]+$';


-- Replace student visibility policy, including nested selects through assignments.
drop policy if exists materials_student_select on public.materials;
create policy materials_student_select on public.materials for select to authenticated using (
 exists (select 1 from public.student_materials sm
   where sm.material_id = materials.id and sm.student_id = auth.uid() and sm.revoked_at is null)
);
drop policy if exists student_materials_select on public.student_materials;
create policy student_materials_select on public.student_materials for select to authenticated using (
 (student_id = auth.uid() and revoked_at is null)
 or (public.is_teacher() and public.is_my_student(student_id) and public.is_my_material(material_id))
);

-- On creation or substantive editing, description and tags must be provided.
-- Legacy rows remain readable, but must be completed before being edited.
create or replace function public.validate_material_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Archive-only updates of legacy incomplete metadata must remain possible.
  if tg_op = 'UPDATE' and new.archived_at is distinct from old.archived_at
    and new.title is not distinct from old.title
    and new.description is not distinct from old.description
    and new.tags is not distinct from old.tags
    and new.url is not distinct from old.url
    and new.category is not distinct from old.category
    and new.folder_id is not distinct from old.folder_id
    and new.level is not distinct from old.level then
    return new;
  end if;
  if nullif(btrim(coalesce(new.description,'')), '') is null then
    raise exception 'MATERIAL_DESCRIPTION_REQUIRED';
  end if;
  if cardinality(new.tags) = 0 or exists (
    select 1 from unnest(new.tags) as tag where nullif(btrim(tag), '') is null
  ) then raise exception 'MATERIAL_TAGS_REQUIRED'; end if;
  if new.folder_id is not null and not exists (
    select 1 from public.material_folders f where f.id=new.folder_id and f.teacher_id=new.teacher_id
  ) then raise exception 'INVALID_MATERIAL_FOLDER'; end if;
  return new;
end $$;
create trigger materials_validate_metadata before insert or update on public.materials
for each row execute function public.validate_material_metadata();

create table public.material_access_events (
 id uuid primary key default gen_random_uuid(),
 material_id uuid not null references public.materials(id),
 student_id uuid not null references public.profiles(id),
 actor_id uuid not null,
 event_type text not null check (event_type in ('assigned','revoked','restored')),
 created_at timestamptz not null default now()
);
-- Record new assignments made by both the library and the assignments RPCs.
create or replace function public.log_material_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.material_access_events(material_id,student_id,actor_id,event_type)
 values(new.material_id,new.student_id,coalesce(auth.uid(),
   (select m.teacher_id from public.materials m where m.id=new.material_id)), 'assigned');
 return new;
end $$;
create trigger student_materials_log_assignment after insert on public.student_materials
for each row execute function public.log_material_assignment();

alter table public.material_access_events enable row level security;
create policy material_events_teacher_read on public.material_access_events for select to authenticated
 using (public.is_my_material(material_id) and public.is_teacher());
grant select on public.material_access_events to authenticated;

create or replace function public.revoke_material_from_student(p_material_id uuid, p_student_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_teacher() or not public.is_my_material(p_material_id)
    or not public.is_my_student(p_student_id) then raise exception 'ACCESS_DENIED'; end if;
 update public.student_materials set revoked_at=now(),revoked_by=auth.uid()
 where material_id=p_material_id and student_id=p_student_id and revoked_at is null;
 if found then
   insert into public.material_access_events(material_id,student_id,actor_id,event_type)
   values (p_material_id,p_student_id,auth.uid(),'revoked');
 end if;
end $$;

-- Preserve existing share RPC signature and notifications; restoring access is explicit.
create or replace function public.restore_material_access(p_material_id uuid, p_student_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_teacher() or not public.is_my_material(p_material_id)
    or not public.is_my_active_student(p_student_id) then raise exception 'ACCESS_DENIED'; end if;
 if not exists (
   select 1 from public.materials m
   where m.id=p_material_id and m.teacher_id=auth.uid()
     and m.archived_at is null
     and nullif(btrim(coalesce(m.description,'')), '') is not null
     and cardinality(m.tags) > 0
 ) then raise exception 'MATERIAL_METADATA_INCOMPLETE'; end if;
 update public.student_materials set revoked_at=null,revoked_by=null,assigned_at=now()
 where material_id=p_material_id and student_id=p_student_id and revoked_at is not null;
 if found then
   insert into public.material_access_events(material_id,student_id,actor_id,event_type)
   values (p_material_id,p_student_id,auth.uid(),'restored');
 end if;
end $$;

create or replace function public.revoke_all_student_materials(p_student_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
 if not public.is_teacher() or not public.is_my_student(p_student_id) then raise exception 'ACCESS_DENIED'; end if;
 with changed as (
  update public.student_materials sm set revoked_at=now(), revoked_by=auth.uid()
  where sm.student_id=p_student_id and sm.revoked_at is null
   and public.is_my_material(sm.material_id)
  returning sm.material_id
 ), events as (
  insert into public.material_access_events(material_id,student_id,actor_id,event_type)
  select material_id,p_student_id,auth.uid(),'revoked' from changed returning id
 ) select count(*) into n from events;
 return n;
end $$;

revoke all on function public.revoke_material_from_student(uuid,uuid) from public,anon;
revoke all on function public.restore_material_access(uuid,uuid) from public,anon;
revoke all on function public.revoke_all_student_materials(uuid) from public,anon;
grant execute on function public.revoke_material_from_student(uuid,uuid) to authenticated;
grant execute on function public.restore_material_access(uuid,uuid) to authenticated;
grant execute on function public.revoke_all_student_materials(uuid) to authenticated;

-- Re-sharing a revoked record by assignment must NOT silently restore access.
-- Share RPC continues to create new grants only; restoration requires explicit RPC.
-- Metadata search is constrained to RLS-visible records.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index materials_tags_gin on public.materials using gin(tags);
create index materials_title_trgm on public.materials using gin (title extensions.gin_trgm_ops);
create index materials_description_trgm on public.materials using gin (description extensions.gin_trgm_ops);
create index material_resources_material_order_idx on public.material_resources(material_id,sort_order);
create index student_materials_active_idx on public.student_materials(student_id,material_id) where revoked_at is null;

create or replace function public.search_materials(p_query text default '', p_limit integer default 40, p_offset integer default 0, p_folder_id uuid default null, p_level text default null)
returns setof public.materials language sql stable security invoker set search_path = '' as $$
 select m.* from public.materials m
 where m.archived_at is null
   and (p_folder_id is null or m.folder_id = p_folder_id)
   and (p_level is null or m.level = p_level) and (
   nullif(btrim(p_query),'') is null
   or not exists (
     select 1 from regexp_split_to_table(lower(btrim(p_query)), E'\\s+') as term
     where term <> '' and
     lower(m.title || ' ' || coalesce(m.description,'') || ' ' ||
       coalesce(m.category,'') || ' ' || coalesce(m.level,'') || ' ' ||
       array_to_string(m.tags,' ')) not like '%' ||
       replace(replace(replace(term,'\','\\'), '%', '\%'), '_', '\_') || '%' escape '\'
   )
   or extensions.similarity(m.title,p_query) > 0.36
 )
 order by case when m.title ilike '%'||p_query||'%' then 0 else 1 end,
          m.title, m.id
 limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
$$;
revoke all on function public.search_materials(text,integer,integer,uuid,text) from public,anon;
grant execute on function public.search_materials(text,integer,integer,uuid,text) to authenticated;
-- Atomic save of catalog data and external resources.
create or replace function public.save_external_material(
 p_material_id uuid, p_title text, p_description text, p_tags text[],
 p_category text, p_level text, p_folder_id uuid, p_urls text[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_url text; v_ordinal integer; v_provider text;
begin
 if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;
 if nullif(btrim(p_title),'') is null or nullif(btrim(p_description),'') is null
    or cardinality(p_tags)=0 or cardinality(p_urls)=0 then raise exception 'MATERIAL_FIELDS_REQUIRED'; end if;
 if exists (select 1 from unnest(p_tags) t where nullif(btrim(t),'') is null) then
    raise exception 'MATERIAL_TAGS_REQUIRED'; end if;
 if exists (select 1 from unnest(p_urls) u where btrim(u) !~* '^https?://[^[:space:]]+$' or length(u)>2000)
 then raise exception 'INVALID_RESOURCE_URL'; end if;
 if p_folder_id is not null and not exists (
  select 1 from public.material_folders f where f.id=p_folder_id and f.teacher_id=auth.uid()
 ) then raise exception 'INVALID_MATERIAL_FOLDER'; end if;
 if p_material_id is null then
  insert into public.materials(teacher_id,title,description,tags,url,category,level,folder_id)
  values(auth.uid(),btrim(p_title),btrim(p_description),p_tags,btrim(p_urls[1]),nullif(btrim(p_category),''),nullif(btrim(p_level),''),p_folder_id)
  returning id into v_id;
 else
  update public.materials set title=btrim(p_title), description=btrim(p_description),
   tags=p_tags,url=btrim(p_urls[1]),category=nullif(btrim(p_category),''),
   level=nullif(btrim(p_level),''),folder_id=p_folder_id,updated_at=now()
  where id=p_material_id and teacher_id=auth.uid() and archived_at is null returning id into v_id;
  if v_id is null then raise exception 'MATERIAL_NOT_FOUND'; end if;
 end if;
 delete from public.material_resources where material_id=v_id;
 for v_url,v_ordinal in select btrim(u),ord::integer from unnest(p_urls) with ordinality as x(u,ord) loop
  v_provider := case when v_url ~* '^https?://(www\.)?(youtube\.com|youtu\.be)/' then 'youtube'
    when v_url ~* '^https?://[^/]*(onedrive\.live\.com|1drv\.ms|sharepoint\.com)/' then 'onedrive'
    else 'external' end;
  insert into public.material_resources(material_id,title,resource_type,storage_provider,external_url,sort_order)
   values(v_id, case when v_ordinal=1 then btrim(p_title) else 'Resource '||v_ordinal end,
      'link',v_provider,v_url,v_ordinal);
 end loop;
 return v_id;
end $$;
revoke all on function public.save_external_material(uuid,text,text,text[],text,text,uuid,text[]) from public,anon;
grant execute on function public.save_external_material(uuid,text,text,text[],text,text,uuid,text[]) to authenticated;

commit;
