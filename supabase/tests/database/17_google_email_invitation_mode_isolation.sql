-- Gate 4.5-B: simulated mixed-mode invitation conflict, all data rolled back.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(27);
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres', 'supabase_admin')
  THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY'; END IF;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
 ('92000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','g45mix-teacher-a@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('92000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','g45mix-teacher-b@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now());
UPDATE public.profiles SET role='teacher'::public.user_role
WHERE id IN ('92000000-0000-4000-8000-000000000001'::uuid,
             '92000000-0000-4000-8000-000000000002'::uuid);

-- Pending offers are created before the matching Auth accounts.
SELECT set_config('crm_test.g45mix.fresh', public.create_pending_google_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-fresh@crm-tests.invalid','Fresh')::text,true);
SELECT set_config('crm_test.g45mix.google', public.create_pending_google_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-google@crm-tests.invalid','Google')::text,true);
SELECT set_config('crm_test.g45mix.email_pending', public.create_pending_google_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-email-pending@crm-tests.invalid','Email User')::text,true);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
 ('92000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','g45mix-google@crm-tests.invalid','!',now(),
 '{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('92000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','g45mix-email@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('92000000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','g45mix-unlinked-google@crm-tests.invalid','!',now(),
 '{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('92000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','g45mix-email-pending@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now());
INSERT INTO auth.identities (id,provider_id,user_id,identity_data,provider)
VALUES
 (gen_random_uuid(),'g45mix-11','92000000-0000-4000-8000-000000000011'::uuid,
  '{"email":"g45mix-google@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'g45mix-13','92000000-0000-4000-8000-000000000013'::uuid,
  '{"email":"g45mix-unlinked-google@crm-tests.invalid","email_verified":true}'::jsonb,'google');

SELECT throws_ok($$SELECT public.issue_email_invitation_admission(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-fresh@crm-tests.invalid')$$,
 'P0001', 'ADMISSION_GOOGLE_INVITATION_PENDING',
 'Email ticket issuance blocked while a Google invitation is active');
SELECT is((SELECT count(*)::integer FROM crm_private.email_invitation_admissions
 WHERE email='g45mix-fresh@crm-tests.invalid'),0,
 'Conflict never issues a bypassable email admission ticket');
SELECT throws_ok($$SELECT public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000011'::uuid,
 'g45mix-google@crm-tests.invalid')$$,
 'P0001','EMAIL_LINK_PENDING_GOOGLE_INVITATION',
 'Existing Google account with pending offer cannot be auto-linked by email');
SELECT is((SELECT count(*)::integer FROM public.teacher_students
 WHERE student_id='92000000-0000-4000-8000-000000000011'::uuid),0,
 'Blocked email invitation leaves Google student unlinked');
SELECT is((SELECT status FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.g45mix.google')::uuid),'pending',
 'Failed cross-method attempt does not silently consume Google offer');
SELECT throws_ok($$SELECT public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000013'::uuid,
 'g45mix-unlinked-google@crm-tests.invalid')$$,
 'P0001','EMAIL_LINK_GOOGLE_ACCEPTANCE_REQUIRED',
 'Google-only account cannot be attached by email even with no pending offer');
SELECT throws_ok($$SELECT public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000014'::uuid,
 'g45mix-email-pending@crm-tests.invalid')$$,
 'P0001','EMAIL_LINK_PENDING_GOOGLE_INVITATION',
 'Even email-only existing account cannot bypass its pending Google offer');

SELECT is(public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000012'::uuid,
 'g45mix-email@crm-tests.invalid'), 'relationship_restored',
 'Legacy email-only profile may still be safely linked to teacher');
SELECT is((SELECT count(*)::integer FROM public.teacher_students
 WHERE student_id='92000000-0000-4000-8000-000000000012'::uuid AND is_active),1,
 'Legacy email flow creates exactly one active relationship');
SELECT is(public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000012'::uuid,
 'g45mix-email@crm-tests.invalid'),'already_linked',
 'Existing email link remains idempotent');
SELECT throws_ok($$SELECT public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000002'::uuid,
 '92000000-0000-4000-8000-000000000012'::uuid,
 'g45mix-email@crm-tests.invalid')$$,
 'P0001','EMAIL_LINK_OTHER_ACTIVE_TEACHER',
 'Cannot seize a student already linked to another active teacher');

-- Simulate a legacy stale pending row on an already-linked email-only student.
INSERT INTO crm_private.pending_google_invitations(teacher_id,email,full_name)
VALUES('92000000-0000-4000-8000-000000000001'::uuid,
       'g45mix-email@crm-tests.invalid','Legacy stale');
SELECT is(public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000012'::uuid,
 'g45mix-email@crm-tests.invalid'),'already_linked',
 'Repeated email invitation safely repairs stale Google offers');
