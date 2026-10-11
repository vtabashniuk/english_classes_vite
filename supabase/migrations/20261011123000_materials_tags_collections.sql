-- Materials v2: managed teacher tags, manual/automatic collections, no categories or folders.
-- Intended for the feature/materials LOCAL database first. Old folder names are discarded.
begin;

create table public.material_tags (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references public.profiles(id),
 name text not null check (char_length(btrim(name)) between 1 and 60),
 created_at timestamptz not null default now()
);
create unique index material_tags_teacher_name_key on public.material_tags(teacher_id, lower(name));
create index material_tags_teacher_idx on public.material_tags(teacher_id);
alter table public.material_tags enable row level security;
create policy material_tags_teacher_read on public.material_tags for select to authenticated
 using (teacher_id=auth.uid() and public.is_teacher());
revoke all on public.material_tags from public, anon, authenticated;
grant select on public.material_tags to authenticated;

create table public.material_tag_links (
 material_id uuid not null references public.materials(id) on delete cascade,
 tag_id uuid not null references public.material_tags(id) on delete cascade,
 primary key (material_id,tag_id)
);
create index material_tag_links_tag_idx on public.material_tag_links(tag_id);
alter table public.material_tag_links enable row level security;
create policy material_tag_links_teacher_read on public.material_tag_links for select to authenticated
 using (public.is_my_material(material_id) and public.is_teacher());
revoke all on public.material_tag_links from public,anon,authenticated;
grant select on public.material_tag_links to authenticated;

-- Existing TEXT tags (not folder names) are retained as dictionary entries.
insert into public.material_tags(teacher_id,name)
select distinct on (m.teacher_id, lower(btrim(tag))) m.teacher_id,btrim(tag)
from public.materials m cross join lateral unnest(m.tags) as t(tag)
where nullif(btrim(tag),'') is not null
order by m.teacher_id,lower(btrim(tag)),btrim(tag)
on conflict do nothing;
insert into public.material_tag_links(material_id,tag_id)
select distinct m.id,t.id from public.materials m
cross join lateral unnest(m.tags) as x(name)
join public.material_tags t on t.teacher_id=m.teacher_id and lower(t.name)=lower(btrim(x.name))
on conflict do nothing;

