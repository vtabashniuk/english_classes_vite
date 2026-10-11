-- Stage 1.5.2c: calendar RPC + immutable lesson finance regression.
-- Run only: npx supabase test db --local
-- Synthetic fixture. The Supabase pgTAP runner rolls the whole file back.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(34);

-- This is a sanity check, not proof of locality. NEVER use --linked/--db-url.
DO $$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'LOCAL_TEST_ONLY: npx supabase test db --local';
  END IF;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
 ('73000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','calendar.teacher.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('73000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','calendar.teacher.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('73000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','calendar.student.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"student"}',now(),now()),
 ('73000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','calendar.student.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"student"}',now(),now());

INSERT INTO public.teacher_students (teacher_id, student_id) VALUES
 ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000003'),
 ('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000004');

-- The teacher_settings trigger creates a Mon-Fri 09:00-19:00 working week.
INSERT INTO public.teacher_settings (teacher_id) VALUES
 ('73000000-0000-4000-8000-000000000001'),
 ('73000000-0000-4000-8000-000000000002');

-- The whole-unit lesson tariff creates a reliable price snapshot.
INSERT INTO public.student_lesson_rates (
  teacher_id, student_id, amount_minor, currency, effective_from
) VALUES (
 '73000000-0000-4000-8000-000000000001',
 '73000000-0000-4000-8000-000000000003',
 75000, 'UAH', current_date - 30
);

-- A Monday at least four weeks in the future: stable across weekends, timezones
-- and daylight-saving transitions. It is stored only in this transaction.
SELECT set_config('crm_test.monday', (
  current_date + ((1 - extract(isodow FROM current_date)::integer + 7) % 7) + 28
)::text, true);

SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;

SELECT ok(public.is_teacher(), 'Fixture teacher is authorized');
SELECT ok(
  length(set_config('crm_test.first_lesson',
    public.create_lesson(
      '73000000-0000-4000-8000-000000000003'::uuid,
      current_setting('crm_test.monday')::date,
      '10:00'::time, 'https://meet.google.com/test-meeting'
    )::text, true
  )) > 30,
  'Teacher creates a scheduled lesson through the RPC'
);
SELECT is(
  (SELECT teacher_id FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  '73000000-0000-4000-8000-000000000001'::uuid,
  'Created lesson belongs to its teacher'
);
SELECT is(
  (SELECT price_amount_minor FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  75000::bigint, 'Lesson takes the current rate as a snapshot'
);
SELECT is(
  (SELECT duration_minutes::integer FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  50, 'Lesson duration follows teacher settings (50 minutes)'
);
SELECT is(
  (SELECT meeting_url FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  'https://meet.google.com/test-meeting'::text,
  'Meeting provider URL is saved without provider-specific coupling'
);
SELECT throws_ok(
  $$SELECT public.create_lesson('73000000-0000-4000-8000-000000000003'::uuid, current_setting('crm_test.monday')::date, '10:15'::time, null::text)$$,
  'P0001','INVALID_TIME_SLOT','15-minute offset violates the 30-minute step'
);
SELECT throws_ok(
  $$SELECT public.create_lesson('73000000-0000-4000-8000-000000000003'::uuid, current_setting('crm_test.monday')::date, '08:30'::time, null::text)$$,
  'P0001','OUTSIDE_WORKING_HOURS','Cannot create a lesson before the workday'
);
SELECT throws_ok(
  $$SELECT public.create_lesson('73000000-0000-4000-8000-000000000003'::uuid, current_setting('crm_test.monday')::date + 5, '10:00'::time, null::text)$$,
  'P0001','NON_WORKING_DAY','Cannot create a lesson on the disabled Saturday'
);
SELECT throws_ok(
  $$SELECT public.create_lesson('73000000-0000-4000-8000-000000000004'::uuid, current_setting('crm_test.monday')::date, '13:00'::time, null::text)$$,
  'P0001','STUDENT_NOT_FOUND','Teacher cannot create lessons for an unrelated student'
);
SELECT throws_ok(
  $$SELECT public.create_lesson('73000000-0000-4000-8000-000000000003'::uuid, current_setting('crm_test.monday')::date, '10:30'::time, null::text)$$,
  'P0001','LESSON_TIME_CONFLICT','Overlapping lessons are rejected by the database'
);
SELECT ok(
  length(set_config('crm_test.second_lesson',
    public.create_lesson(
      '73000000-0000-4000-8000-000000000003'::uuid,
      current_setting('crm_test.monday')::date,
      '11:00'::time, null::text
    )::text,true
  )) > 30,
  'Non-overlapping lesson can be created'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lessons WHERE teacher_id='73000000-0000-4000-8000-000000000001'::uuid),
  2,'Exactly two teacher A lessons were created'
);
SELECT throws_ok(
  $$SELECT public.update_lesson_schedule(current_setting('crm_test.first_lesson')::uuid, current_setting('crm_test.monday')::date, '11:30'::time, null::text)$$,
  'P0001','LESSON_TIME_CONFLICT','Moving onto an occupied time is blocked'
);
SELECT lives_ok(
  $$SELECT public.update_lesson_schedule(current_setting('crm_test.first_lesson')::uuid, current_setting('crm_test.monday')::date + 1, '12:00'::time, null::text)$$,
  'Moving a single lesson to a vacant future slot succeeds'
);
SELECT is(
  (SELECT price_amount_minor FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  75000::bigint,'Rescheduling preserves the original price amount'
);
SELECT is(
  (SELECT pricing_date FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  current_setting('crm_test.monday')::date,
  'Rescheduling preserves original pricing date'
);
SELECT is(
  (SELECT (starts_at AT TIME ZONE 'Europe/Kyiv')::date FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  current_setting('crm_test.monday')::date + 1,
  'Moved lesson starts on the requested teacher-local date'
);
SELECT lives_ok(
  $$SELECT public.cancel_lesson(current_setting('crm_test.second_lesson')::uuid, 'Test teacher cancel')$$,
  'Teacher cancellation completes normally'
);
SELECT is(
  (SELECT status::text FROM public.lessons WHERE id=current_setting('crm_test.second_lesson')::uuid),
  'cancelled'::text,'Teacher-cancelled lesson has cancelled status'
);
SELECT is(
  (SELECT count(*)::integer FROM public.student_finance_transactions WHERE lesson_id=current_setting('crm_test.second_lesson')::uuid),
  0, 'Teacher cancellation does not create a lesson charge'
);
SELECT throws_ok(
  $$SELECT public.cancel_lesson(current_setting('crm_test.second_lesson')::uuid, null::text)$$,
  'P0001','LESSON_ALREADY_CANCELLED','Repeat teacher cancellation is rejected'
);
RESET ROLE;

-- Simulate a student and an unrelated teacher; they may not cancel/move lessons
-- directly via teacher-only RPCs.
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.cancel_lesson(current_setting('crm_test.first_lesson')::uuid, null::text)$$,
  'P0001','STUDENT_CANCELLATION_REQUIRES_REQUEST','Student cannot use teacher cancellation RPC'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.update_lesson_schedule(current_setting('crm_test.first_lesson')::uuid, current_setting('crm_test.monday')::date + 2, '12:00'::time, null::text)$$,
  'P0001','LESSON_NOT_FOUND','Another teacher cannot move this lesson'
);
RESET ROLE;

-- The helper is service-only. The test role (postgres) exercises the trusted
-- ledger logic without exposing the function to browser clients.
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.set_lesson_finance_charge_state(uuid,boolean,text,timestamptz)',
    'EXECUTE'),
  'Browser clients cannot call internal finance charge helper'
);
SELECT lives_ok(
  $$SELECT public.set_lesson_finance_charge_state(current_setting('crm_test.first_lesson')::uuid,true,'regression',null::timestamptz)$$,
  'First lesson charge is accepted'
);
SELECT is(
  (SELECT count(*)::integer FROM public.student_finance_transactions WHERE lesson_id=current_setting('crm_test.first_lesson')::uuid),
  1,'Exactly one root lesson charge exists'
);
SELECT is(
  (SELECT amount_minor FROM public.student_finance_transactions WHERE lesson_id=current_setting('crm_test.first_lesson')::uuid),
  (-75000)::bigint,'Charged amount equals the negative price snapshot'
);
SELECT is(
  (SELECT effective_at FROM public.student_finance_transactions WHERE lesson_id=current_setting('crm_test.first_lesson')::uuid),
  (SELECT starts_at FROM public.lessons WHERE id=current_setting('crm_test.first_lesson')::uuid),
  'Charge business timestamp equals the rescheduled lesson start'
);
SELECT lives_ok(
  $$SELECT public.set_lesson_finance_charge_state(current_setting('crm_test.first_lesson')::uuid,true,'repeat',now())$$,
  'Repeated charge request is safe'
);
SELECT is(
  (SELECT count(*)::integer FROM public.student_finance_transactions WHERE lesson_id=current_setting('crm_test.first_lesson')::uuid),
  1,'Idempotent charge does not duplicate a ledger root'
);
SELECT lives_ok(
  $$SELECT public.set_lesson_finance_charge_state(current_setting('crm_test.first_lesson')::uuid,false,'waive',now())$$,
  'Removing a charge creates a reversal'
);
SELECT is(
  (SELECT count(*)::integer FROM public.student_finance_transactions WHERE reversal_of_id IS NOT NULL AND (metadata->>'lessonId')::uuid = current_setting('crm_test.first_lesson')::uuid),
  1,'One immutable reversal row created'
);
SELECT is(
  (SELECT coalesce(sum(amount_minor),0)::bigint FROM public.student_finance_transactions
    WHERE lesson_id=current_setting('crm_test.first_lesson')::uuid
       OR (metadata->>'lessonId')::uuid=current_setting('crm_test.first_lesson')::uuid),
  0::bigint,'Root charge and reversal net to zero'
);
SELECT * FROM finish();
ROLLBACK;
