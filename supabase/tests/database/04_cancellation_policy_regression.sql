-- CRM Stage 1.5.2d: Student cancellation requests and financial decisions.
-- LOCAL ONLY: npx supabase test db --local
-- All fixture users, lessons and ledger rows are synthetic and rolled back.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(36);

-- Sanity check only: the explicit --local flag is the real protection.
DO $$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'LOCAL_TEST_ONLY: use npx supabase test db --local';
  END IF;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
 ('75000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancel.teacher.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('75000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancel.teacher.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('75000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancel.student.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"student"}',now(),now()),
 ('75000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancel.student.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"student"}',now(),now());

INSERT INTO public.teacher_students (teacher_id, student_id) VALUES
 ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000003'),
 ('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000004');

INSERT INTO public.teacher_settings (teacher_id, free_cancellation_hours)
VALUES ('75000000-0000-4000-8000-000000000001', 6),
       ('75000000-0000-4000-8000-000000000002', 6);

INSERT INTO public.student_lesson_rates
  (teacher_id, student_id, amount_minor, currency, effective_from)
VALUES
 ('75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000003', 82000, 'UAH', current_date - 30);

-- Direct inserts here are intentional. Short-notice scenarios must work
-- regardless of the wall-clock time at which the test suite is executed;
-- create_lesson would otherwise enforce the teacher's weekly hours.
-- Each lesson is 50 minutes and separated by at least ten minutes.
INSERT INTO public.lessons
  (id, teacher_id, student_id, starts_at, ends_at, duration_minutes)
SELECT l.id::uuid,
       '75000000-0000-4000-8000-000000000001'::uuid,
       '75000000-0000-4000-8000-000000000003'::uuid,
       now() + make_interval(hours => l.hours_ahead),
       now() + make_interval(hours => l.hours_ahead, mins => 50),
       50
FROM (VALUES
  ('75100000-0000-4000-8000-000000000001', 12), -- early request (>6h)
  ('75100000-0000-4000-8000-000000000002',  2), -- late: charge
  ('75100000-0000-4000-8000-000000000003',  3), -- late: waive
  ('75100000-0000-4000-8000-000000000004',  4)  -- late: reject
) AS l(id, hours_ahead);

SELECT is((SELECT free_cancellation_hours::integer FROM public.teacher_settings
           WHERE teacher_id='75000000-0000-4000-8000-000000000001'::uuid),
          6, 'Teacher cancellation policy uses a six-hour cutoff');
SELECT is((SELECT price_amount_minor FROM public.lessons
           WHERE id='75100000-0000-4000-8000-000000000002'::uuid),
          82000::bigint, 'Late-cancellation lesson has an immutable price snapshot');

-- A student may initiate requests, but cannot cancel a lesson through the
-- teacher-only RPC; another student cannot request cancellation of this lesson.
SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.request_lesson_cancellation('75100000-0000-4000-8000-000000000001'::uuid, 'foreign')$$,
  'P0001', 'LESSON_NOT_FOUND', 'Unrelated student cannot request cancellation');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.cancel_lesson('75100000-0000-4000-8000-000000000001'::uuid, null::text)$$,
  'P0001', 'STUDENT_CANCELLATION_REQUIRES_REQUEST',
  'Student cannot bypass the cancellation-request workflow');
SELECT ok(
  NOT (public.preview_lesson_cancellation('75100000-0000-4000-8000-000000000001'::uuid) ->> 'isLate')::boolean,
  'Student preview identifies the early free window');
SELECT lives_ok(
  $$SELECT public.request_lesson_cancellation('75100000-0000-4000-8000-000000000001'::uuid, 'early test')$$,
  'Student can request cancellation more than six hours before lesson');
SELECT ok(NOT (SELECT is_late FROM public.lesson_cancellation_requests
                WHERE lesson_id='75100000-0000-4000-8000-000000000001'::uuid),
          'Early request is classified as free cancellation');
SELECT is((SELECT free_cancellation_hours_snapshot::integer FROM public.lesson_cancellation_requests
           WHERE lesson_id='75100000-0000-4000-8000-000000000001'::uuid),
          6, 'Request snapshots the cancellation policy');
SELECT throws_ok(
  $$SELECT public.request_lesson_cancellation('75100000-0000-4000-8000-000000000001'::uuid, 'duplicate')$$,
  'P0001','CANCELLATION_REQUEST_ALREADY_PENDING','Duplicate pending cancellation requests are rejected');
SELECT ok(
  (public.preview_lesson_cancellation('75100000-0000-4000-8000-000000000002'::uuid) ->> 'isLate')::boolean,
  'Student preview identifies the late paid window');
SELECT lives_ok(
  $$SELECT public.request_lesson_cancellation('75100000-0000-4000-8000-000000000002'::uuid, 'late charged')$$,
  'Late charge scenario: cancellation request accepted');
