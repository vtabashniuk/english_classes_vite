-- Gate 4.5-A / P1: synthetic, rollback-only recovery tests.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(16);
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres','supabase_admin')
  THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY'; END IF;
END $$;

INSERT INTO auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-teacher@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
UPDATE public.profiles SET role='teacher'::public.user_role
  WHERE id='91000000-0000-4000-8000-000000000001'::uuid;

-- Pre-admission pending invitations, issued before the corresponding Auth users.
SELECT set_config('crm_test.g45.expired', public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,
 'g45-expired@crm-tests.invalid','Old')::text,true);
SELECT set_config('crm_test.g45.cancelled', public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,
 'g45-cancelled@crm-tests.invalid','Old')::text,true);
UPDATE crm_private.pending_google_invitations
  SET created_at=now()-interval '20 days',
      updated_at=now()-interval '20 days', expires_at=now()-interval '6 days'
  WHERE id=current_setting('crm_test.g45.expired')::uuid;
UPDATE crm_private.pending_google_invitations SET status='cancelled'
  WHERE id=current_setting('crm_test.g45.cancelled')::uuid;

INSERT INTO auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('91000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-expired@crm-tests.invalid','!',now(),'{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('91000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-cancelled@crm-tests.invalid','!',now(),'{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('91000000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-email@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('91000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-linked@crm-tests.invalid','!',now(),'{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('91000000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-unconfirmed@crm-tests.invalid','!',NULL,'{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('91000000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-inactive@crm-tests.invalid','!',now(),'{"provider":"google","providers":["google"]}','{}',now(),now()),
 ('91000000-0000-4000-8000-000000000017','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','g45-teacher-google@crm-tests.invalid','!',now(),'{"provider":"google","providers":["google"]}','{}',now(),now());

INSERT INTO auth.identities(id,provider_id,user_id,identity_data,provider)
VALUES
 (gen_random_uuid(),'g45-11','91000000-0000-4000-8000-000000000011'::uuid,'{"email":"g45-expired@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'g45-12','91000000-0000-4000-8000-000000000012'::uuid,'{"email":"g45-cancelled@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'g45-14','91000000-0000-4000-8000-000000000014'::uuid,'{"email":"g45-linked@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'g45-15','91000000-0000-4000-8000-000000000015'::uuid,'{"email":"g45-unconfirmed@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'g45-16','91000000-0000-4000-8000-000000000016'::uuid,'{"email":"g45-inactive@crm-tests.invalid","email_verified":true}'::jsonb,'google'),
 (gen_random_uuid(),'g45-17','91000000-0000-4000-8000-000000000017'::uuid,'{"email":"g45-teacher-google@crm-tests.invalid","email_verified":true}'::jsonb,'google');
UPDATE public.profiles SET is_active=false
 WHERE id='91000000-0000-4000-8000-000000000016'::uuid;
UPDATE public.profiles SET role='teacher'::public.user_role
 WHERE id='91000000-0000-4000-8000-000000000017'::uuid;
INSERT INTO public.teacher_students(teacher_id,student_id,is_active)
VALUES('91000000-0000-4000-8000-000000000001'::uuid,
       '91000000-0000-4000-8000-000000000014'::uuid,true);

SELECT is(public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,
 'g45-expired@crm-tests.invalid','Renewed'),
 current_setting('crm_test.g45.expired')::uuid,
 'Expired pending offer may be renewed for already admitted unlinked Google student');
SELECT ok((SELECT expires_at > now()+interval '13 days'
 FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.g45.expired')::uuid),'Renewal extends expiry');
SELECT is((SELECT count(*)::integer FROM crm_private.pending_google_invitations
 WHERE email='g45-expired@crm-tests.invalid'),1,'Renewal does not duplicate invitation');
SELECT is((SELECT count(*)::integer FROM auth.users WHERE email='g45-expired@crm-tests.invalid'),1,
 'Renewal preserves the original Auth user');
SELECT ok(public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,
 'g45-cancelled@crm-tests.invalid','Reissued') <> current_setting('crm_test.g45.cancelled')::uuid,
 'Cancelled offer can be replaced by a new pending offer');
SELECT is((SELECT count(*)::integer FROM crm_private.pending_google_invitations
 WHERE email='g45-cancelled@crm-tests.invalid' AND status='pending'),1,
 'Only one active pending invitation exists for cancelled case');
SELECT is((SELECT count(*)::integer FROM auth.users WHERE email='g45-cancelled@crm-tests.invalid'),1,
 'Cancelled re-invite does not create another Auth account');
SELECT throws_ok($$SELECT public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,'g45-email@crm-tests.invalid','Not google')$$,
 'P0001','INVITATION_ACCOUNT_ALREADY_EXISTS','Existing email-only user cannot be adopted');
SELECT throws_ok($$SELECT public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,'g45-linked@crm-tests.invalid','Linked')$$,
 'P0001','INVITATION_ACCOUNT_ALREADY_EXISTS','Linked Google student cannot be re-invited');
SELECT throws_ok($$SELECT public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,'g45-unconfirmed@crm-tests.invalid','Unconfirmed')$$,
 'P0001','INVITATION_ACCOUNT_ALREADY_EXISTS','Unconfirmed Google user denied');
SELECT throws_ok($$SELECT public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,'g45-inactive@crm-tests.invalid','Inactive')$$,
 'P0001','INVITATION_ACCOUNT_ALREADY_EXISTS','Inactive Google student denied');
SELECT throws_ok($$SELECT public.create_pending_google_invitation(
 '91000000-0000-4000-8000-000000000001'::uuid,'g45-teacher-google@crm-tests.invalid','Teacher')$$,
 'P0001','INVITATION_ACCOUNT_ALREADY_EXISTS','Google teacher denied');
SELECT ok(NOT has_function_privilege('authenticated',
 'public.create_pending_google_invitation(uuid,text,text)','EXECUTE'),
 'Browser cannot issue invitation directly');
SELECT ok(has_function_privilege('service_role',
 'public.create_pending_google_invitation(uuid,text,text)','EXECUTE'),
 'Only trusted backend can invoke invitation creation');
SELECT is((SELECT count(*)::integer FROM public.teacher_students
 WHERE student_id='91000000-0000-4000-8000-000000000011'::uuid),0,
 'Renewing does not create teacher link');
SELECT is((SELECT status FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.g45.cancelled')::uuid),'cancelled',
 'Cancelled historical offer stays cancelled');
SELECT * FROM finish();
ROLLBACK;