create or replace function public.sync_material_tag_names(p_material_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
 update public.materials m set tags=coalesce((
   select array_agg(t.name order by lower(t.name),t.id) from public.material_tag_links l
   join public.material_tags t on t.id=l.tag_id where l.material_id=p_material_id
 ),'{}'::text[]) where m.id=p_material_id;
end $$;
revoke all on function public.sync_material_tag_names(uuid) from public,anon,authenticated;

-- A material requires a meaningful description; tags are now recommended, not required.
create or replace function public.validate_material_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op='UPDATE' and new.archived_at is distinct from old.archived_at
   and new.title is not distinct from old.title and new.description is not distinct from old.description
   and new.tags is not distinct from old.tags and new.url is not distinct from old.url
   and new.level is not distinct from old.level then return new; end if;
 if nullif(btrim(coalesce(new.description,'')), '') is null then
   raise exception 'MATERIAL_DESCRIPTION_REQUIRED';
 end if;
 return new;
end $$;

create or replace function public.create_material_tag(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_name text:=regexp_replace(btrim(coalesce(p_name,'')), '[[:space:]]+', ' ', 'g'); v_id uuid;
begin
 if not public.is_teacher() or auth.uid() is null then raise exception 'ACCESS_DENIED'; end if;
 if length(v_name) not between 1 and 60 then raise exception 'INVALID_TAG_NAME'; end if;
 insert into public.material_tags(teacher_id,name) values(auth.uid(),v_name)
 on conflict do nothing returning id into v_id;
 if v_id is null then
   select id into v_id from public.material_tags where teacher_id=auth.uid() and lower(name)=lower(v_name);
 end if;
 return v_id;
end $$;

-- Renaming into an existing name MERGES tags without losing any material links.
create or replace function public.rename_material_tag(p_tag_id uuid,p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_old public.material_tags%rowtype; v_name text:=regexp_replace(btrim(coalesce(p_name,'')), '[[:space:]]+', ' ', 'g'); v_existing uuid; v_material uuid;
begin
 if not public.is_teacher() or length(v_name) not between 1 and 60 then raise exception 'INVALID_TAG_NAME'; end if;
 select * into v_old from public.material_tags where id=p_tag_id and teacher_id=auth.uid() for update;
 if not found then raise exception 'TAG_NOT_FOUND'; end if;
 select id into v_existing from public.material_tags
 where teacher_id=auth.uid() and lower(name)=lower(v_name) and id<>p_tag_id;
 if v_existing is null then
   update public.material_tags set name=v_name where id=p_tag_id;
 else
   insert into public.material_tag_links(material_id,tag_id)
   select material_id,v_existing from public.material_tag_links where tag_id=p_tag_id
   on conflict do nothing;
   -- Preserve automatic collection conditions during a merge.
   insert into public.material_collection_tags(collection_id,tag_id)
   select collection_id,v_existing from public.material_collection_tags where tag_id=p_tag_id
   on conflict do nothing;
   delete from public.material_tag_links where tag_id=p_tag_id;
   delete from public.material_tags where id=p_tag_id;
 end if;
 for v_material in
   select m.id from public.materials m where m.teacher_id=auth.uid()
   and (exists(select 1 from public.material_tag_links l where l.material_id=m.id and l.tag_id=coalesce(v_existing,p_tag_id))
        or v_old.name=any(m.tags))
 loop perform public.sync_material_tag_names(v_material); end loop;
 return coalesce(v_existing,p_tag_id);
end $$;

create or replace function public.delete_material_tag(p_tag_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_material uuid; v_ids uuid[];
begin
 if not public.is_teacher() then raise exception 'ACCESS_DENIED'; end if;
 if not exists(select 1 from public.material_tags where id=p_tag_id and teacher_id=auth.uid()) then
   raise exception 'TAG_NOT_FOUND'; end if;
 if exists (
   select 1 from public.material_collections c
   join public.material_collection_tags ct on ct.collection_id=c.id
   where ct.tag_id=p_tag_id and c.kind='automatic' and c.level is null
     and (select count(*) from public.material_collection_tags alltags
          where alltags.collection_id=c.id)=1
 ) then raise exception 'TAG_USED_BY_AUTOMATIC_COLLECTION'; end if;
 select coalesce(array_agg(material_id),'{}'::uuid[]) into v_ids
 from public.material_tag_links where tag_id=p_tag_id;
 delete from public.material_tags where id=p_tag_id;
 foreach v_material in array v_ids loop perform public.sync_material_tag_names(v_material); end loop;
end $$;

-- Atomic save, fully independent of folders/categories or a specific file provider.
create or replace function public.save_material_catalog(
 p_material_id uuid,p_title text,p_description text,p_tags text[],p_level text,p_resources jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_row record; v_tag text; v_tag_id uuid; v_provider text; v_count integer;
begin
 if not public.is_teacher() or auth.uid() is null then raise exception 'TEACHER_REQUIRED'; end if;
 if length(btrim(coalesce(p_title,''))) not between 1 and 200
    or nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'MATERIAL_FIELDS_REQUIRED'; end if;
 if p_level is not null and btrim(p_level)<>'' and p_level not in ('A1','A2','B1','B2','C1','C2')
    then raise exception 'INVALID_LEVEL'; end if;
 if p_resources is null or jsonb_typeof(p_resources)<>'array'
    or jsonb_array_length(p_resources) not between 1 and 50 then raise exception 'INVALID_RESOURCES'; end if;
 if exists (select 1 from jsonb_array_elements(p_resources) e(item)
   where jsonb_typeof(e.item)<>'object'
   or length(btrim(coalesce(e.item->>'title',''))) not between 1 and 200
   or length(btrim(coalesce(e.item->>'url',''))) not between 8 and 2000
   or btrim(coalesce(e.item->>'url','')) !~* '^https?://[^[:space:]]+$'
 ) then raise exception 'INVALID_RESOURCE_FIELDS'; end if;
 if coalesce(cardinality(p_tags),0)>30 then raise exception 'TOO_MANY_TAGS'; end if;
 if exists(select 1 from unnest(coalesce(p_tags,'{}'::text[])) s(tag)
  where length(btrim(s.tag)) not between 1 and 60) then raise exception 'INVALID_TAG_NAME'; end if;
 if p_material_id is null then
   insert into public.materials(teacher_id,title,description,tags,url,level)
   values(auth.uid(),btrim(p_title),btrim(p_description),'{}'::text[],btrim(p_resources->0->>'url'),nullif(btrim(p_level),''))
   returning id into v_id;
 else
   update public.materials set title=btrim(p_title),description=btrim(p_description),
   url=btrim(p_resources->0->>'url'),level=nullif(btrim(p_level),''),updated_at=now()
   where id=p_material_id and teacher_id=auth.uid() and archived_at is null returning id into v_id;
   if v_id is null then raise exception 'MATERIAL_NOT_FOUND'; end if;
 end if;
 delete from public.material_resources where material_id=v_id;
 for v_row in select item,ordinality::integer as n from jsonb_array_elements(p_resources) with ordinality r(item,ordinality)
 loop
   v_provider:=case when (v_row.item->>'url') ~* '^https?://(www\.)?(youtube\.com|youtu\.be)/' then 'youtube'
    when (v_row.item->>'url') ~* '^https?://[^/]*(onedrive\.live\.com|1drv\.ms|sharepoint\.com)/' then 'onedrive'
    else 'external' end;
   insert into public.material_resources(material_id,title,resource_type,storage_provider,external_url,sort_order)
   values(v_id,btrim(v_row.item->>'title'),'link',v_provider,btrim(v_row.item->>'url'),v_row.n);
 end loop;
 delete from public.material_tag_links where material_id=v_id;
 for v_tag in select distinct on (lower(btrim(tag))) btrim(tag)
              from unnest(coalesce(p_tags,'{}'::text[])) s(tag) order by lower(btrim(tag)),btrim(tag)
 loop
   v_tag_id:=public.create_material_tag(v_tag);
   insert into public.material_tag_links(material_id,tag_id) values(v_id,v_tag_id) on conflict do nothing;
 end loop;
 perform public.sync_material_tag_names(v_id);
 return v_id;
end $$;


-- Archive rather than delete: keep historical student/assignment links.
create or replace function public.archive_material_catalog(p_material_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_teacher() or auth.uid() is null then raise exception 'ACCESS_DENIED'; end if;
 update public.materials set archived_at=now(),updated_at=now()
 where id=p_material_id and teacher_id=auth.uid() and archived_at is null;
 if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
end $$;

-- Prevent client writes that would desync normalized tag links from the cached text tags.
-- All catalog mutations now use save_material_catalog/archive_material_catalog RPCs.
revoke insert,update,delete on public.materials from authenticated;

-- Teacher and student search remain RLS-invoker; filters apply before pagination.
create or replace function public.search_materials_catalog(
 p_query text default '',p_limit integer default 40,p_offset integer default 0,
 p_level text default null,p_tag_ids uuid[] default '{}'::uuid[],p_tag_match text default 'all'
) returns setof public.materials language sql stable security invoker set search_path = '' as $$
 select m.* from public.materials m
 where m.archived_at is null
 and (nullif(p_level,'') is null or m.level=p_level)
 and (coalesce(cardinality(p_tag_ids),0)=0
    or (p_tag_match='any' and exists(select 1 from public.material_tag_links l
      where l.material_id=m.id and l.tag_id=any(p_tag_ids)))
    or (p_tag_match='all' and not exists(select 1 from unnest(p_tag_ids) x(tag_id)
      where not exists(select 1 from public.material_tag_links l
        where l.material_id=m.id and l.tag_id=x.tag_id))))
 and (nullif(btrim(coalesce(p_query,'')),'') is null or not exists (
   select 1 from regexp_split_to_table(lower(btrim(p_query)),E'\\s+') term
   where term<>'' and lower(m.title||' '||coalesce(m.description,'')||' '||coalesce(m.level,'')||' '||array_to_string(m.tags,' '))
   not like '%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%' escape '\'
 ) or extensions.similarity(m.title,p_query)>0.36)
 order by case when m.title ilike '%'||coalesce(p_query,'')||'%' then 0 else 1 end,m.title,m.id
 limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)
$$;

create table public.material_collections(
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references public.profiles(id),
 name text not null check (length(btrim(name)) between 1 and 120),
 kind text not null check (kind in ('manual','automatic')),
 level text check(level is null or level in ('A1','A2','B1','B2','C1','C2')),
 tag_match text not null default 'all' check(tag_match in ('all','any')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index material_collections_teacher_idx on public.material_collections(teacher_id);
alter table public.material_collections enable row level security;
create policy material_collections_teacher_read on public.material_collections for select to authenticated
 using(teacher_id=auth.uid() and public.is_teacher());
revoke all on public.material_collections from public,anon,authenticated;
grant select on public.material_collections to authenticated;

create table public.material_collection_tags(
 collection_id uuid not null references public.material_collections(id) on delete cascade,
 tag_id uuid not null references public.material_tags(id) on delete cascade,
 primary key(collection_id,tag_id)
);
create table public.material_collection_items(
 collection_id uuid not null references public.material_collections(id) on delete cascade,
 material_id uuid not null references public.materials(id) on delete cascade,
 primary key(collection_id,material_id)
);
alter table public.material_collection_tags enable row level security;
alter table public.material_collection_items enable row level security;
create policy collection_tags_teacher_read on public.material_collection_tags for select to authenticated
 using(exists(select 1 from public.material_collections c where c.id=collection_id and c.teacher_id=auth.uid()));
create policy collection_items_teacher_read on public.material_collection_items for select to authenticated
 using(exists(select 1 from public.material_collections c where c.id=collection_id and c.teacher_id=auth.uid()));
revoke all on public.material_collection_tags,public.material_collection_items from public,anon,authenticated;
grant select on public.material_collection_tags,public.material_collection_items to authenticated;

create or replace function public.save_material_collection(
 p_id uuid,p_name text,p_kind text,p_level text,p_tag_match text,
 p_tag_ids uuid[],p_material_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if not public.is_teacher() or auth.uid() is null then raise exception 'ACCESS_DENIED'; end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 120
  or p_kind not in ('manual','automatic') or p_tag_match not in ('all','any')
  or (nullif(p_level,'') is not null and p_level not in ('A1','A2','B1','B2','C1','C2'))
  then raise exception 'INVALID_COLLECTION'; end if;
 if coalesce(cardinality(p_tag_ids),0)>30 or coalesce(cardinality(p_material_ids),0)>500
  then raise exception 'COLLECTION_TOO_LARGE'; end if;
 if p_kind='automatic' and nullif(p_level,'') is null and coalesce(cardinality(p_tag_ids),0)=0
  then raise exception 'COLLECTION_FILTER_REQUIRED'; end if;
 if exists(select 1 from unnest(coalesce(p_tag_ids,'{}'::uuid[])) x(id)
  where not exists(select 1 from public.material_tags t where t.id=x.id and t.teacher_id=auth.uid()))
  then raise exception 'TAG_NOT_FOUND'; end if;
 if exists(select 1 from unnest(coalesce(p_material_ids,'{}'::uuid[])) x(id)
  where not exists(select 1 from public.materials m where m.id=x.id and m.teacher_id=auth.uid() and m.archived_at is null))
  then raise exception 'MATERIAL_NOT_FOUND'; end if;
 if p_id is null then
   insert into public.material_collections(teacher_id,name,kind,level,tag_match)
   values(auth.uid(),btrim(p_name),p_kind,nullif(p_level,''),p_tag_match) returning id into v_id;
 else
   update public.material_collections set name=btrim(p_name),kind=p_kind,
     level=nullif(p_level,''),tag_match=p_tag_match,updated_at=now()
   where id=p_id and teacher_id=auth.uid() returning id into v_id;
   if v_id is null then raise exception 'COLLECTION_NOT_FOUND'; end if;
 end if;
 delete from public.material_collection_tags where collection_id=v_id;
 delete from public.material_collection_items where collection_id=v_id;
 if p_kind='automatic' then
  insert into public.material_collection_tags(collection_id,tag_id)
  select v_id,id from (select distinct unnest(coalesce(p_tag_ids,'{}'::uuid[])) as id) t on conflict do nothing;
 else
  insert into public.material_collection_items(collection_id,material_id)
  select v_id,id from (select distinct unnest(coalesce(p_material_ids,'{}'::uuid[])) as id) t on conflict do nothing;
 end if;
 return v_id;
end $$;
create or replace function public.delete_material_collection(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_teacher() then raise exception 'ACCESS_DENIED'; end if;
 delete from public.material_collections where id=p_id and teacher_id=auth.uid();
 if not found then raise exception 'COLLECTION_NOT_FOUND'; end if;
end $$;

-- Access grants no longer require a tag, only a complete description.
create or replace function public.restore_material_access(p_material_id uuid,p_student_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_teacher() or not public.is_my_material(p_material_id)
  or not public.is_my_active_student(p_student_id) then raise exception 'ACCESS_DENIED'; end if;
 if not exists(select 1 from public.materials m where m.id=p_material_id and m.teacher_id=auth.uid()
    and m.archived_at is null and nullif(btrim(coalesce(m.description,'')),'') is not null)
  then raise exception 'MATERIAL_METADATA_INCOMPLETE'; end if;
 update public.student_materials set revoked_at=null,revoked_by=null,assigned_at=now()
 where material_id=p_material_id and student_id=p_student_id and revoked_at is not null;
 if found then insert into public.material_access_events(material_id,student_id,actor_id,event_type)
 values(p_material_id,p_student_id,auth.uid(),'restored'); end if;
end $$;

create or replace function public.share_material_with_student(p_material_id uuid,p_student_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_title text; v_count integer;
begin
 if not public.is_teacher() or auth.uid() is null then raise exception 'ACCESS_DENIED'; end if;
 select title into v_title from public.materials where id=p_material_id and teacher_id=auth.uid()
 and archived_at is null and nullif(btrim(coalesce(description,'')),'') is not null;
 if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
 if not public.is_my_active_student(p_student_id) then raise exception 'STUDENT_NOT_FOUND'; end if;
 if exists(select 1 from public.student_materials where material_id=p_material_id and student_id=p_student_id
 and revoked_at is not null) then raise exception 'MATERIAL_ACCESS_REVOKED_USE_RESTORE'; end if;
 insert into public.student_materials(student_id,material_id) values(p_student_id,p_material_id)
 on conflict(student_id,material_id) do nothing;
 get diagnostics v_count=row_count;
 if v_count>0 then insert into public.notifications(user_id,type,title_key,body_key,data)
 values(p_student_id,'material_shared','notifications.materialShared.title','notifications.materialShared.body',
 jsonb_build_object('materialId',p_material_id,'materialTitle',v_title)); end if;
end $$;

-- New API functions replace old category/folder-dependent signatures.
drop function public.search_materials(text,integer,integer,uuid,text);
drop function public.save_external_material_named(uuid,text,text,text[],text,text,uuid,jsonb);
drop function public.save_external_material(uuid,text,text,text[],text,text,uuid,text[]);

-- Old folders are test-only and intentionally discarded, not converted into tags.
alter table public.materials drop column folder_id;
alter table public.materials drop column category;
drop table public.material_folders;
drop function if exists public.validate_material_folder_parent();

revoke all on function public.create_material_tag(text) from public,anon;
revoke all on function public.rename_material_tag(uuid,text) from public,anon;
revoke all on function public.delete_material_tag(uuid) from public,anon;
revoke all on function public.save_material_catalog(uuid,text,text,text[],text,jsonb) from public,anon;
revoke all on function public.archive_material_catalog(uuid) from public,anon;
revoke all on function public.search_materials_catalog(text,integer,integer,text,uuid[],text) from public,anon;
revoke all on function public.save_material_collection(uuid,text,text,text,text,uuid[],uuid[]) from public,anon;
revoke all on function public.delete_material_collection(uuid) from public,anon;
grant execute on function public.create_material_tag(text),public.rename_material_tag(uuid,text),
 public.delete_material_tag(uuid),public.save_material_catalog(uuid,text,text,text[],text,jsonb),
 public.archive_material_catalog(uuid),
 public.search_materials_catalog(text,integer,integer,text,uuid[],text),
 public.save_material_collection(uuid,text,text,text,text,uuid[],uuid[]),
 public.delete_material_collection(uuid) to authenticated;
commit;
-- Refresh PostgREST RPC and FK metadata in the running local stack.
notify pgrst, 'reload schema';
