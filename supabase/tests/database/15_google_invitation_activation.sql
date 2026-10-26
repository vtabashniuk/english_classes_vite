-- Gate 4.3-A: LOCAL synthetic pgTAP acceptance tests, all data ROLLBACK.
-- Real browser consent/callback and parallel-connection races follow in 4.3-B/4.5.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(26);
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres','supabase_admin')
  THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY: use npx supabase test db --local'; END IF;
END $$;

-- Existing trusted teacher accounts. The Auth trigger creates default profiles.
INSERT INTO auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('89000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-teacher-a@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('89000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-teacher-b@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('89000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-teacher-inactive@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
UPDATE public.profiles SET role='teacher'::public.user_role
 WHERE id IN ('89000000-0000-4000-8000-000000000001'::uuid,
              '89000000-0000-4000-8000-000000000002'::uuid,
              '89000000-0000-4000-8000-000000000003'::uuid);
UPDATE public.profiles SET full_name='Teacher A'
 WHERE id='89000000-0000-4000-8000-000000000001'::uuid;

-- Invitations must exist *before* the matching Auth user is created.
SELECT set_config('crm_test.g43.a', public.create_pending_google_invitation(
 '89000000-0000-4000-8000-000000000001'::uuid,
 'gate43-google@crm-tests.invalid','Student Google')::text, true);
SELECT set_config('crm_test.g43.b', public.create_pending_google_invitation(
 '89000000-0000-4000-8000-000000000002'::uuid,
 'gate43-google@crm-tests.invalid','Same student other teacher')::text, true);
SELECT set_config('crm_test.g43.expired', public.create_pending_google_invitation(
 '89000000-0000-4000-8000-000000000001'::uuid,
 'gate43-expired@crm-tests.invalid','Expired')::text, true);
SELECT set_config('crm_test.g43.cancelled', public.create_pending_google_invitation(
 '89000000-0000-4000-8000-000000000001'::uuid,
 'gate43-cancelled@crm-tests.invalid','Cancelled')::text, true);
SELECT set_config('crm_test.g43.non_google', public.create_pending_google_invitation(
 '89000000-0000-4000-8000-000000000001'::uuid,
 'gate43-password@crm-tests.invalid','Password only')::text, true);
SELECT set_config('crm_test.g43.inactive_teacher', public.create_pending_google_invitation(
 '89000000-0000-4000-8000-000000000003'::uuid,
 'gate43-inactive@crm-tests.invalid','Inactive teacher later')::text, true);
-- Move the entire test invitation window into the past. The table requires
-- expires_at > created_at, even when the invitation is already expired.
UPDATE crm_private.pending_google_invitations
SET created_at = now() - interval '20 days',
    updated_at = now() - interval '20 days',
    expires_at = now() - interval '6 days'
WHERE id = current_setting('crm_test.g43.expired')::uuid;
UPDATE crm_private.pending_google_invitations SET status='cancelled'
 WHERE id=current_setting('crm_test.g43.cancelled')::uuid;
UPDATE public.profiles SET is_active=false
 WHERE id='89000000-0000-4000-8000-000000000003'::uuid;

INSERT INTO auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('89000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-google@crm-tests.invalid','!',now(),
  '{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('89000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-password@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('89000000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-expired@crm-tests.invalid','!',now(),
  '{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('89000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-cancelled@crm-tests.invalid','!',now(),
  '{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('89000000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-inactive@crm-tests.invalid','!',now(),
  '{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('89000000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate43-uninvited@crm-tests.invalid','!',now(),
  '{"provider":"google","providers":["google"]}','{}',now(),now());

-- The provider identity is a server-managed record; never trust user_metadata.
INSERT INTO auth.identities(id,provider_id,user_id,identity_data,provider)
VALUES
 (gen_random_uuid(),'gate43-id-11','89000000-0000-4000-8000-000000000011'::uuid,
  '{"email":"gate43-google@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'gate43-id-13','89000000-0000-4000-8000-000000000013'::uuid,
  '{"email":"gate43-expired@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'gate43-id-14','89000000-0000-4000-8000-000000000014'::uuid,
  '{"email":"gate43-cancelled@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'gate43-id-15','89000000-0000-4000-8000-000000000015'::uuid,
  '{"email":"gate43-inactive@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'gate43-id-16','89000000-0000-4000-8000-000000000016'::uuid,
  '{"email":"gate43-uninvited@crm-tests.invalid","email_verified":true}'::jsonb,'google');

SELECT ok(NOT has_function_privilege('anon',
  'public.accept_my_pending_google_invitation(uuid)','EXECUTE'),
 'Anonymous caller cannot execute acceptance');
SELECT ok(has_function_privilege('authenticated',
  'public.accept_my_pending_google_invitation(uuid)','EXECUTE'),
 'Authenticated user can invoke guarded acceptance');
SELECT ok(NOT has_function_privilege('anon',
  'public.list_my_google_invitation_choices()','EXECUTE'),
 'Anonymous caller cannot list choices');
SELECT ok(NOT has_schema_privilege('authenticated','crm_private','USAGE'),
 'Authenticated student cannot read private table directly');
SELECT ok(NOT has_table_privilege('authenticated',
 'public.teacher_students','INSERT'), 'Browser cannot insert relationship directly');

-- Authenticated but without a valid JWT/user cannot enumerate anything.
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.list_my_google_invitation_choices()), 0,
 'No signed-in user means no visible invitations');
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(
 '00000000-0000-4000-8000-000000000001'::uuid)$$,
 'P0001', 'GOOGLE_INVITATION_AUTH_REQUIRED', 'Acceptance requires a signed-in user');
