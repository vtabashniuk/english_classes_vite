-- CRM OAuth Gate 3a.1 (LOCAL only). This checks the dormant admission hook
-- directly. It does NOT enable Supabase Auth or exercise a real HTTP signup.
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
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('86000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','admission-teacher@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('86000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','admission-student@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('86000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','admission-teacher-inactive@crm-tests.invalid','!',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
UPDATE public.profiles SET role='teacher'::public.user_role
 WHERE id IN ('86000000-0000-4000-8000-000000000001'::uuid,
              '86000000-0000-4000-8000-000000000003'::uuid);
UPDATE public.profiles SET is_active=false
 WHERE id='86000000-0000-4000-8000-000000000003'::uuid;

-- A compact synthetic Before User Created event of the shape observed in Gate 1.
CREATE FUNCTION pg_temp.crm_admission_event(
  p_email text, p_ticket text DEFAULT NULL, p_provider text DEFAULT 'email',
  p_role text DEFAULT 'student'
) RETURNS jsonb LANGUAGE SQL AS $$
 SELECT jsonb_build_object('user',jsonb_build_object(
   'email', p_email,
   'app_metadata',jsonb_build_object('provider',p_provider),
   'user_metadata',jsonb_build_object('crm_email_invite_ticket',p_ticket,'role',p_role)
 ));
$$;

-- Browser cannot issue, view or revoke trusted one-time tickets.
SELECT ok(NOT has_schema_privilege('authenticated','crm_private','USAGE'),
 'Browser cannot access private admission schema');
SELECT ok(NOT has_table_privilege('authenticated',
 'crm_private.email_invitation_admissions','SELECT'),
 'Browser cannot read admission records');
SELECT ok(NOT has_function_privilege('authenticated',
 'public.issue_email_invitation_admission(uuid,text)','EXECUTE'),
 'Browser cannot mint email invitation tickets');
SELECT ok(NOT has_function_privilege('authenticated',
 'public.revoke_email_invitation_admission(text)','EXECUTE'),
 'Browser cannot revoke email invitation tickets');
SELECT ok(NOT has_function_privilege('anon',
 'public.crm_before_user_created_hook(jsonb)','EXECUTE'),
 'Anonymous client cannot call the Auth Hook');
SELECT ok(has_function_privilege('supabase_auth_admin',
 'public.crm_before_user_created_hook(jsonb)','EXECUTE'),
 'Supabase Auth is granted hook execution');
SELECT ok(has_function_privilege('service_role',
 'public.issue_email_invitation_admission(uuid,text)','EXECUTE'),
 'Server may request a ticket after validating teacher');

SELECT ok(length(set_config('crm_test.admission.ticket_a',
 public.issue_email_invitation_admission(
 '86000000-0000-4000-8000-000000000001'::uuid,
 '  ADMISSION-PENDING@CRM-TESTS.INVALID  '),true)) = 73,
 'Trusted active teacher gets an opaque random 73-character ticket');
SELECT is((SELECT email FROM crm_private.email_invitation_admissions
 WHERE ticket_hash=sha256(convert_to(current_setting('crm_test.admission.ticket_a'),'UTF8'))),
 'admission-pending@crm-tests.invalid',
 'Admission binds to normalized email');
SELECT is((SELECT count(*)::integer FROM auth.users
 WHERE email='admission-pending@crm-tests.invalid'),0,
 'Issuing a ticket does NOT create Auth user');
SELECT is((SELECT count(*)::integer FROM public.profiles
 WHERE email='admission-pending@crm-tests.invalid'),0,
 'Issuing a ticket does NOT create CRM student');
SELECT ok((SELECT count(*)=1 FROM crm_private.email_invitation_admissions
 WHERE ticket_hash=sha256(convert_to(current_setting('crm_test.admission.ticket_a'),'UTF8'))
   AND length(ticket_hash)=32),
 'Only a SHA-256 digest of the ticket is stored');

-- Fail closed against signUp attempts supplying forged metadata.
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('admission-pending@crm-tests.invalid',NULL)) #>> '{error,message}',
 'Invitation required to create a CRM account.',
 'No ticket: public email signup is denied even if invitation email matches');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('admission-pending@crm-tests.invalid',NULL,'email','teacher')) #>> '{error,message}',
 'Invitation required to create a CRM account.',
 'Untrusted teacher role does not grant admission');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('someone-else@crm-tests.invalid',
 current_setting('crm_test.admission.ticket_a'))) #>> '{error,http_code}',
 '403','Ticket is bound to exact normalized email');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('admission-pending@crm-tests.invalid','forged-ticket')) #>> '{error,http_code}',
 '403','Forged ticket is denied');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('admission-pending@crm-tests.invalid',
 current_setting('crm_test.admission.ticket_a'),'google')) #>> '{error,http_code}',
 '403','Google cannot reuse email invitation ticket');