SELECT ok((SELECT is_late FROM public.lesson_cancellation_requests
           WHERE lesson_id='75100000-0000-4000-8000-000000000002'::uuid),
          'Two hours before lesson is classified as late');
SELECT lives_ok(
  $$SELECT public.request_lesson_cancellation('75100000-0000-4000-8000-000000000003'::uuid, 'late waived')$$,
  'Late waiver scenario: cancellation request accepted');
SELECT lives_ok(
  $$SELECT public.request_lesson_cancellation('75100000-0000-4000-8000-000000000004'::uuid, 'late rejected')$$,
  'Rejection scenario: cancellation request accepted');
RESET ROLE;

-- Another teacher cannot resolve these requests.
SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
     (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000001'::uuid),
     'cancel', null::text)$$,
  'P0001', 'CANCELLATION_REQUEST_NOT_FOUND', 'Unrelated teacher cannot resolve a request');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.request_lesson_cancellation('75100000-0000-4000-8000-000000000001'::uuid, 'teacher')$$,
  'P0001', 'STUDENT_REQUIRED', 'Teacher cannot submit a student cancellation request');
SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000001'::uuid),
    'cancel_charge', null::text)$$,
  'P0001','INVALID_EARLY_CANCELLATION_ACTION','Early request cannot be charged');
SELECT lives_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000001'::uuid),
    'cancel', null::text)$$,
  'Teacher approves early request without charge');
SELECT is((SELECT status::text FROM public.lessons WHERE id='75100000-0000-4000-8000-000000000001'::uuid),
          'cancelled'::text, 'Approved early cancellation closes the lesson');
SELECT is((SELECT cancellation_charge_mode::text FROM public.lessons WHERE id='75100000-0000-4000-8000-000000000001'::uuid),
          'no_charge'::text,'Early cancellation is explicitly not charged');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='75100000-0000-4000-8000-000000000001'::uuid),
          0,'Early cancellation produces no charge in the immutable ledger');

SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000002'::uuid),
    'cancel', null::text)$$,
  'P0001','INVALID_LATE_CANCELLATION_ACTION','Late request needs an explicit charge or waiver');
SELECT lives_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000002'::uuid),
    'cancel_charge', null::text)$$,
  'Late cancellation can be charged in full');
SELECT is((SELECT cancellation_charge_mode::text FROM public.lessons
           WHERE id='75100000-0000-4000-8000-000000000002'::uuid),
          'charged'::text,'Charged late cancellation stores its decision');
SELECT is((SELECT amount_minor FROM public.student_finance_transactions
           WHERE lesson_id='75100000-0000-4000-8000-000000000002'::uuid),
          -82000::bigint,'Late cancellation charges the full lesson price');
SELECT is((SELECT effective_at FROM public.student_finance_transactions
           WHERE lesson_id='75100000-0000-4000-8000-000000000002'::uuid),
          (SELECT starts_at FROM public.lessons WHERE id='75100000-0000-4000-8000-000000000002'::uuid),
          'Lesson-start timestamp is used as the charge business date');
SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000002'::uuid),
    'cancel_charge', null::text)$$,
  'P0001','CANCELLATION_REQUEST_NOT_PENDING','Repeated resolution cannot duplicate the charge');

SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000003'::uuid),
    'cancel_waive', null::text)$$,
  'P0001','WAIVER_REASON_REQUIRED','Late waiver requires a reason');
SELECT lives_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000003'::uuid),
    'cancel_waive', 'Customer exception')$$,
  'Teacher explicitly waives the late cancellation charge');
SELECT is((SELECT cancellation_charge_mode::text FROM public.lessons
           WHERE id='75100000-0000-4000-8000-000000000003'::uuid),
          'waived'::text,'Waiver decision is stored');
SELECT is((SELECT cancellation_waiver_reason FROM public.lessons
           WHERE id='75100000-0000-4000-8000-000000000003'::uuid),
          'Customer exception'::text,'Waiver reason is preserved on the lesson');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='75100000-0000-4000-8000-000000000003'::uuid),
          0,'Explicit waiver creates no finance charge');

SELECT lives_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='75100000-0000-4000-8000-000000000004'::uuid),
    'reject', null::text)$$,
  'Teacher may reject a cancellation request');
SELECT is((SELECT status::text FROM public.lessons
           WHERE id='75100000-0000-4000-8000-000000000004'::uuid),
          'scheduled'::text,'Rejecting a request keeps the lesson scheduled');
SELECT is((SELECT status::text FROM public.lesson_cancellation_requests
           WHERE lesson_id='75100000-0000-4000-8000-000000000004'::uuid),
          'rejected'::text,'Rejected request is marked as rejected');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='75100000-0000-4000-8000-000000000004'::uuid),
          0,'Rejected request does not affect the financial ledger');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
