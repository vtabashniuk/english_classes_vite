-- Gate 3b.1 / CLOUD SQL Editor: READ ONLY.
-- Run ONLY in the INTENDED Production Supabase project, with Hook still OFF.
-- No usernames, email addresses, tickets, hashes, credentials or rows returned.
-- Missing objects yield NOT_READY; DO NOT deploy anything based on this query alone.
-- BEGIN READ ONLY makes accidental edits in this transaction impossible.

BEGIN TRANSACTION READ ONLY;

WITH object_ids AS (
  SELECT
    to_regnamespace('crm_private') AS private_schema,
    to_regclass('crm_private.email_invitation_admissions') AS admission_table,
    to_regprocedure('public.issue_email_invitation_admission(uuid,text)') AS issue_fn,
    to_regprocedure('public.revoke_email_invitation_admission(text)') AS revoke_fn,
    to_regprocedure('public.crm_before_user_created_hook(jsonb)') AS hook_fn
), facts AS (
  SELECT o.*,
    (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid=o.admission_table) AS admission_rls,
    -- PostgreSQL may store SET search_path = '' as search_path="" in pg_proc.proconfig.
    (SELECT p.prosecdef AND coalesce((
        'search_path=' = ANY(p.proconfig) OR 'search_path=""' = ANY(p.proconfig)
      ), false)
       FROM pg_catalog.pg_proc p WHERE p.oid=o.issue_fn) AS issuer_hardened,
    (SELECT p.prosecdef AND coalesce((
        'search_path=' = ANY(p.proconfig) OR 'search_path=""' = ANY(p.proconfig)
      ), false)
       FROM pg_catalog.pg_proc p WHERE p.oid=o.revoke_fn) AS revoker_hardened,
    (SELECT p.prosecdef AND coalesce((
        'search_path=' = ANY(p.proconfig) OR 'search_path=""' = ANY(p.proconfig)
      ), false)
       FROM pg_catalog.pg_proc p WHERE p.oid=o.hook_fn) AS hook_hardened
  FROM object_ids o
)
SELECT v.check_id,
       CASE WHEN v.is_ready IS TRUE THEN 'READY' ELSE 'NOT_READY' END AS state
FROM facts f
CROSS JOIN LATERAL (VALUES
  ('01_private_schema_exists', f.private_schema IS NOT NULL),
  ('02_admission_table_exists', f.admission_table IS NOT NULL),
  ('03_admission_table_rls_enabled', f.admission_rls IS TRUE),
  ('04_issuer_function_exists', f.issue_fn IS NOT NULL),
  ('05_revoker_function_exists', f.revoke_fn IS NOT NULL),
  ('06_hook_function_exists', f.hook_fn IS NOT NULL),
  ('07_issuer_security_definer_locked_path', f.issuer_hardened IS TRUE),
  ('08_revoker_security_definer_locked_path', f.revoker_hardened IS TRUE),
  ('09_hook_security_definer_locked_path', f.hook_hardened IS TRUE),
  ('10_hook_auth_admin_execute',
    coalesce(has_function_privilege('supabase_auth_admin', f.hook_fn, 'EXECUTE'), false)),
  ('11_hook_denied_anon_authenticated_service_role',
    NOT coalesce(has_function_privilege('anon', f.hook_fn, 'EXECUTE'), true)
    AND NOT coalesce(has_function_privilege('authenticated', f.hook_fn, 'EXECUTE'), true)
    AND NOT coalesce(has_function_privilege('service_role', f.hook_fn, 'EXECUTE'), true)),
  ('12_issue_only_server_can_execute',
    coalesce(has_function_privilege('service_role', f.issue_fn, 'EXECUTE'), false)
    AND NOT coalesce(has_function_privilege('anon', f.issue_fn, 'EXECUTE'), true)
    AND NOT coalesce(has_function_privilege('authenticated', f.issue_fn, 'EXECUTE'), true)),
  ('13_revoke_only_server_can_execute',
    coalesce(has_function_privilege('service_role', f.revoke_fn, 'EXECUTE'), false)
    AND NOT coalesce(has_function_privilege('anon', f.revoke_fn, 'EXECUTE'), true)
    AND NOT coalesce(has_function_privilege('authenticated', f.revoke_fn, 'EXECUTE'), true)),
  ('14_private_schema_denied_to_clients',
    NOT coalesce(has_schema_privilege('anon', f.private_schema, 'USAGE'), true)
    AND NOT coalesce(has_schema_privilege('authenticated', f.private_schema, 'USAGE'), true)),
  ('15_admission_select_denied_to_clients',
    NOT coalesce(has_table_privilege('anon', f.admission_table, 'SELECT'), true)
    AND NOT coalesce(has_table_privilege('authenticated', f.admission_table, 'SELECT'), true)),
  ('16_admission_hash_unique_index',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid=i.indrelid AND a.attname='ticket_hash'
      WHERE i.indrelid=f.admission_table AND i.indisunique
        AND i.indisvalid AND i.indnatts=1
        AND i.indkey[0]=a.attnum
    )),
  ('17_no_direct_admission_mutation_by_clients',
    NOT coalesce(has_table_privilege('anon', f.admission_table, 'INSERT,UPDATE,DELETE'), true)
    AND NOT coalesce(has_table_privilege('authenticated', f.admission_table, 'INSERT,UPDATE,DELETE'), true))
) AS v(check_id, is_ready)
ORDER BY v.check_id;

COMMIT;
