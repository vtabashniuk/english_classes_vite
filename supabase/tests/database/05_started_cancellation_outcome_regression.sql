-- CRM Stage 1.5.2e: lesson-start cancellation automation & missed/completed outcomes.
-- ONLY run with: npx supabase test db --local
-- Synthetic @crm-tests.invalid identities. All changes rolled back after assertions.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(54);

-- This defensive check supplements, but does not replace, the CLI --local flag.
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
 ('76000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outcome.teacher.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('76000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outcome.teacher.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('76000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outcome.student.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"student"}',now(),now());

INSERT INTO public.teacher_students (teacher_id, student_id)
VALUES ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000003');

INSERT INTO public.teacher_settings (teacher_id, free_cancellation_hours)
VALUES ('76000000-0000-4000-8000-000000000001',6);

INSERT INTO public.student_lesson_rates
  (teacher_id, student_id, amount_minor, currency, effective_from)
VALUES ('76000000-0000-4000-8000-000000000001',
        '76000000-0000-4000-8000-000000000003',82000,'UAH',current_date - 30);

-- Direct inserts are deliberate: create_lesson() rejects past time slots.
-- Every lesson is exactly 50 minutes; there are no overlaps.
-- Offset minutes from now: early=-10; charged=-80; waived=-170;
-- reminder=-290; correction=-370; auto-missed=-1380; future=+180.
INSERT INTO public.lessons
  (id, teacher_id, student_id, starts_at, ends_at, duration_minutes)
SELECT x.id::uuid,
       '76000000-0000-4000-8000-000000000001'::uuid,
       '76000000-0000-4000-8000-000000000003'::uuid,
       now() + make_interval(mins => x.offset_minutes),
       now() + make_interval(mins => x.offset_minutes + 50),
       50
FROM (VALUES
 ('76100000-0000-4000-8000-000000000001',  -10),
 ('76100000-0000-4000-8000-000000000002',  -80),
 ('76100000-0000-4000-8000-000000000003', -170),
 ('76100000-0000-4000-8000-000000000004', -290),
 ('76100000-0000-4000-8000-000000000005', -370),
 ('76100000-0000-4000-8000-000000000006',-1380),
 ('76100000-0000-4000-8000-000000000007',  180)
) AS x(id,offset_minutes);

-- Reproduce requests submitted BEFORE lesson start, not new requests in the past.
INSERT INTO public.lesson_cancellation_requests
  (lesson_id, teacher_id, student_id, reason, requested_at,
   free_cancellation_hours_snapshot, minutes_before_start, is_late)
SELECT l.id, l.teacher_id, l.student_id, 'Synthetic pending request',
       l.starts_at - make_interval(mins => CASE WHEN l.id='76100000-0000-4000-8000-000000000001'::uuid THEN 720 ELSE 90 END),
       6,
       CASE WHEN l.id='76100000-0000-4000-8000-000000000001'::uuid THEN 720 ELSE 90 END,
       l.id <> '76100000-0000-4000-8000-000000000001'::uuid
FROM public.lessons l
WHERE l.id IN (
 '76100000-0000-4000-8000-000000000001'::uuid,
 '76100000-0000-4000-8000-000000000002'::uuid,
 '76100000-0000-4000-8000-000000000003'::uuid
);

-- Only this transaction changes the activation threshold, so older synthetic
-- lessons are eligible for missed automation. Rolled back with the test.
UPDATE public.lesson_outcome_automation_state
SET activated_at = now() - interval '3 days'
WHERE singleton = true;

-- 1-5: preconditions and worker access
SELECT is((SELECT price_amount_minor FROM public.lessons WHERE id='76100000-0000-4000-8000-000000000002'::uuid),
          82000::bigint,'Past lesson retains the original tariff snapshot');
SELECT ok(NOT (SELECT is_late FROM public.lesson_cancellation_requests
               WHERE lesson_id='76100000-0000-4000-8000-000000000001'::uuid),
          'Early request is still classified by the original request time');
SELECT ok((SELECT is_late FROM public.lesson_cancellation_requests
           WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
          'Late request retains its original classification');
SELECT ok(NOT has_function_privilege('authenticated',
          'public.process_started_lesson_cancellation_requests(uuid)','EXECUTE'),
          'Authenticated clients cannot run the privileged start processor');
SELECT ok(NOT has_function_privilege('authenticated',
          'public.process_lesson_outcome_automation()','EXECUTE'),
          'Authenticated clients cannot run the privileged cron worker');

-- 6: student cannot create a cancellation request once the lesson has started.
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.request_lesson_cancellation('76100000-0000-4000-8000-000000000004'::uuid,'too late')$$,
  'P0001','PAST_LESSON_CANNOT_BE_CANCELLED','Student cannot create cancellation requests after start');
RESET ROLE;

-- 7-16: teacher may correct missed/completed without a second charge.
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.cancel_lesson('76100000-0000-4000-8000-000000000004'::uuid,'after start')$$,
  'P0001','PAST_LESSON_CANNOT_BE_CANCELLED','Teacher cannot cancel a started lesson');
