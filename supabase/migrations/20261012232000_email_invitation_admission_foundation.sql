-- CRM Google OAuth 1.6.1a / Gate 3a.1
-- INVITATION ADMISSION FOUNDATION ONLY. The Before User Created Auth Hook is NOT
-- activated by this migration. Do not enable it until Gate 3a.2 HTTP tests.
-- Google sign-up stays closed until a separately tested Google admission path.

begin;

create table crm_private.email_invitation_admissions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  ticket_hash bytea not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  revoked_at timestamptz,
  constraint email_admission_email_normalized check (
    email = lower(btrim(email)) and length(email) between 3 and 254
    and position('@' in email) > 1 and email !~ '[[:space:]]'
  ),
  constraint email_admission_expires_after_issue check (expires_at > issued_at),
  constraint email_admission_single_outcome check (
    consumed_at is null or revoked_at is null
  )
);

create index email_admission_email_unconsumed_idx
  on crm_private.email_invitation_admissions (email, expires_at)
  where consumed_at is null and revoked_at is null;

alter table crm_private.email_invitation_admissions enable row level security;
revoke all on crm_private.email_invitation_admissions from public, anon, authenticated;

-- The Edge Function will call this ONLY with a trusted, validated teacher ID
-- using the service-role client. No token is sent to the browser or logged.
-- A 2x UUID-v4 ticket supplies >240 random bits. Postgres built-in SHA-256
-- stores only its hash (no pgcrypto extension or deploy-time secret required).
create function public.issue_email_invitation_admission(
  p_teacher_id uuid, p_email text
) returns text
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ticket text;
begin
  if p_teacher_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_teacher_id and p.role = 'teacher' and p.is_active = true
  ) then
    raise exception 'ADMISSION_TEACHER_NOT_ACTIVE';
  end if;

  if length(v_email) not between 3 and 254
     or position('@' in v_email) <= 1
     or v_email ~ '[[:space:]]'
     or position('.' in split_part(v_email, '@', 2)) = 0 then
    raise exception 'ADMISSION_INVALID_EMAIL';
  end if;

  -- Existing users require explicit relationship handling, never a second UUID.
  if exists (select 1 from auth.users u where lower(u.email) = v_email)
     or exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'ADMISSION_ACCOUNT_ALREADY_EXISTS';
  end if;

  v_ticket := pg_catalog.gen_random_uuid()::text || '.' ||
              pg_catalog.gen_random_uuid()::text;

  insert into crm_private.email_invitation_admissions (
    teacher_id, email, ticket_hash
  ) values (
    p_teacher_id, v_email,
    pg_catalog.sha256(pg_catalog.convert_to(v_ticket, 'UTF8'))
  );

  return v_ticket;
end;
$fn$;
revoke all on function public.issue_email_invitation_admission(uuid,text)
  from public, anon, authenticated;
grant execute on function public.issue_email_invitation_admission(uuid,text)
  to service_role;

-- Used by the trusted server when an invitation fails before account creation.
create function public.revoke_email_invitation_admission(p_ticket text)
returns boolean
language plpgsql security definer set search_path = ''
as $fn$
declare v_count integer;
begin
  if p_ticket is null or length(p_ticket) <> 73 then
    return false;
  end if;

  update crm_private.email_invitation_admissions a
  set revoked_at = now()
  where a.ticket_hash = pg_catalog.sha256(pg_catalog.convert_to(p_ticket, 'UTF8'))
    and a.consumed_at is null and a.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$fn$;
revoke all on function public.revoke_email_invitation_admission(text)
  from public, anon, authenticated;
grant execute on function public.revoke_email_invitation_admission(text)
  to service_role;

-- Until this hook is explicitly enabled in local Auth config, it is inert.
-- The only accepted NEW signup is a single-use ticket for an email invitation.
-- Missing/wrong/expired/revoked/reused tickets always fail CLOSED.
-- Before-user-created events do NOT expose a reliable admin-invite indicator.
create function public.crm_before_user_created_hook(event jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(event #>> '{user,email}', '')));
  v_provider text := coalesce(event #>> '{user,app_metadata,provider}', '');
  v_ticket text := event #>> '{user,user_metadata,crm_email_invite_ticket}';
  v_count integer := 0;
begin
  -- This does NOT trust role or other attributes in user_metadata.
  -- The provider check is additional defense, not authorization by itself.
  if v_provider = 'email'
     and length(v_ticket) = 73
     and v_ticket ~ '^[0-9a-f-]{36}\.[0-9a-f-]{36}$'
     and length(v_email) between 3 and 254 then
    update crm_private.email_invitation_admissions a
    set consumed_at = now()
    where a.email = v_email
      and a.ticket_hash = pg_catalog.sha256(pg_catalog.convert_to(v_ticket, 'UTF8'))
      and a.expires_at > now()
      and a.consumed_at is null and a.revoked_at is null
      and exists (
        select 1 from public.profiles p
        where p.id = a.teacher_id and p.role = 'teacher' and p.is_active = true
      );
    get diagnostics v_count = row_count;
  end if;

  if v_count = 1 then
    return '{}'::jsonb;
  end if;
  return pg_catalog.jsonb_build_object(
    'error', pg_catalog.jsonb_build_object(
      'http_code', 403,
      'message', 'Invitation required to create a CRM account.'
    )
  );
end;
$fn$;

revoke all on function public.crm_before_user_created_hook(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.crm_before_user_created_hook(jsonb)
  to supabase_auth_admin;

commit;
notify pgrst, 'reload schema';
