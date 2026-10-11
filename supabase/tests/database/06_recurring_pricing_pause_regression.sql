-- CRM Stage 1.5.2f: recurring lesson generation, price snapshots, and pauses.
-- Run ONLY with: npx supabase test db --local
-- Synthetic identities, no Auth emails, one transaction rolled back at the end.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(48);

DO $$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'LOCAL_TEST_ONLY: run npx supabase test db --local';
  END IF;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
 ('78000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recurrence.teacher.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('78000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recurrence.teacher.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"teacher"}',now(),now()),
 ('78000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recurrence.student.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}', '{"role":"student"}',now(),now());

INSERT INTO public.teacher_students (teacher_id, student_id)
VALUES ('78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000003');
INSERT INTO public.teacher_settings (teacher_id)
VALUES ('78000000-0000-4000-8000-000000000001'),
       ('78000000-0000-4000-8000-000000000002');
INSERT INTO public.student_lesson_rates
  (teacher_id, student_id, amount_minor, currency, effective_from)
VALUES ('78000000-0000-4000-8000-000000000001',
        '78000000-0000-4000-8000-000000000003',90000,'UAH',current_date - 30);

-- Mondays are far enough in the future that all inserts/moves are legal.
SELECT set_config('crm_regression.f.monday', (
  (now() AT TIME ZONE 'Europe/Kyiv')::date
  + ((1 - extract(isodow FROM (now() AT TIME ZONE 'Europe/Kyiv')::date)::integer + 7) % 7)
  + 28
)::text, true);

-- 1–6: two lessons exist before the future tariff is defined.
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT ok(public.is_teacher(), 'The fixture actor is a teacher');
SELECT is((SELECT reschedule_price_policy FROM public.teacher_settings
           WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid),
          'keep_original'::text,'Default reschedule pricing policy preserves the snapshot');
SELECT ok(length(set_config('crm_regression.f.old_lesson',
  public.create_lesson('78000000-0000-4000-8000-000000000003'::uuid,
    current_setting('crm_regression.f.monday')::date, '09:00'::time, NULL::text)::text,true)) > 30,
  'Teacher creates a pre-tariff lesson');
SELECT ok(length(set_config('crm_regression.f.future_lesson',
  public.create_lesson('78000000-0000-4000-8000-000000000003'::uuid,
    current_setting('crm_regression.f.monday')::date + 14, '09:00'::time, NULL::text)::text,true)) > 30,
  'Teacher creates a later lesson before the future tariff exists');
SELECT is((SELECT price_amount_minor FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          90000::bigint,'Original lesson records its initial price snapshot');
SELECT is((SELECT price_amount_minor FROM public.lessons
           WHERE id=current_setting('crm_regression.f.future_lesson')::uuid),
          90000::bigint,'Later lesson initially records the same price');

-- 7–14: setting a future tariff refreshes only scheduled applicable lessons.
SELECT lives_ok(
  $$SELECT public.set_student_lesson_rate(
    '78000000-0000-4000-8000-000000000003'::uuid,110000,'UAH'::public.finance_currency,
    current_setting('crm_regression.f.monday')::date + 7)$$,
  'Teacher schedules a future tariff through the RPC');
SELECT is((SELECT price_amount_minor FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          90000::bigint,'Price before tariff change is not refreshed');
SELECT is((SELECT price_amount_minor FROM public.lessons
           WHERE id=current_setting('crm_regression.f.future_lesson')::uuid),
          110000::bigint,'Future scheduled lesson price is refreshed');
SELECT is((SELECT pricing_date FROM public.lessons
           WHERE id=current_setting('crm_regression.f.future_lesson')::uuid),
          current_setting('crm_regression.f.monday')::date + 14,
          'Tariff refresh does not alter lesson pricing date');
SELECT is((SELECT effective_to FROM public.student_lesson_rates
           WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid
             AND student_id='78000000-0000-4000-8000-000000000003'::uuid
             AND amount_minor=90000),
          current_setting('crm_regression.f.monday')::date + 7,
          'Older tariff terminates at the start of the new tariff');
SELECT is((SELECT count(*)::integer FROM public.student_lesson_rates
           WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid
             AND student_id='78000000-0000-4000-8000-000000000003'::uuid),
          2,'Tariffs are stored as two versions');
SELECT throws_ok(
  $$SELECT public.set_student_lesson_rate('78000000-0000-4000-8000-000000000003'::uuid,
     120000,'UAH'::public.finance_currency,current_date - 1)$$,
  'P0001','LESSON_RATE_PAST_DATE_NOT_ALLOWED','Past effective tariff dates are forbidden');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid),
          0,'Scheduling a future tariff does not charge a lesson');