SELECT ok((SELECT consumed_at IS NULL FROM crm_private.email_invitation_admissions
 WHERE ticket_hash=sha256(convert_to(current_setting('crm_test.admission.ticket_a'),'UTF8'))),
 'Invalid attempts do not consume a valid ticket');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('ADMISSION-PENDING@CRM-TESTS.INVALID',
 current_setting('crm_test.admission.ticket_a'))),'{}'::jsonb,
 'Valid unused ticket admits the invited email once');
SELECT ok((SELECT consumed_at IS NOT NULL FROM crm_private.email_invitation_admissions
 WHERE ticket_hash=sha256(convert_to(current_setting('crm_test.admission.ticket_a'),'UTF8'))),
 'Successful admission atomically marks the ticket consumed');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('admission-pending@crm-tests.invalid',
 current_setting('crm_test.admission.ticket_a'))) #>> '{error,http_code}',
 '403','Replayed consumed ticket is rejected');
SELECT is(public.revoke_email_invitation_admission(
 current_setting('crm_test.admission.ticket_a')),false,
 'Already consumed ticket cannot be revoked');

SELECT ok(set_config('crm_test.admission.ticket_b',
 public.issue_email_invitation_admission(
 '86000000-0000-4000-8000-000000000001'::uuid,
 'admission-expired@crm-tests.invalid'),true)
 <> current_setting('crm_test.admission.ticket_a'),
 'Each request uses an independent strong ticket');
UPDATE crm_private.email_invitation_admissions
 SET issued_at=now()-interval '20 minutes',
     expires_at=now()-interval '1 second'
 WHERE ticket_hash=sha256(convert_to(current_setting('crm_test.admission.ticket_b'),'UTF8'));
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('admission-expired@crm-tests.invalid',
 current_setting('crm_test.admission.ticket_b'))) #>> '{error,http_code}',
 '403','Expired ticket is denied');
SELECT ok((SELECT consumed_at IS NULL FROM crm_private.email_invitation_admissions
 WHERE ticket_hash=sha256(convert_to(current_setting('crm_test.admission.ticket_b'),'UTF8'))),
 'Expired ticket remains unconsumed');

SELECT ok(length(set_config('crm_test.admission.ticket_c',
 public.issue_email_invitation_admission(
 '86000000-0000-4000-8000-000000000001'::uuid,
 'admission-revoked@crm-tests.invalid'),true))=73,
 'Third ticket is independently issued');
SELECT is(public.revoke_email_invitation_admission(
 current_setting('crm_test.admission.ticket_c')),true,
 'Server can revoke an unconsumed invitation ticket');
SELECT is(public.crm_before_user_created_hook(
 pg_temp.crm_admission_event('admission-revoked@crm-tests.invalid',
 current_setting('crm_test.admission.ticket_c'))) #>> '{error,http_code}',
 '403','Revoked ticket is denied');
SELECT is(public.revoke_email_invitation_admission(
 current_setting('crm_test.admission.ticket_c')),false,
 'Revoking twice does not succeed');

SELECT throws_ok($$select public.issue_email_invitation_admission(
 '86000000-0000-4000-8000-000000000002'::uuid,'nope@crm-tests.invalid')$$,
 'P0001','ADMISSION_TEACHER_NOT_ACTIVE',
 'Student cannot request trusted admission ticket');
SELECT throws_ok($$select public.issue_email_invitation_admission(
 '86000000-0000-4000-8000-000000000003'::uuid,'nope@crm-tests.invalid')$$,
 'P0001','ADMISSION_TEACHER_NOT_ACTIVE',
 'Inactive teacher cannot request admission');

SELECT * FROM finish();
ROLLBACK;
