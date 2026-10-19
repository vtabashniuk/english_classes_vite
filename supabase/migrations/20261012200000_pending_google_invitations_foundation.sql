-- CRM OAuth 1.6.1a / Gate 2b: invitation-only foundation, INERT until
-- the Auth admission flow is tested. This migration does NOT enable any hook,
-- provider, registration, or automatic student creation.
-- No temporary auth.users/profiles/teacher_students records are created here.
begin;

create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;

create table crm_private.pending_google_invitations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete cascade,
  constraint pending_google_email_normalized
    check (email = lower(btrim(email)) and length(email) between 3 and 254
           and position('@' in email) > 1 and email !~ '[[:space:]]'),
  constraint pending_google_name_length check (length(full_name) <= 200),
  constraint pending_google_expiry_range
    check (expires_at > created_at),
  constraint pending_google_acceptance_consistency check (
    (status = 'accepted' and accepted_at is not null and accepted_user_id is not null)
    or (status <> 'accepted' and accepted_at is null and accepted_user_id is null)
  )
);

create unique index pending_google_one_open_per_teacher_email_idx
on crm_private.pending_google_invitations(teacher_id, email)
where status = 'pending';

create index pending_google_open_email_idx
on crm_private.pending_google_invitations(email, expires_at)
where status = 'pending';

alter table crm_private.pending_google_invitations enable row level security;
revoke all on crm_private.pending_google_invitations from public, anon, authenticated;
-- Only SECURITY DEFINER RPCs below mediate access; no exposed table policies.

create or replace function public.create_pending_google_invitation(
  p_teacher_id uuid, p_email text, p_full_name text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_id uuid;
begin
  if p_teacher_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_teacher_id and p.role = 'teacher' and p.is_active = true
  ) then
    raise exception 'INVITATION_TEACHER_NOT_ACTIVE';
  end if;

  if length(v_email) not between 3 and 254
     or position('@' in v_email) <= 1
     or v_email ~ '[[:space:]]'
     or position('.' in split_part(v_email,'@',2)) = 0
     or length(v_name) > 200 then
    raise exception 'INVITATION_INVALID_DETAILS';
  end if;

  -- Do not implicitly attach an existing Auth account to a new teacher.
  -- A separate student-confirmed relationship flow is required later.
  if exists(select 1 from auth.users u where lower(u.email) = v_email)
     or exists(select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'INVITATION_ACCOUNT_ALREADY_EXISTS';
  end if;

  insert into crm_private.pending_google_invitations (
    teacher_id, email, full_name
  ) values (p_teacher_id, v_email, v_name)
  on conflict (teacher_id, email) where status = 'pending'
  do update set
    full_name = excluded.full_name,
    updated_at = now(),
    expires_at = now() + interval '14 days'
  returning id into v_id;

  return v_id;
end;
$fn$;

-- Only the trusted Edge Function using its service-role client may create
-- invitations. Never grant this to the browser's authenticated role.
revoke all on function public.create_pending_google_invitation(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.create_pending_google_invitation(uuid,text,text)
to service_role;

create or replace function public.list_my_pending_google_invitations()
returns table(id uuid, email text, full_name text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $fn$
  select i.id, i.email, i.full_name, i.created_at, i.expires_at
  from crm_private.pending_google_invitations i
  join public.profiles p on p.id = i.teacher_id
  where i.teacher_id = (select auth.uid())
    and p.role = 'teacher' and p.is_active = true
    and i.status = 'pending' and i.expires_at > now()
  order by i.created_at desc, i.id desc;
$fn$;
revoke all on function public.list_my_pending_google_invitations()
from public, anon;
grant execute on function public.list_my_pending_google_invitations()
to authenticated;

create or replace function public.cancel_my_pending_google_invitation(p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $fn$
declare v_count integer;
begin
  update crm_private.pending_google_invitations i
  set status = 'cancelled', updated_at = now()
  where i.id = p_id and i.teacher_id = (select auth.uid())
    and i.status = 'pending'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'teacher' and p.is_active = true
    );
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$fn$;
revoke all on function public.cancel_my_pending_google_invitation(uuid)
from public, anon;
grant execute on function public.cancel_my_pending_google_invitation(uuid)
to authenticated;

commit;
notify pgrst, 'reload schema';
