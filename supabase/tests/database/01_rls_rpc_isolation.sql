-- CRM Stage 1.5.2b: LOCAL pgTAP integration regression.
-- Run ONLY with: npx supabase test db --local
-- The test runner wraps each file in a transaction; ROLLBACK is extra protection.
-- Synthetic accounts cannot send mail and are never committed.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(23);

-- Sanity check only: cloud databases may have the same name and role.
-- Real isolation is provided by the explicit --local CLI flag.
-- NEVER use --linked or --db-url for these tests.
DO $$
BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'LOCAL_TEST_ONLY: run via npx supabase test db --local';
  END IF;
END $$;

-- All users are synthetic, unique to this test, and rolled back afterward.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','ci.teacher.a@crm-tests.invalid','!',now(), '{"provider":"email","providers":["email"]}', '{"role":"teacher"}', now(), now()),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','ci.teacher.b@crm-tests.invalid','!',now(), '{"provider":"email","providers":["email"]}', '{"role":"teacher"}', now(), now()),
  ('71000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','ci.student.a@crm-tests.invalid','!',now(), '{"provider":"email","providers":["email"]}', '{"role":"student"}', now(), now()),
  ('71000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','ci.student.b@crm-tests.invalid','!',now(), '{"provider":"email","providers":["email"]}', '{"role":"student"}', now(), now());

-- handle_new_user() creates profiles with the expected roles.
INSERT INTO public.teacher_students (teacher_id, student_id)
VALUES
  ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003'),
  ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004');

-- Material metadata satisfies current validation triggers.
INSERT INTO public.materials (id, teacher_id, title, description, url, tags)
VALUES
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Owned and shared A', 'Test description', 'https://example.invalid/test-a', ARRAY['security']),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', 'Unshared A', 'Test description', 'https://example.invalid/test-b', ARRAY['security']),
  ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000002', 'Owned and shared B', 'Test description', 'https://example.invalid/test-c', ARRAY['security']);
INSERT INTO public.student_materials (student_id, material_id)
VALUES
  ('71000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000003');

-- Pending records are enough to test payment RLS without making real ledger postings.
INSERT INTO public.payments (teacher_id, student_id, amount_minor, currency, provider, payment_method, status)
VALUES
  ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003', 10000, 'UAH', 'manual', 'cash', 'pending'),
  ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004', 20000, 'UAH', 'manual', 'cash', 'pending');

-- Simulate the JWT subject and the actual PostgREST database role.
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok(public.is_teacher(), 'Teacher A is recognized as an active teacher');
SELECT is((SELECT count(*)::integer FROM public.profiles WHERE role='student'), 1, 'Teacher A sees only assigned student A');
SELECT is((SELECT count(*)::integer FROM public.teacher_students), 1, 'Teacher A sees only own relationship');
SELECT is((SELECT count(*)::integer FROM public.materials), 2, 'Teacher A sees only own materials');
SELECT is((SELECT count(*)::integer FROM public.payments), 1, 'Teacher A sees only own payments');
SELECT ok(NOT public.is_my_student('71000000-0000-4000-8000-000000000004'), 'Teacher A cannot claim student B');
SELECT throws_ok(
  $$SELECT public.create_lesson('71000000-0000-4000-8000-000000000004'::uuid, (current_date+21)::date, '10:00'::time, null::text)$$,
  'P0001', 'STUDENT_NOT_FOUND', 'Teacher A cannot create a lesson for teacher B student'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.profiles WHERE role='student'), 1, 'Teacher B sees only student B');
SELECT is((SELECT count(*)::integer FROM public.materials), 1, 'Teacher B does not see teacher A materials');
SELECT is((SELECT count(*)::integer FROM public.payments), 1, 'Teacher B does not see teacher A payments');
SELECT throws_ok(
  $$SELECT public.revoke_material_from_student('72000000-0000-4000-8000-000000000001'::uuid, '71000000-0000-4000-8000-000000000003'::uuid)$$,
  'P0001', 'ACCESS_DENIED', 'Teacher B cannot revoke teacher A material'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.is_teacher(), 'Student A cannot masquerade as a teacher');
SELECT is((SELECT count(*)::integer FROM public.profiles WHERE role='student'), 1, 'Student A sees only own student profile');
SELECT is((SELECT count(*)::integer FROM public.teacher_students), 1, 'Student A sees only own relationship');
SELECT is((SELECT count(*)::integer FROM public.materials), 1, 'Student A sees only explicitly shared material');
SELECT is((SELECT count(*)::integer FROM public.student_materials), 1, 'Student A sees only own active material grant');
SELECT is((SELECT count(*)::integer FROM public.payments), 1, 'Student A sees only own payments');
SELECT throws_ok(
  $$SELECT public.revoke_material_from_student('72000000-0000-4000-8000-000000000001'::uuid, '71000000-0000-4000-8000-000000000003'::uuid)$$,
  'P0001', 'ACCESS_DENIED', 'Student cannot call teacher-only material revoke RPC'
);
RESET ROLE;

-- Legitimate revocation/restoration must alter student visibility atomically.
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.revoke_material_from_student('72000000-0000-4000-8000-000000000001'::uuid,'71000000-0000-4000-8000-000000000003'::uuid)$$,
  'Owning teacher can revoke shared material'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.materials), 0, 'Student loses material visibility after revoke');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.restore_material_access('72000000-0000-4000-8000-000000000001'::uuid,'71000000-0000-4000-8000-000000000003'::uuid)$$,
  'Owning teacher can restore a valid material grant'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.materials), 1, 'Student regains access after explicit restore');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.materials), 1, 'Student B still sees only own material');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
