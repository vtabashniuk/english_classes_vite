-- CRM / OAuth 1.6.1a / Gate 4.2-A (LOCAL validation first)
-- Extends the EXISTING Before User Created hook; does NOT enable it.
-- The working email invitation ticket path from Gate 3b is preserved.
-- A Google admission is only permission to create auth.users; a teacher-student
-- relationship is created in the later explicit-acceptance Gate 4.3.
-- IMPORTANT: do not deploy this migration to Production before Gate 4.5 review.

begin;

create or replace function public.crm_before_user_created_hook(event jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(event #>> '{user,email}', '')));
  v_provider text := coalesce(event #>> '{user,app_metadata,provider}', '');
  v_ticket text := event #>> '{user,user_metadata,crm_email_invite_ticket}';
  v_count integer := 0;
begin
  -- Gate 3b: EXISTING EMAIL PATH. Keep ticket semantics and rejection unchanged.
  -- User metadata cannot confer CRM teacher privileges.
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

  -- Gate 4.2: Google is identified ONLY by GoTrue's server-populated
  -- app_metadata.provider, not by user_metadata.provider or role.
  -- The OIDC email_verified flag is an additional fail-closed check, never
  -- standalone authorization. Google performs OAuth token validation before
  -- invoking this hook. Both metadata properties must match a real local
  -- OAuth attempt before enabling the Hook in Gate 4.2-B.
  -- identities=[] and email_confirmed_at=NULL are normal before user creation.
  if v_provider = 'google'
     and event #> '{user,app_metadata,providers}' @> '["google"]'::jsonb
     and event #> '{user,user_metadata,email_verified}' = 'true'::jsonb
     and event #> '{user,is_anonymous}' = 'false'::jsonb
     and length(v_email) between 3 and 254
     and position('@' in v_email) > 1
     and v_email !~ '[[:space:]]'
     and position('.' in split_part(v_email, '@', 2)) > 0
     and not exists (
       select 1 from auth.users u where lower(u.email) = v_email
     )
     and not exists (
       select 1 from public.profiles p where lower(p.email) = v_email
     )
     and exists (
       select 1
       from crm_private.pending_google_invitations i
       join public.profiles p on p.id = i.teacher_id
       where i.email = v_email
         and i.status = 'pending'
         and i.expires_at > now()
         and p.role = 'teacher'
         and p.is_active = true
     ) then
    -- Deliberately DO NOT mark the invitation accepted/consumed here.
    -- Activation needs the user's explicit consent and their actual auth.uid().
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

-- CREATE OR REPLACE retains existing ACLs, but reassert the contract.
revoke all on function public.crm_before_user_created_hook(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.crm_before_user_created_hook(jsonb)
  to supabase_auth_admin;

commit;
notify pgrst, 'reload schema';
