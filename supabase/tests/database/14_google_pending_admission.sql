-- CRM Gate 4.2-A: local-only synthetic pgTAP test, always ROLLBACK.
-- Verifies the admission decision, not a real Google identity token.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(31);
DO $$ BEGIN
  IF current_database() <> 'postgres'
     OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'LOCAL_TEST_ONLY: use npx supabase test db --local';
  END IF;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
 ('88000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate42-teacher-active@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('88000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate42-teacher-inactive@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('88000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','gate42-teacher-other@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
UPDATE public.profiles SET role='teacher'::public.user_role
WHERE id IN ('88000000-0000-4000-8000-000000000001'::uuid,
             '88000000-0000-4000-8000-000000000002'::uuid,
             '88000000-0000-4000-8000-000000000003'::uuid);
UPDATE public.profiles SET is_active=false
WHERE id='88000000-0000-4000-8000-000000000002'::uuid;

-- Reflects Gate 4.1 keys: app_metadata.provider/providers, user_metadata
-- email_verified; identities is empty at this point, not a reliable source.
CREATE FUNCTION pg_temp.gate42_event(
 p_email text,
 p_provider text DEFAULT 'google',
 p_verified boolean DEFAULT true,
 p_providers boolean DEFAULT true,
 p_anonymous boolean DEFAULT false,
 p_ticket text DEFAULT NULL
) RETURNS jsonb LANGUAGE SQL AS $fn$
 SELECT jsonb_build_object(
  'metadata', jsonb_build_object('name','before-user-created'),
  'user', jsonb_build_object(
   'email',p_email,'is_anonymous',p_anonymous,
   'app_metadata',jsonb_build_object(
     'provider',p_provider,
     'providers',CASE WHEN p_providers THEN jsonb_build_array(p_provider)
                      ELSE '[]'::jsonb END),
   'user_metadata',jsonb_build_object(
     'email_verified',p_verified,'role','teacher',
     'provider','google','crm_email_invite_ticket',p_ticket),
   'identities','[]'::jsonb
  )
 );
$fn$;

SELECT ok(NOT has_function_privilege('anon',
  'public.crm_before_user_created_hook(jsonb)','EXECUTE'),
 'Anonymous browser cannot execute the Auth Hook');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.crm_before_user_created_hook(jsonb)','EXECUTE'),
 'Authenticated browser cannot execute the Auth Hook');
SELECT ok(has_function_privilege('supabase_auth_admin',
  'public.crm_before_user_created_hook(jsonb)','EXECUTE'),
 'Only Supabase Auth has the required Hook permission');
SELECT ok(NOT has_table_privilege('authenticated',
  'crm_private.pending_google_invitations','SELECT'),
 'Invitation records remain inaccessible to browser roles');

SELECT is(public.crm_before_user_created_hook(
  pg_temp.gate42_event('gate42-valid@crm-tests.invalid')) #>> '{error,http_code}',
 '403','Uninvited Google signup is blocked');
SELECT is(public.crm_before_user_created_hook(
  pg_temp.gate42_event('gate42-valid@crm-tests.invalid','email')) #>> '{error,http_code}',
 '403','Plain email signup without a ticket remains blocked');

SELECT ok(length(set_config('crm_test.gate42.valid',
 public.create_pending_google_invitation(
  '88000000-0000-4000-8000-000000000001'::uuid,
  'GATE42-VALID@CRM-TESTS.INVALID','Verified invite')::text,true))=36,
 'Active teacher can create pending Google invitation');
SELECT is((SELECT email FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.gate42.valid')::uuid),
 'gate42-valid@crm-tests.invalid', 'Invitation email is normalized');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid')),
 '{}'::jsonb,'Verified Google account matching pending invite is admissible');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('GATE42-VALID@CRM-TESTS.INVALID')),
 '{}'::jsonb,'Comparison uses normalized email');
SELECT is((SELECT status FROM crm_private.pending_google_invitations
 WHERE id=current_setting('crm_test.gate42.valid')::uuid),
 'pending','Admission does not prematurely accept invitation');
SELECT is((SELECT count(*)::integer FROM auth.users
 WHERE email='gate42-valid@crm-tests.invalid'),0,
 'Hook decision itself does not create Auth user');