RESET ROLE;

-- Matching Google user may see only two active offers from teachers A and B.
SELECT set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.list_my_google_invitation_choices()),2,
 'Google student sees exactly two own offers');
SELECT is((SELECT teacher_name FROM public.list_my_google_invitation_choices()
 WHERE teacher_id='89000000-0000-4000-8000-000000000001'::uuid),
 'Teacher A','Choice includes invited teacher display name');
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(NULL)$$,
 'P0001','GOOGLE_INVITATION_NOT_AVAILABLE','Cannot accept NULL invitation');
RESET ROLE;

-- Email-only identity cannot use Google invitation acceptance.
SELECT set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000012',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.list_my_google_invitation_choices()),0,
 'Password user cannot list Google invitation choices');
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.non_google')::uuid)$$,
 'P0001','GOOGLE_INVITATION_GOOGLE_IDENTITY_REQUIRED',
 'Password-only user cannot accept Google invitation');
RESET ROLE;

-- Expired, cancelled and inactive-teacher invitations are all refused.
SELECT set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000013',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.expired')::uuid)$$,
 'P0001','GOOGLE_INVITATION_NOT_AVAILABLE','Expired invitation cannot activate');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000014',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.cancelled')::uuid)$$,
 'P0001','GOOGLE_INVITATION_NOT_AVAILABLE','Cancelled invitation cannot activate');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000015',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.inactive_teacher')::uuid)$$,
 'P0001','GOOGLE_INVITATION_TEACHER_NOT_ACTIVE',
 'Inactive teacher invitation cannot activate');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000016',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.list_my_google_invitation_choices()),0,
 'No invitations visible to unrelated Google user');
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.a')::uuid)$$,
 'P0001','GOOGLE_INVITATION_NOT_AVAILABLE',
 'Unrelated Google user cannot accept somebody else invitation');
RESET ROLE;

-- Successful activation + idempotency; verify all writes and constraints.
SELECT set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
SELECT is(public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.a')::uuid),
 '89000000-0000-4000-8000-000000000001'::uuid,
 'Explicit acceptance returns the selected teacher UUID');
SELECT is(public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.a')::uuid),
 '89000000-0000-4000-8000-000000000001'::uuid,
 'Exact retry is idempotent');
SELECT is((SELECT count(*)::integer FROM public.list_my_google_invitation_choices()),0,
 'Accepted student has no outstanding selectable invitations');
SELECT throws_ok($$SELECT public.accept_my_pending_google_invitation(
 current_setting('crm_test.g43.b')::uuid)$$,
 'P0001','GOOGLE_INVITATION_NOT_AVAILABLE',
 'Second offer cannot be accepted after one teacher is selected');
RESET ROLE;

SELECT is((SELECT status FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.g43.a')::uuid),'accepted',
 'Selected invitation becomes accepted');
SELECT is((SELECT accepted_user_id FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.g43.a')::uuid),
 '89000000-0000-4000-8000-000000000011'::uuid,
 'Accepted invitation stores exact Auth UUID');
SELECT is((SELECT status FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.g43.b')::uuid),'cancelled',
 'Competing offer is cancelled atomically');
SELECT is((SELECT count(*)::integer FROM public.teacher_students
 WHERE student_id='89000000-0000-4000-8000-000000000011'::uuid AND is_active),1,
 'Exactly one active teacher relationship exists');
SELECT is((SELECT role::text FROM public.profiles
 WHERE id='89000000-0000-4000-8000-000000000011'::uuid),'student',
 'Google user remains student (no teacher role escalation)');

SELECT * FROM finish();
ROLLBACK;
