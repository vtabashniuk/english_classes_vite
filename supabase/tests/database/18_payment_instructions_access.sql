-- Release S2: local-only pgTAP teacher payment instructions RLS.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(14);
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres', 'supabase_admin')
  THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY'; END IF;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
('93000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','s2-teacher-a@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('93000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','s2-teacher-b@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('93000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','s2-student-a@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('93000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','s2-student-b@crm-tests.invalid','!',now(),
 '{"provider":"email","providers":["email"]}','{}',now(),now());

UPDATE public.profiles SET role='teacher'::public.user_role
WHERE id IN ('93000000-0000-4000-8000-000000000001'::uuid,
             '93000000-0000-4000-8000-000000000002'::uuid);

INSERT INTO public.teacher_students (teacher_id, student_id, is_active) VALUES
('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000003', true),
('93000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000004', true);

INSERT INTO public.teacher_payment_instructions
 (teacher_id, currency, recipient_name, is_published) VALUES
('93000000-0000-4000-8000-000000000001','UAH','Teacher A published',true),
('93000000-0000-4000-8000-000000000001','EUR','Teacher A private',false),
('93000000-0000-4000-8000-000000000002','UAH','Teacher B published',true);

SELECT ok((SELECT count(*)=3 FROM public.teacher_payment_instructions),
          'Fixture creates three per-teacher/currency rows');

SELECT set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.teacher_payment_instructions), 2,
          'Teacher A sees own published and draft instructions');
SELECT lives_ok($$UPDATE public.teacher_payment_instructions
  SET notes='Updated by owner'
  WHERE teacher_id='93000000-0000-4000-8000-000000000001'::uuid AND currency='EUR'$$,
  'Teacher A can edit own draft');
SELECT is((SELECT count(*)::int FROM public.teacher_payment_instructions WHERE recipient_name LIKE 'Teacher B%'), 0,
          'Teacher A cannot read teacher B payment details');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.teacher_payment_instructions), 1,
          'Student A sees only teacher A published row');
SELECT is((SELECT recipient_name FROM public.teacher_payment_instructions LIMIT 1),
          'Teacher A published', 'Student A sees correct teacher recipient');
SELECT throws_ok($$INSERT INTO public.teacher_payment_instructions (teacher_id,currency,recipient_name)
  VALUES ('93000000-0000-4000-8000-000000000001'::uuid,'USD','student forged')$$,
  '42501', null, 'Student cannot create teacher instructions');
SELECT is((SELECT count(*)::int FROM public.teacher_payment_instructions WHERE currency='EUR'), 0,
          'Unpublished EUR row is hidden from student');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.teacher_payment_instructions), 1,
          'Student B sees only teacher B published instructions');
SELECT is((SELECT recipient_name FROM public.teacher_payment_instructions LIMIT 1),
          'Teacher B published', 'Student B cannot see teacher A recipient');
RESET ROLE;

UPDATE public.teacher_students SET is_active=false
WHERE teacher_id='93000000-0000-4000-8000-000000000001'::uuid
  AND student_id='93000000-0000-4000-8000-000000000003'::uuid;

SELECT set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.teacher_payment_instructions), 0,
          'Revoked relationship immediately revokes student access');
RESET ROLE;

UPDATE public.profiles SET is_active = false
WHERE id = '93000000-0000-4000-8000-000000000004'::uuid;
SELECT set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.teacher_payment_instructions), 0,
          'Deactivated student cannot read even published payment instructions');
RESET ROLE;

SELECT throws_ok($$INSERT INTO public.teacher_payment_instructions (teacher_id,currency,payment_url)
 VALUES ('93000000-0000-4000-8000-000000000001'::uuid,'USD','javascript:alert(1)')$$,
 '23514', null, 'Database rejects non-HTTPS payment URLs');
SELECT ok((SELECT count(*)::int FROM public.teacher_payment_instructions WHERE is_published=false)=1,
          'Private rows remain private after test sequence');

SELECT * FROM finish();
ROLLBACK;