-- 15–21: test BOTH reschedule price policies using the real schedule RPC.
SELECT lives_ok(
  $$SELECT public.update_lesson_schedule(current_setting('crm_regression.f.old_lesson')::uuid,
    current_setting('crm_regression.f.monday')::date + 1,'11:00'::time,NULL::text)$$,
  'One-off lesson can be moved with keep_original policy');
SELECT is((SELECT price_amount_minor FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          90000::bigint,'keep_original retains the original amount');
SELECT is((SELECT pricing_date FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          current_setting('crm_regression.f.monday')::date,
          'keep_original retains the initial tariff date');
SELECT is((SELECT reschedule_price_policy_applied FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          'keep_original'::text,'Lesson records the applied keep_original policy');
RESET ROLE;
UPDATE public.teacher_settings SET reschedule_price_policy='target_date_tariff'
WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.update_lesson_schedule(current_setting('crm_regression.f.old_lesson')::uuid,
    current_setting('crm_regression.f.monday')::date + 22,'11:00'::time,NULL::text)$$,
  'Lesson can be moved after switching to target_date_tariff');
SELECT is((SELECT price_amount_minor FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          110000::bigint,'target_date_tariff reprices at the destination date');
SELECT is((SELECT pricing_date FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          current_setting('crm_regression.f.monday')::date + 22,
          'target_date_tariff updates the pricing date');
SELECT is((SELECT reschedule_price_policy_applied FROM public.lessons
           WHERE id=current_setting('crm_regression.f.old_lesson')::uuid),
          'target_date_tariff'::text,'Lesson records the applied destination policy');

-- 22–35: open-ended vs fixed series, horizon, reservations, occurrence identity.
SELECT ok(length(set_config('crm_regression.f.open_series',
  (SELECT recurring_lesson_id FROM public.create_recurring_lesson_with_generation(
    '78000000-0000-4000-8000-000000000003'::uuid,1::smallint,'10:00'::time,
    current_setting('crm_regression.f.monday')::date,NULL::date,NULL::text,1::smallint,8::smallint))::text,true)) > 30,
  'Open-ended recurring series is created by the RPC');
SELECT is((SELECT valid_until FROM public.recurring_lessons
           WHERE id=current_setting('crm_regression.f.open_series')::uuid),
          NULL::date,'Open-ended recurring series has no end date');
SELECT ok((SELECT count(*) BETWEEN 4 AND 5 FROM public.lessons
           WHERE recurring_lesson_id=current_setting('crm_regression.f.open_series')::uuid),
          'Open-ended recurring lessons materialize only through the eight-week horizon');
SELECT is((SELECT count(*)::integer FROM public.lessons
           WHERE recurring_lesson_id=current_setting('crm_regression.f.open_series')::uuid
             AND occurrence_date=current_setting('crm_regression.f.monday')::date + 70),
          0,'Occurrences beyond the materialization horizon are absent');
RESET ROLE;
SELECT ok(public.is_teacher_recurring_lesson_reserved(
  '78000000-0000-4000-8000-000000000001'::uuid,
  (current_setting('crm_regression.f.monday')::date + 70 + '10:00'::time) AT TIME ZONE 'Europe/Kyiv',
  (current_setting('crm_regression.f.monday')::date + 70 + '10:50'::time) AT TIME ZONE 'Europe/Kyiv',
  NULL::uuid),
  'Open-ended series reserves matching slots beyond the materialized horizon');
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.create_lesson('78000000-0000-4000-8000-000000000003'::uuid,
     current_setting('crm_regression.f.monday')::date + 70,'10:00'::time,NULL::text)$$,
  'P0001','LESSON_TIME_CONFLICT','Teacher cannot book a reserved slot beyond the horizon');
SELECT throws_ok(
  $$SELECT * FROM public.create_recurring_lesson_with_generation(
    '78000000-0000-4000-8000-000000000003'::uuid,
    1::smallint, '10:00'::time, current_setting('crm_regression.f.monday')::date,
    NULL::date, NULL::text, 1::smallint, 8::smallint)$$,
  'P0001','RECURRING_TEACHER_CONFLICT','Overlapping recurring series are rejected');
SELECT ok(length(set_config('crm_regression.f.fixed_series',
  (SELECT recurring_lesson_id FROM public.create_recurring_lesson_with_generation(
    '78000000-0000-4000-8000-000000000003'::uuid,4::smallint,'13:00'::time,
    current_setting('crm_regression.f.monday')::date,
    current_setting('crm_regression.f.monday')::date + 21,
    NULL::text,1::smallint,8::smallint))::text,true)) > 30,
  'Fixed recurring series is created through the RPC');
SELECT is((SELECT count(*)::integer FROM public.lessons
           WHERE recurring_lesson_id=current_setting('crm_regression.f.fixed_series')::uuid),
          3,'Fixed series materializes all occurrences through its end date');
SELECT ok((SELECT bool_and(
                 CASE WHEN occurrence_date < current_setting('crm_regression.f.monday')::date + 7
                   THEN price_amount_minor = 90000
                   ELSE price_amount_minor = 110000
                 END)
             FROM public.lessons
             WHERE recurring_lesson_id=current_setting('crm_regression.f.open_series')::uuid),
          'Generated recurring lessons snapshot the tariff effective on each occurrence date');
SELECT ok((SELECT bool_and(occurrence_date=(starts_at AT TIME ZONE 'Europe/Kyiv')::date)
           FROM public.lessons
           WHERE recurring_lesson_id=current_setting('crm_regression.f.open_series')::uuid),
          'Generated recurring lessons have stable original occurrence dates');
SELECT ok(length(set_config('crm_regression.f.first_occurrence',
  (SELECT id FROM public.lessons
   WHERE recurring_lesson_id=current_setting('crm_regression.f.open_series')::uuid
     AND occurrence_date=current_setting('crm_regression.f.monday')::date)::text,true)) > 30,
  'First occurrence of the open series exists');
RESET ROLE;
UPDATE public.teacher_settings SET reschedule_price_policy='keep_original'
WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.update_lesson_schedule(current_setting('crm_regression.f.first_occurrence')::uuid,
    current_setting('crm_regression.f.monday')::date + 1,'12:00'::time,NULL::text)$$,
  'Teacher can move one occurrence without editing the series');
SELECT is((SELECT occurrence_date FROM public.lessons
           WHERE id=current_setting('crm_regression.f.first_occurrence')::uuid),
          current_setting('crm_regression.f.monday')::date,
          'Moved recurring occurrence retains original recurrence identity');
SELECT lives_ok(
  $$SELECT * FROM public.generate_recurring_lessons(
     current_setting('crm_regression.f.open_series')::uuid,
     current_setting('crm_regression.f.monday')::date + 28)$$,
  'Regenerating a series after moving one occurrence succeeds');
SELECT is((SELECT count(*)::integer FROM public.lessons
           WHERE recurring_lesson_id=current_setting('crm_regression.f.open_series')::uuid
             AND occurrence_date=current_setting('crm_regression.f.monday')::date),
          1,'Regeneration does not recreate the moved occurrence');

-- 36–45: scheduled pause, maximum duration, cancellation, resume by the student.
SELECT throws_ok(
  $$SELECT * FROM public.apply_student_learning_pause(
     current_setting('crm_regression.f.monday')::date + 7,
     current_setting('crm_regression.f.monday')::date + 21,
     '78000000-0000-4000-8000-000000000003'::uuid)$$,
  'P0001','PAUSE_TOO_LONG','Pauses longer than fourteen days are forbidden');
SELECT lives_ok(
  $$SELECT * FROM public.apply_student_learning_pause(
     current_setting('crm_regression.f.monday')::date + 7,
     current_setting('crm_regression.f.monday')::date + 13,
     '78000000-0000-4000-8000-000000000003'::uuid)$$,
  'Teacher can schedule a one-week learning pause');
SELECT is((SELECT learning_status::text FROM public.teacher_students
           WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid
             AND student_id='78000000-0000-4000-8000-000000000003'::uuid),
          'paused'::text,'Student relationship records the scheduled pause');
SELECT lives_ok(
  $$SELECT public.create_lesson(
    '78000000-0000-4000-8000-000000000003'::uuid,
    current_setting('crm_regression.f.monday')::date,
    '15:00'::time, NULL::text)$$,
  'Future pause does not block booking an available lesson before its start date');
SELECT is((SELECT status::text FROM public.lessons
           WHERE recurring_lesson_id=current_setting('crm_regression.f.open_series')::uuid
             AND occurrence_date=current_setting('crm_regression.f.monday')::date + 7),
          'cancelled'::text,'Recurring lesson during the pause is cancelled');
SELECT is((SELECT status::text FROM public.lessons
           WHERE recurring_lesson_id=current_setting('crm_regression.f.fixed_series')::uuid
             AND occurrence_date=current_setting('crm_regression.f.monday')::date + 10),
          'cancelled'::text,'Fixed-series lesson during the pause is cancelled');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid),
          0,'Teacher-initiated pause produces no charges');
SELECT ok((SELECT is_active FROM public.recurring_lessons
           WHERE id=current_setting('crm_regression.f.open_series')::uuid),
          'Pause leaves the recurring series active');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT * FROM public.resume_student_learning_pause(NULL::uuid)$$,
  'Student can cancel a scheduled future pause without teacher approval');
SELECT is((SELECT learning_status::text FROM public.teacher_students
           WHERE teacher_id='78000000-0000-4000-8000-000000000001'::uuid
             AND student_id='78000000-0000-4000-8000-000000000003'::uuid),
          'active'::text,'Student-initiated resume restores active learning status');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