SELECT is((SELECT status FROM crm_private.pending_google_invitations
 WHERE email='g45mix-email@crm-tests.invalid'),'cancelled',
 'Stale pending Google offer becomes cancelled');
UPDATE public.teacher_students SET is_active=false
WHERE teacher_id='92000000-0000-4000-8000-000000000001'::uuid
  AND student_id='92000000-0000-4000-8000-000000000012'::uuid;
SELECT is(public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000012'::uuid,
 'g45mix-email@crm-tests.invalid'),'relationship_restored',
 'Existing email-only relationship is reactivated after a pause');
SELECT is((SELECT length(public.issue_email_invitation_admission(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-unrelated@crm-tests.invalid'))),73,
 'Unrelated fresh email invitation still issues valid ticket');

-- A Google offer created AFTER a valid email ticket also blocks actual Auth hook.
SELECT set_config('crm_test.g45mix.ticket', public.issue_email_invitation_admission(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-race@crm-tests.invalid'),true);
SELECT set_config('crm_test.g45mix.race', public.create_pending_google_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-race@crm-tests.invalid','Race')::text,true);
SELECT is(public.crm_before_user_created_hook(jsonb_build_object('user',jsonb_build_object(
 'email','g45mix-race@crm-tests.invalid',
 'app_metadata',jsonb_build_object('provider','email'),
 'user_metadata',jsonb_build_object('crm_email_invite_ticket',current_setting('crm_test.g45mix.ticket'))
 ))) #>> '{error,http_code}', '403',
 'Before User Created Hook rejects email ticket if a Google offer appeared later');
SELECT ok((SELECT consumed_at IS NULL FROM crm_private.email_invitation_admissions
 WHERE email='g45mix-race@crm-tests.invalid'),
 'Rejected email ticket remains unconsumed');
UPDATE crm_private.pending_google_invitations SET status='cancelled'
WHERE id=current_setting('crm_test.g45mix.race')::uuid;
SELECT is(public.crm_before_user_created_hook(jsonb_build_object('user',jsonb_build_object(
 'email','g45mix-race@crm-tests.invalid',
 'app_metadata',jsonb_build_object('provider','email'),
 'user_metadata',jsonb_build_object('crm_email_invite_ticket',current_setting('crm_test.g45mix.ticket'))
 ))),'{}'::jsonb,
 'Normal email hook admission works again once conflicting offer is cancelled');
SELECT is((SELECT count(*)::integer FROM crm_private.email_invitation_admissions
 WHERE email='g45mix-race@crm-tests.invalid' AND consumed_at IS NOT NULL),1,
 'Email ticket is consumed once after Google conflict is resolved');

UPDATE crm_private.pending_google_invitations SET status='cancelled'
WHERE id=current_setting('crm_test.g45mix.fresh')::uuid;
SELECT is(length(public.issue_email_invitation_admission(
 '92000000-0000-4000-8000-000000000001'::uuid,
 'g45mix-fresh@crm-tests.invalid')),73,
 'Email invite becomes possible after cancelling the pending Google offer');

-- Explicit Google consent remains the ONLY way to activate the unlinked Google user.
SELECT set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
SELECT is(public.accept_my_pending_google_invitation(
 current_setting('crm_test.g45mix.google')::uuid),
 '92000000-0000-4000-8000-000000000001'::uuid,
 'Google student can still explicitly accept original invitation');
RESET ROLE;
SELECT is((SELECT status FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.g45mix.google')::uuid),'accepted',
 'Explicit consent marks exact Google invitation accepted');
SELECT is((SELECT count(*)::integer FROM public.teacher_students
 WHERE student_id='92000000-0000-4000-8000-000000000011'::uuid AND is_active),1,
 'Consent, not email invitation, creates the Google relationship');
SELECT is(public.link_existing_student_email_invitation(
 '92000000-0000-4000-8000-000000000001'::uuid,
 '92000000-0000-4000-8000-000000000011'::uuid,
 'g45mix-google@crm-tests.invalid'),'already_linked',
 'After consent, same-teacher email call is idempotent, never reattaches');
SELECT ok(NOT has_function_privilege('authenticated',
 'public.link_existing_student_email_invitation(uuid,uuid,text)','EXECUTE'),
 'Authenticated browser cannot call trusted relationship RPC');
SELECT ok(has_function_privilege('service_role',
 'public.link_existing_student_email_invitation(uuid,uuid,text)','EXECUTE'),
 'Server-side service role is allowed to perform guarded relationship RPC');
SELECT ok(NOT has_schema_privilege('authenticated','crm_private','USAGE'),
 'Private pending invitation rows stay unreadable from browser');
SELECT * FROM finish();
ROLLBACK;
