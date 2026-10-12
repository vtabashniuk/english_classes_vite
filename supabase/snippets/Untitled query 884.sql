-- Gate 0b: temporary, ALLOW-ALL observation of Supabase's Before User Created hook.
-- LOCAL ONLY. Execute in http://127.0.0.1:54323 (local Studio SQL Editor).
-- This is NOT a migration and MUST NOT be used on the linked/Production DB.
-- It makes no authorization decisions and does not fix the role vulnerability.
-- If oauth_gate1 already exists, STOP and inspect it instead of replacing it.

begin;

create schema oauth_gate1;
revoke all on schema oauth_gate1 from public;

create table oauth_gate1.hook_observations (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null default now(),
  prospective_user_id uuid,
  provider text,
  providers jsonb,
  requested_role text,
  has_invited_at boolean not null,
  has_email_confirmed_at boolean not null,
  user_metadata_keys text[] not null,
  user_keys text[] not null,
  metadata_keys text[] not null
);

revoke all on table oauth_gate1.hook_observations
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on sequence oauth_gate1.hook_observations_id_seq
  from public, anon, authenticated, service_role, supabase_auth_admin;

create function oauth_gate1.observe_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into oauth_gate1.hook_observations (
    prospective_user_id,
    provider,
    providers,
    requested_role,
    has_invited_at,
    has_email_confirmed_at,
    user_metadata_keys,
    user_keys,
    metadata_keys
  ) values (
    nullif(event #>> '{user,id}', '')::uuid,
    event #>> '{user,app_metadata,provider}',
    event #> '{user,app_metadata,providers}',
    event #>> '{user,user_metadata,role}',
    nullif(event #>> '{user,invited_at}', '') is not null,
    nullif(event #>> '{user,email_confirmed_at}', '') is not null,
    array(select jsonb_object_keys(coalesce(event #> '{user,user_metadata}', '{}'::jsonb))),
    array(select jsonb_object_keys(coalesce(event -> 'user', '{}'::jsonb))),
    array(select jsonb_object_keys(coalesce(event -> 'metadata', '{}'::jsonb)))
  );

  -- Observe only: ALWAYS permit creation. Never interpret these fields as proof.
  return '{}'::jsonb;
end;
$function$;

revoke all on function oauth_gate1.observe_before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema oauth_gate1 to supabase_auth_admin;
grant execute on function oauth_gate1.observe_before_user_created(jsonb)
  to supabase_auth_admin;

comment on schema oauth_gate1 is
  'TEMPORARY LOCAL ONLY: OAuth Gate 0b observation; remove after diagnostic.';

commit;