SELECT lives_ok(
  $$SELECT public.set_lesson_outcome('76100000-0000-4000-8000-000000000005'::uuid,'missed'::public.lesson_status)$$,
  'Teacher can mark an already-started lesson missed');
SELECT is((SELECT amount_minor FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000005'::uuid),
          -82000::bigint,'Missed lesson is charged in full once');
SELECT lives_ok(
  $$SELECT public.set_lesson_outcome('76100000-0000-4000-8000-000000000005'::uuid,'completed'::public.lesson_status)$$,
  'Missed lesson can be corrected to completed');
SELECT is((SELECT status::text FROM public.lessons WHERE id='76100000-0000-4000-8000-000000000005'::uuid),
          'completed'::text,'Correction changes lesson status to completed');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000005'::uuid),
          1,'Missed to completed does not create a duplicate charge');
SELECT is((SELECT effective_at FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000005'::uuid),
          (SELECT starts_at FROM public.lessons WHERE id='76100000-0000-4000-8000-000000000005'::uuid),
          'Outcome charge uses lesson start as business timestamp');
SELECT lives_ok(
  $$SELECT public.set_lesson_outcome('76100000-0000-4000-8000-000000000005'::uuid,'missed'::public.lesson_status)$$,
  'Completed lesson can be corrected back to missed');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000005'::uuid),
          1,'Second outcome correction does not create a duplicate charge');
SELECT throws_ok(
  $$SELECT public.set_lesson_outcome('76100000-0000-4000-8000-000000000007'::uuid,'missed'::public.lesson_status)$$,
  'P0001','LESSON_NOT_STARTED','Future lessons cannot be marked missed');
RESET ROLE;

-- 17-22: an EARLY pending request becomes free cancellation on start.
SELECT is((public.process_started_lesson_cancellation_requests('76100000-0000-4000-8000-000000000001'::uuid)
           ->> 'earlyCancelled')::integer, 1,
          'Start processor auto-approves one early request');
SELECT is((SELECT status::text FROM public.lessons WHERE id='76100000-0000-4000-8000-000000000001'::uuid),
          'cancelled'::text,'Early request automatically cancels the lesson');
SELECT is((SELECT cancellation_charge_mode::text FROM public.lessons WHERE id='76100000-0000-4000-8000-000000000001'::uuid),
          'no_charge'::text,'Early auto cancellation is always free');
SELECT is((SELECT status::text FROM public.lesson_cancellation_requests
           WHERE lesson_id='76100000-0000-4000-8000-000000000001'::uuid),
          'approved'::text,'Early request is automatically resolved');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000001'::uuid),
          0,'Early auto cancellation produces no financial charge');
SELECT is((public.process_started_lesson_cancellation_requests('76100000-0000-4000-8000-000000000001'::uuid)
           ->> 'earlyCancelled')::integer, 0,
          'Processing early cancellation a second time is idempotent');

-- 23-28: a LATE pending request auto-cancels, but billing remains pending.
SELECT is((public.process_started_lesson_cancellation_requests('76100000-0000-4000-8000-000000000002'::uuid)
           ->> 'latePaymentPending')::integer, 1,
          'Late request auto-cancels while leaving the payment decision pending');
SELECT is((SELECT status::text FROM public.lessons WHERE id='76100000-0000-4000-8000-000000000002'::uuid),
          'cancelled'::text,'Late request automatically cancels the lesson');
SELECT ok((SELECT cancellation_charge_mode IS NULL FROM public.lessons
           WHERE id='76100000-0000-4000-8000-000000000002'::uuid),
          'Late payment decision starts as NULL rather than pre-charged');
SELECT is((SELECT status::text FROM public.lesson_cancellation_requests
           WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
          'pending'::text,'Late cancellation request remains pending for teacher decision');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
          0,'No charge is created before the teacher payment decision');
SELECT is((public.process_started_lesson_cancellation_requests('76100000-0000-4000-8000-000000000002'::uuid)
           ->> 'latePaymentPending')::integer, 0,
          'Re-running start processor cannot auto-cancel twice');

-- 29-36: billing decision may be made ONLY by the correct teacher, once.
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
    'cancel_charge',null::text)$$,
  'P0001','CANCELLATION_REQUEST_NOT_FOUND','Unrelated teacher cannot charge a late cancellation');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
    'reject',null::text)$$,
  'P0001','LATE_CANCELLATION_PAYMENT_DECISION_REQUIRED',
  'After start the teacher cannot reject a cancellation already in effect');