SELECT is((SELECT count(*)::integer FROM public.teacher_students s
 JOIN public.profiles p ON p.id=s.student_id
 WHERE p.email='gate42-valid@crm-tests.invalid'),0,
 'Admission does not attach student to teacher');

SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid','email')) #>> '{error,http_code}',
 '403','Forged user_metadata.provider cannot convert email signup to Google');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid','github')) #>> '{error,http_code}',
 '403','Other provider cannot reuse Google pending invite');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid','google',false)) #>> '{error,http_code}',
 '403','Unverified Google email is rejected');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid','google',true,false)) #>> '{error,http_code}',
 '403','Google must appear in GoTrue provider list');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid','google',true,true,true)) #>> '{error,http_code}',
 '403','Anonymous flag is not permitted');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid','google',NULL)) #>> '{error,http_code}',
 '403','Missing email_verified fails closed');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('other-person@crm-tests.invalid')) #>> '{error,http_code}',
 '403','Invitation does not admit a different email');

SELECT ok(length(set_config('crm_test.gate42.cancelled',
 public.create_pending_google_invitation(
  '88000000-0000-4000-8000-000000000001'::uuid,
  'gate42-cancelled@crm-tests.invalid','To cancel')::text,true))=36,
 'Pending cancellation fixture created');
UPDATE crm_private.pending_google_invitations
SET status='cancelled',updated_at=now()
WHERE id=current_setting('crm_test.gate42.cancelled')::uuid;
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-cancelled@crm-tests.invalid')) #>> '{error,http_code}',
 '403','Cancelled invitation denies signup');

SELECT ok(length(set_config('crm_test.gate42.expired',
 public.create_pending_google_invitation(
  '88000000-0000-4000-8000-000000000001'::uuid,
  'gate42-expired@crm-tests.invalid','To expire')::text,true))=36,
 'Expired fixture created');
UPDATE crm_private.pending_google_invitations
SET created_at=now()-interval '20 days',expires_at=now()-interval '1 second'
WHERE id=current_setting('crm_test.gate42.expired')::uuid;
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-expired@crm-tests.invalid')) #>> '{error,http_code}',
 '403','Expired invitation denies signup');

SELECT ok(length(set_config('crm_test.gate42.inactive',
 public.create_pending_google_invitation(
  '88000000-0000-4000-8000-000000000003'::uuid,
  'gate42-inactive@crm-tests.invalid','To deactivate')::text,true))=36,
 'Teacher deactivation fixture created');
UPDATE public.profiles SET is_active=false
WHERE id='88000000-0000-4000-8000-000000000003'::uuid;
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-inactive@crm-tests.invalid')) #>> '{error,http_code}',
 '403','Inactive teacher invitation denies signup');

SELECT ok(length(set_config('crm_test.gate42.existing',
 public.create_pending_google_invitation(
  '88000000-0000-4000-8000-000000000001'::uuid,
  'gate42-existing@crm-tests.invalid','Collision')::text,true))=36,
 'Existing-account collision fixture created');
INSERT INTO auth.users (
 id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
 '88000000-0000-4000-8000-000000000004',
 '00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','gate42-existing@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now()
);
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-existing@crm-tests.invalid')) #>> '{error,http_code}',
 '403','Existing account cannot create duplicate via pending invite');

UPDATE public.profiles SET is_active=true
WHERE id='88000000-0000-4000-8000-000000000003'::uuid;
SELECT ok(length(set_config('crm_test.gate42.second',
 public.create_pending_google_invitation(
  '88000000-0000-4000-8000-000000000003'::uuid,
  'gate42-valid@crm-tests.invalid','Second teacher')::text,true))=36,
 'A different teacher may also invite the same email');
SELECT is((SELECT count(*)::integer
 FROM crm_private.pending_google_invitations
 WHERE email='gate42-valid@crm-tests.invalid' AND status='pending'), 2,
 'Two pending invitations never create two Auth users');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.gate42_event('gate42-valid@crm-tests.invalid')),
 '{}'::jsonb, 'Admission allows signup once; choosing a teacher is Gate 4.3');

SELECT * FROM finish();
ROLLBACK;
