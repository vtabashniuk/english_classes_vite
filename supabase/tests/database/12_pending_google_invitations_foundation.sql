-- CRM OAuth 1.6.1a / Gate 2b. Synthetic pgTAP data, all rolled back.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(26);
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres', 'supabase_admin')
  THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY: use npx supabase test db --local'; END IF;
END $$;

INSERT INTO auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('85000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','google-teacher-a@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('85000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','google-teacher-b@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('85000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','google-existing-student@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
UPDATE public.profiles SET role = 'teacher'::public.user_role
WHERE id IN ('85000000-0000-4000-8000-000000000001'::uuid,
             '85000000-0000-4000-8000-000000000002'::uuid);

-- Direct table and arbitrary creation are inaccessible to browser roles.
SELECT ok(NOT has_schema_privilege('authenticated','crm_private','USAGE'),
 'Authenticated clients cannot access private invitation schema');
SELECT ok(NOT has_table_privilege('authenticated',
 'crm_private.pending_google_invitations','SELECT'),
 'Authenticated clients cannot directly read pending invitations');
SELECT ok(NOT has_table_privilege('anon',
 'crm_private.pending_google_invitations','INSERT'),
 'Anonymous users cannot directly insert pending invitations');
SELECT ok(NOT has_function_privilege('authenticated',
 'public.create_pending_google_invitation(uuid,text,text)','EXECUTE'),
 'Browser user cannot create invitations with forged teacher UUID');
SELECT ok(has_function_privilege('service_role',
 'public.create_pending_google_invitation(uuid,text,text)','EXECUTE'),
 'Trusted server role can invoke invitation creation');
SELECT ok(NOT has_function_privilege('anon',
 'public.list_my_pending_google_invitations()','EXECUTE'),
 'Anonymous visitors cannot list pending invitations');

-- Server-side API: create only for active teachers, normalize email, no Auth user.
SELECT ok(length(set_config('crm_test.oauth.inv_a',
 public.create_pending_google_invitation(
 '85000000-0000-4000-8000-000000000001'::uuid,
 '  GOOGLE-PENDING@CRM-TESTS.INVALID  ','New Google Student')::text,true)) = 36,
 'Trusted server creates pending invite for active teacher');
SELECT is((SELECT email FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.oauth.inv_a')::uuid),
 'google-pending@crm-tests.invalid','Email normalized before storage');
SELECT is((SELECT count(*)::integer FROM auth.users
 WHERE lower(email)='google-pending@crm-tests.invalid'),0,
 'Pending invite creates NO Auth user');
SELECT is((SELECT count(*)::integer FROM public.profiles
 WHERE lower(email)='google-pending@crm-tests.invalid'),0,
 'Pending invite creates NO CRM profile');
SELECT is((SELECT count(*)::integer FROM public.teacher_students
 WHERE student_id IN (SELECT id FROM public.profiles
 WHERE lower(email)='google-pending@crm-tests.invalid')),0,
 'Pending invite creates NO student relationship');
SELECT is(public.create_pending_google_invitation(
 '85000000-0000-4000-8000-000000000001'::uuid,
 'google-pending@crm-tests.invalid','Updated name'),
 current_setting('crm_test.oauth.inv_a')::uuid,
 'Re-issuing same teacher/email is idempotent');
SELECT is((SELECT full_name FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.oauth.inv_a')::uuid),
 'Updated name','Reissued invitation updates name');
SELECT ok(length(set_config('crm_test.oauth.inv_b',
 public.create_pending_google_invitation(
 '85000000-0000-4000-8000-000000000002'::uuid,
 'google-pending@crm-tests.invalid','Other teacher pending')::text,true))=36,
 'Different teacher can separately invite the same email');
SELECT is((SELECT count(*)::integer FROM crm_private.pending_google_invitations
 WHERE email='google-pending@crm-tests.invalid' AND status='pending'),2,
 'Two teachers have two distinct pending invitations, no duplicated CRM user');
-- A pending invitation can be renewed beyond its original creation window.
-- The service must extend expiry without duplicating the invitation.
UPDATE crm_private.pending_google_invitations
SET created_at = now() - interval '20 days',
    updated_at = now() - interval '20 days',
    expires_at = now() - interval '6 days'
WHERE id = current_setting('crm_test.oauth.inv_a')::uuid;
SELECT is(public.create_pending_google_invitation(
 '85000000-0000-4000-8000-000000000001'::uuid,
 'google-pending@crm-tests.invalid','Renewed student'),
 current_setting('crm_test.oauth.inv_a')::uuid,
 'Expired invitation renews with the same UUID');
SELECT ok((SELECT expires_at > now() + interval '13 days'
 FROM crm_private.pending_google_invitations
 WHERE id = current_setting('crm_test.oauth.inv_a')::uuid),
 'Expired invitation is renewed for 14 days even after original creation window');

SELECT throws_ok(
 $$SELECT public.create_pending_google_invitation(
 '85000000-0000-4000-8000-000000000001'::uuid,
 'google-existing-student@crm-tests.invalid','Existing')$$,
 'P0001','INVITATION_ACCOUNT_ALREADY_EXISTS',
 'Existing Auth user cannot be silently adopted through pending invite');
SELECT throws_ok(
 $$SELECT public.create_pending_google_invitation(
 '85000000-0000-4000-8000-000000000003'::uuid,
 'another-new@crm-tests.invalid','Not teacher')$$,
 'P0001','INVITATION_TEACHER_NOT_ACTIVE',
 'Student cannot be supplied as invitation issuer');
SELECT throws_ok(
 $$SELECT public.create_pending_google_invitation(
 '85000000-0000-4000-8000-000000000001'::uuid,
 'bad email','Invalid')$$,
 'P0001','INVITATION_INVALID_DETAILS','Malformed invitation email refused');

-- Browser-facing list/cancel always use the actual JWT teacher id.
SELECT set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.list_my_pending_google_invitations()),1,
 'First teacher sees only their pending invitation');
SELECT is(public.cancel_my_pending_google_invitation(
 current_setting('crm_test.oauth.inv_b')::uuid),false,
 'First teacher cannot revoke another teacher invitation');
SELECT is(public.cancel_my_pending_google_invitation(
 current_setting('crm_test.oauth.inv_a')::uuid),true,
 'Teacher can cancel their own invitation');
SELECT is((SELECT count(*)::integer FROM public.list_my_pending_google_invitations()),0,
 'Cancelled invitation disappears from teacher pending list');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.list_my_pending_google_invitations()),1,
 'Second teacher pending invitation remains unaffected');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.list_my_pending_google_invitations()),0,
 'Student has no teacher invitation list');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