SELECT lives_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
    'cancel_charge',null::text)$$,
  'Teacher makes explicit charge decision after cancellation');
SELECT is((SELECT cancellation_charge_mode::text FROM public.lessons
           WHERE id='76100000-0000-4000-8000-000000000002'::uuid),
          'charged'::text,'Teacher charge decision is stored on lesson');
SELECT is((SELECT amount_minor FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
          -82000::bigint,'Late cancellation is charged at the price snapshot');
SELECT is((SELECT effective_at FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
          (SELECT starts_at FROM public.lessons WHERE id='76100000-0000-4000-8000-000000000002'::uuid),
          'Late decision uses the scheduled lesson start as business timestamp');
SELECT is((SELECT status::text FROM public.lesson_cancellation_requests
           WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
          'approved'::text,'Charge decision closes the cancellation request');
SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='76100000-0000-4000-8000-000000000002'::uuid),
    'cancel_charge',null::text)$$,
  'P0001','CANCELLATION_REQUEST_NOT_PENDING','Repeated charge decisions cannot post twice');
RESET ROLE;

-- 37-43: second LATE request, teacher waiver requires a nonempty reason.
SELECT is((public.process_started_lesson_cancellation_requests('76100000-0000-4000-8000-000000000003'::uuid)
           ->> 'latePaymentPending')::integer, 1,
          'Second late cancellation is waiting for payment decision');
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='76100000-0000-4000-8000-000000000003'::uuid),
    'cancel_waive','  ')$$,
  'P0001','WAIVER_REASON_REQUIRED','Waiving a late cancellation without reason is rejected');
SELECT lives_ok(
  $$SELECT public.resolve_lesson_cancellation_request(
    (SELECT id FROM public.lesson_cancellation_requests WHERE lesson_id='76100000-0000-4000-8000-000000000003'::uuid),
    'cancel_waive','agreed exception')$$,
  'Teacher may explicitly waive a late-cancellation charge');
SELECT is((SELECT cancellation_charge_mode::text FROM public.lessons
           WHERE id='76100000-0000-4000-8000-000000000003'::uuid),
          'waived'::text,'Waiver decision is preserved on the lesson');
SELECT is((SELECT cancellation_waiver_reason FROM public.lessons
           WHERE id='76100000-0000-4000-8000-000000000003'::uuid),
          'agreed exception'::text,'Waiver reason is preserved');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000003'::uuid),
          0,'Waived late cancellation does not create a charge');
SELECT is((SELECT status::text FROM public.lesson_cancellation_requests
           WHERE lesson_id='76100000-0000-4000-8000-000000000003'::uuid),
          'approved'::text,'Waived cancellation request is closed');
RESET ROLE;

-- 44-51: cron worker reminds teacher and auto-marks unresolved past lesson missed.
SELECT ok(jsonb_typeof(public.process_lesson_outcome_automation()) = 'object',
          'Automation worker returns processing statistics');
SELECT is((SELECT count(*)::integer FROM public.notifications
           WHERE lesson_id='76100000-0000-4000-8000-000000000004'::uuid
             AND type='lesson_outcome_required'),
          1,'Finished unresolved lesson creates one teacher reminder');
SELECT is((SELECT status::text FROM public.lessons
           WHERE id='76100000-0000-4000-8000-000000000006'::uuid),
          'missed'::text,'Lesson after 18h grace is automatically marked missed');
SELECT is((SELECT amount_minor FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000006'::uuid),
          -82000::bigint,'Automatically missed lesson is charged in full');
SELECT is((SELECT effective_at FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000006'::uuid),
          (SELECT starts_at FROM public.lessons
           WHERE id='76100000-0000-4000-8000-000000000006'::uuid),
          'Automatic charge uses original lesson start for business timestamp');
SELECT is((SELECT count(*)::integer FROM public.notifications
           WHERE lesson_id='76100000-0000-4000-8000-000000000006'::uuid
             AND type='lesson_auto_missed'),
          1,'Teacher receives a single auto-missed notification');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000001'::uuid),
          0,'Automation does not charge earlier auto-cancelled lessons');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000003'::uuid),
          0,'Automation does not re-charge waived cancellations');

-- 52-54: worker is repeat-safe for notifications and charges.
SELECT ok(jsonb_typeof(public.process_lesson_outcome_automation()) = 'object',
          'Second worker invocation finishes safely');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE lesson_id='76100000-0000-4000-8000-000000000006'::uuid),
          1,'Repeated automation does not create another missed-lesson charge');
SELECT is((SELECT count(*)::integer FROM public.notifications
           WHERE lesson_id='76100000-0000-4000-8000-000000000004'::uuid
             AND type='lesson_outcome_required'),
          1,'Repeated automation does not duplicate teacher reminders');

SELECT * FROM finish();
ROLLBACK;
