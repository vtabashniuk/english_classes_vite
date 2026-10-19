-- Gate 0b temporary cleanup. LOCAL ONLY.
-- FIRST remove the [auth.hook.before_user_created] stanza from
-- supabase/config.toml, then run `npx supabase stop` / `npx supabase start`.
-- Only after the hook is no longer configured, execute this in LOCAL Studio.
-- This drops the temporary log table and hook. No CRM tables are affected.

begin;

do $guard$
begin
  if not exists (
    select 1 from pg_namespace
    where nspname = 'oauth_gate1'
      and obj_description(oid, 'pg_namespace') =
        'TEMPORARY LOCAL ONLY: OAuth Gate 0b observation; remove after diagnostic.'
  ) then
    raise exception 'Refusing cleanup: oauth_gate1 is absent or not our diagnostic schema';
  end if;
end;
$guard$;

drop schema oauth_gate1 cascade;

commit;
