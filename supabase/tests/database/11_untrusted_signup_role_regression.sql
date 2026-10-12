-- CRM OAuth 1.6.1a / Gate 2a. Run ONLY with npx supabase test db --local.
-- Verifies a public signUp can never create a privileged CRM role by adding
-- untrusted role metadata. These rows are synthetic and rolled back.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(10);

DO $$
BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'LOCAL_TEST_ONLY: npx supabase test db --local';
  END IF;
END $$;

INSERT INTO auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('84000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','role-forgery@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}',
 '{"role":"teacher","full_name":"Forged role"}',now(),now()),
 ('84000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','role-invalid@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}',
 '{"role":"owner"}',now(),now()),
 ('84000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','role-invite@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}',
 '{"role":"student","full_name":"Real Invitation"}',now(),now());

SELECT is((SELECT role::text FROM public.profiles WHERE id='84000000-0000-4000-8000-000000000001'::uuid),
 'student','Forged teacher metadata cannot create teacher role');
SELECT is((SELECT role::text FROM public.profiles WHERE id='84000000-0000-4000-8000-000000000002'::uuid),
 'student','Unknown role metadata cannot bypass strict student default');
SELECT is((SELECT role::text FROM public.profiles WHERE id='84000000-0000-4000-8000-000000000003'::uuid),
 'student','Existing invitation-style metadata still yields student role');
SELECT is((SELECT full_name FROM public.profiles WHERE id='84000000-0000-4000-8000-000000000001'::uuid),
 'Forged role','Non-authorizing full name metadata still works');
SELECT is((SELECT full_name FROM public.profiles WHERE id='84000000-0000-4000-8000-000000000003'::uuid),
 'Real Invitation','Invited student full name is retained');
SELECT is((SELECT count(*)::integer FROM public.profiles WHERE id IN (
 '84000000-0000-4000-8000-000000000001'::uuid,
 '84000000-0000-4000-8000-000000000002'::uuid,
 '84000000-0000-4000-8000-000000000003'::uuid)),3,'Exactly three matching profiles created');
SELECT ok(NOT has_table_privilege('authenticated','public.profiles','UPDATE'),
 'Browser role cannot directly promote a profile');
SELECT ok(NOT has_function_privilege('authenticated','public.handle_new_user()','EXECUTE'),
 'Browser role cannot call the auth profile trigger directly');

SELECT set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.is_teacher(),'Impersonator is not a teacher for the RPC permission layer');
RESET ROLE;

-- Simulate trusted administrator provisioning on a synthetic account.
UPDATE public.profiles SET role='teacher'::public.user_role
WHERE id='84000000-0000-4000-8000-000000000001'::uuid;
SELECT is((SELECT role::text FROM public.profiles WHERE id='84000000-0000-4000-8000-000000000001'::uuid),
 'teacher','Explicit privileged provisioning remains possible');

SELECT * FROM finish();
ROLLBACK;
