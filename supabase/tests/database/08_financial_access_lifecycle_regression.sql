-- CRM 1.5.2i: financial blocking, teacher override and ledger-triggered reconciliation.
-- Only run via `npx supabase test db --local`. All rows are rolled back.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(24);
DO $$ BEGIN
 IF current_database() <> 'postgres' OR current_user NOT IN ('postgres','supabase_admin')
 THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY: use npx supabase test db --local'; END IF;
END $$;

INSERT INTO auth.users (
 id, instance_id, aud, role, email, encrypted_password,
 email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
 ('81000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','access.teacher.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"teacher"}',now(),now()),
 ('81000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','access.teacher.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"teacher"}',now(),now()),
 ('81000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','access.student.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"student"}',now(),now());

-- TEST FIXTURE ONLY: under postgres, provision synthetic teachers explicitly.
-- Production role assignment must never trust auth.users.raw_user_meta_data.
UPDATE public.profiles SET role = 'teacher'::public.user_role
WHERE id IN (
 '81000000-0000-4000-8000-000000000001'::uuid,
 '81000000-0000-4000-8000-000000000002'::uuid
);

INSERT INTO public.teacher_students (teacher_id,student_id)
VALUES ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003');
INSERT INTO public.teacher_settings (
 teacher_id, financial_blocking_enabled,
 financial_blocking_debt_threshold_lessons, low_balance_threshold_lessons
) VALUES ('81000000-0000-4000-8000-000000000001',true,2,1);
INSERT INTO public.student_lesson_rates (teacher_id,student_id,amount_minor,currency,effective_from)
VALUES ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003',10000,'UAH',current_date-30);

SELECT is((SELECT current_rate_minor FROM public.teacher_student_financial_access_policy
 WHERE teacher_id='81000000-0000-4000-8000-000000000001'::uuid
 AND student_id='81000000-0000-4000-8000-000000000003'::uuid),
 10000::bigint,'Tariff snapshot is 100 UAH');
SELECT is((SELECT block_debt_threshold_minor FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 20000::bigint,'Two-lesson debt blocking threshold is 200 UAH');
SELECT is((SELECT recovery_target_minor FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 20000::bigint,'One-lesson low balance warning yields a two-lesson recovery target');
SELECT ok(NOT (SELECT block_entry_condition FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Zero initial balance does not meet the block-entry condition');

SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.add_student_finance_adjustment(
 '81000000-0000-4000-8000-000000000003'::uuid,-20000,'UAH','Regression debit to exact boundary')$$,
 'Teacher may post a debit exactly at the block boundary');
RESET ROLE;
SELECT ok(NOT (SELECT is_financially_blocked FROM public.student_financial_access_state
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Balance equal to negative threshold does not block');

SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.add_student_finance_adjustment(
 '81000000-0000-4000-8000-000000000003'::uuid,-1,'UAH','Regression debit below exact boundary')$$,
 'Next one-kopek debit is posted through public finance RPC');
RESET ROLE;
SELECT ok((SELECT is_financially_blocked FROM public.student_financial_access_state
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Journal trigger blocks below negative debt threshold');
SELECT ok((SELECT access_restricted FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Central policy restricts the student after block');
SELECT is((SELECT recommended_payment_minor FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 40001::bigint,'Recommended payment covers the recovery target, not just the entry threshold');

SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
 $$SELECT * FROM public.temporary_unlock_student_financial_access('81000000-0000-4000-8000-000000000003'::uuid)$$,
 'P0001','TEACHER_REQUIRED','Student cannot grant own temporary unlock');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
 $$SELECT * FROM public.temporary_unlock_student_financial_access('81000000-0000-4000-8000-000000000003'::uuid)$$,
 'P0001','STUDENT_NOT_ASSIGNED','Unrelated teacher cannot unlock student');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
 $$SELECT * FROM public.temporary_unlock_student_financial_access('81000000-0000-4000-8000-000000000003'::uuid)$$,
 'Owning teacher temporarily unlocks a blocked student');
RESET ROLE;
SELECT ok((SELECT manual_unlock_active FROM public.student_financial_access_state
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Manual unlock is persisted');
SELECT ok(NOT (SELECT access_restricted FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Temporary override restores access without wiping debt');
SELECT ok((SELECT is_financially_blocked FROM public.student_financial_access_state
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Underlying blocked state remains true while override is active');

SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.add_student_finance_adjustment(
 '81000000-0000-4000-8000-000000000003'::uuid,-1,'UAH','Regression finance event consumes override')$$,
 'Next financial transaction posts successfully');
RESET ROLE;
SELECT ok(NOT (SELECT manual_unlock_active FROM public.student_financial_access_state
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Finance transaction consumes manual override automatically');
SELECT ok((SELECT access_restricted FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Student is restricted again while still below the recovery target');

SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.add_student_finance_adjustment(
 '81000000-0000-4000-8000-000000000003'::uuid,40002,'UAH','Regression credit exactly to recovery target')$$,
 'Teacher posts payment-equivalent adjustment restoring balance to 200 UAH');
RESET ROLE;
SELECT ok(NOT (SELECT is_financially_blocked FROM public.student_financial_access_state
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Recovery at F+1 lesson threshold clears the financial block');
SELECT ok(NOT (SELECT access_restricted FROM public.teacher_student_financial_access_policy
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),
 'Recovered student is no longer restricted');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
 WHERE student_id='81000000-0000-4000-8000-000000000003'::uuid),4,
 'Exactly four real ledger events drive all transitions; none are duplicated');
SELECT ok(NOT has_function_privilege('authenticated',
 'public.reconcile_student_financial_access(uuid,uuid,boolean,uuid)','EXECUTE'),
 'Browser clients cannot invoke privileged reconciliation directly');

SELECT * FROM finish();
ROLLBACK;
