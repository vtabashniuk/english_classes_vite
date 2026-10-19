-- CRM 1.5.2g: FX payment snapshots, Group 3 taxes, ESV residual, and ledger.
-- STRICTLY LOCAL: npx supabase test db --local
-- No real users, no network FX calls, transaction rolled back by pgTAP.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(52);

DO $$ BEGIN
  IF current_database() <> 'postgres'
     OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'LOCAL_TEST_ONLY: npx supabase test db --local';
  END IF;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('79000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fx.teacher@crm-tests.invalid', '!', now(),
   '{"provider":"email","providers":["email"]}', '{"role":"teacher"}', now(), now()),
  ('79000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fx.student.a@crm-tests.invalid', '!', now(),
   '{"provider":"email","providers":["email"]}', '{"role":"student"}', now(), now()),
  ('79000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fx.student.b@crm-tests.invalid', '!', now(),
   '{"provider":"email","providers":["email"]}', '{"role":"student"}', now(), now());

-- TEST FIXTURE ONLY: under postgres, provision synthetic teachers explicitly.
-- Production role assignment must never trust auth.users.raw_user_meta_data.
UPDATE public.profiles SET role = 'teacher'::public.user_role
WHERE id IN (
 '79000000-0000-4000-8000-000000000001'::uuid
);

INSERT INTO public.teacher_students (teacher_id, student_id) VALUES
 ('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002'),
 ('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000003');
INSERT INTO public.teacher_settings (teacher_id) VALUES
 ('79000000-0000-4000-8000-000000000001');

-- Isolated fixed reference wage: 8,000 UAH => ESV 1,760 UAH / 176,000 kop.
-- With 3 identical receipts, each rounds to 58,667, creating a -1 kopek
-- residual. Student A has the largest total receipts and receives that residual.
INSERT INTO public.teacher_tax_parameters (
 teacher_id, code, value_numeric, unit, effective_from
) VALUES ('79000000-0000-4000-8000-000000000001', 'minimum_wage_minor',
 800000, 'uah_minor', (now() AT TIME ZONE 'Europe/Kyiv')::date);

SELECT set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok(public.is_teacher(), 'The payment actor is a teacher');
SELECT lives_ok(
 $$SELECT public.set_my_tax_profile('pe'::public.teacher_taxpayer_type, 3::smallint,
   NULL::numeric, NULL::numeric, NULL::numeric, NULL::date)$$,
 'PE group 3 profile can be set via the teacher RPC');
SELECT is((SELECT pe_group::integer FROM public.teacher_current_tax_profile
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          3, 'PE group is 3');
SELECT is((SELECT single_tax_basis::text FROM public.teacher_current_tax_profile
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          'income_percent', 'Group 3 single tax is turnover-based');
SELECT is((SELECT military_levy_basis::text FROM public.teacher_current_tax_profile
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          'income_percent', 'Group 3 military levy is turnover-based');

SELECT set_config('crm_test.g.uah_account',
  (public.create_payment_account('G PE UAH', 'monobank', 'bank_account',
    'UAH', NULL::text, 'pe'::public.payment_account_owner_type)).id::text, true);
SELECT set_config('crm_test.g.usd_account',
  (public.create_payment_account('G PE USD', 'monobank', 'bank_account',
    'USD', NULL::text, 'pe'::public.payment_account_owner_type)).id::text, true);
SELECT set_config('crm_test.g.eur_account',
  (public.create_payment_account('G Personal EUR', 'monobank', 'card',
    'EUR', NULL::text, 'personal'::public.payment_account_owner_type)).id::text, true);
SELECT is((SELECT count(*)::integer FROM public.payment_accounts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          3, 'Three distinct receiving accounts exist');
SELECT is((SELECT count(*)::integer FROM public.payment_accounts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND owner_type='pe'::public.payment_account_owner_type),
          2, 'Only two accounts are classified as PE');

-- Three equal UAH receipts: two for A and one for B.
SELECT set_config('crm_test.g.uah_a1', (SELECT payment_id::text FROM
 public.record_manual_student_payment('79000000-0000-4000-8000-000000000002'::uuid,
 100000, 'UAH', current_setting('crm_test.g.uah_account')::uuid, 'bank_transfer',
 'g: UAH A1', now(), '79000000-0000-4000-8000-000000000011'::uuid)), true);
SELECT set_config('crm_test.g.uah_a2', (SELECT payment_id::text FROM
 public.record_manual_student_payment('79000000-0000-4000-8000-000000000002'::uuid,
 100000, 'UAH', current_setting('crm_test.g.uah_account')::uuid, 'bank_transfer',
 'g: UAH A2', now(), '79000000-0000-4000-8000-000000000012'::uuid)), true);
SELECT set_config('crm_test.g.uah_b1', (SELECT payment_id::text FROM
 public.record_manual_student_payment('79000000-0000-4000-8000-000000000003'::uuid,
 100000, 'UAH', current_setting('crm_test.g.uah_account')::uuid, 'bank_transfer',
 'g: UAH B1', now(), '79000000-0000-4000-8000-000000000013'::uuid)), true);
RESET ROLE;

SELECT is((SELECT count(*)::integer FROM public.payments
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          3, 'Three UAH payments are recorded');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND transaction_type='payment'::public.finance_transaction_type),
          3, 'Three separate ledger credits exist');
SELECT is((SELECT count(*)::integer FROM public.payment_tax_accruals
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND status='ready'::public.payment_tax_accrual_status),
          3, 'All native UAH PE tax records are ready');
SELECT is((SELECT single_tax_minor FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.uah_a1')::uuid),
          5000::bigint, 'Group 3 single tax is 5 percent of the UAH receipt');
SELECT is((SELECT military_levy_minor FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.uah_a1')::uuid),
          1000::bigint, 'Group 3 military levy is 1 percent of the receipt');
SELECT is((SELECT total_income_taxes_minor FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.uah_a1')::uuid),
          6000::bigint, 'The native receipt tax snapshot totals 6 percent');
SELECT is((SELECT amount_uah_minor FROM public.payment_reporting_values
           WHERE payment_id=current_setting('crm_test.g.uah_a1')::uuid),
          100000::bigint, 'UAH payment has an immediate UAH reporting value');
SELECT is((SELECT count(*)::integer FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          3, 'Three receipt rows are visible in management reporting');
SELECT is((SELECT esv_minor FROM public.teacher_monthly_tax_summary
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND month_start=date_trunc('month', (now() AT TIME ZONE 'Europe/Kyiv'))::date),
          176000::bigint, 'Monthly ESV uses the teacher wage override and 22 percent');
SELECT is((SELECT sum(allocated_fixed_tax_uah_minor)::bigint
           FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          176000::bigint, 'Allocated ESV reconciles exactly to the monthly pool');
SELECT is((SELECT sum(allocated_fixed_tax_uah_minor)::bigint
           FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND student_id='79000000-0000-4000-8000-000000000002'::uuid),
          117333::bigint, 'Largest-receipt student receives the -1 kopek residual');
SELECT is((SELECT sum(allocated_fixed_tax_uah_minor)::bigint
           FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND student_id='79000000-0000-4000-8000-000000000003'::uuid),
          58667::bigint, 'Other student retains the ordinary rounded ESV share');
SELECT is((SELECT sum(net_income_uah_minor)::bigint
           FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          106000::bigint, 'Net UAH income subtracts direct taxes and monthly ESV');

-- Retry with identical request inputs: same payment ID, not a second payment.
SELECT set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT payment_id::text FROM public.record_manual_student_payment(
   '79000000-0000-4000-8000-000000000002'::uuid, 100000, 'UAH',
   current_setting('crm_test.g.uah_account')::uuid, 'bank_transfer',
   'g: UAH A1 retry', now(), '79000000-0000-4000-8000-000000000011'::uuid)),
   current_setting('crm_test.g.uah_a1')::text, 'Matching client request ID returns the original payment');
SELECT is((SELECT count(*)::integer FROM public.payments
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          3, 'Idempotent retry creates no extra payment');
SELECT throws_ok(
 $$SELECT public.record_manual_student_payment(
   '79000000-0000-4000-8000-000000000002'::uuid, 99999, 'UAH',
   current_setting('crm_test.g.uah_account')::uuid, 'bank_transfer',
   NULL, now(), '79000000-0000-4000-8000-000000000011'::uuid)$$,
 'P0001','PAYMENT_REQUEST_ID_CONFLICT', 'Reusing request ID with a different amount fails');

-- PE USD receipt: native USD ledger, reporting and income tax initially pending.
SELECT set_config('crm_test.g.usd', (SELECT payment_id::text FROM
 public.record_manual_student_payment('79000000-0000-4000-8000-000000000002'::uuid,
 10000, 'USD', current_setting('crm_test.g.usd_account')::uuid, 'bank_transfer',
 'g: PE USD', now(), '79000000-0000-4000-8000-000000000014'::uuid)), true);
SELECT is((SELECT status::text FROM public.payment_reporting_values
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          'fx_pending', 'USD reporting remains pending until FX is resolved');
SELECT is((SELECT status::text FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          'fx_pending', 'USD PE income tax initially awaits the FX snapshot');
SELECT is((SELECT currency::text FROM public.student_finance_transactions
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          'USD', 'Currency is preserved in the immutable ledger');
SELECT is((SELECT amount_minor FROM public.student_finance_transactions
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          10000::bigint, 'Ledger stores original USD cents, not UAH equivalent');

RESET ROLE;
SELECT throws_ok(
 $$SELECT public.finalize_payment_tax_accrual(current_setting('crm_test.g.usd')::uuid,
  -1::numeric, (now() AT TIME ZONE 'Europe/Kyiv')::date)$$,
 'P0001','INVALID_FX_RATE', 'Negative tax FX rates are rejected');
SELECT throws_ok(
 $$SELECT public.finalize_payment_reporting_value(current_setting('crm_test.g.usd')::uuid,
  0::numeric, (now() AT TIME ZONE 'Europe/Kyiv')::date)$$,
 'P0001','INVALID_FX_RATE', 'Zero reporting FX rates are rejected');
SELECT lives_ok(
 $$SELECT public.finalize_payment_tax_accrual(current_setting('crm_test.g.usd')::uuid,
  40.12345678::numeric, (now() AT TIME ZONE 'Europe/Kyiv')::date)$$,
 'Trusted tax resolver finalizes the USD tax accrual');
SELECT lives_ok(
 $$SELECT public.finalize_payment_reporting_value(current_setting('crm_test.g.usd')::uuid,
  40.12345678::numeric, (now() AT TIME ZONE 'Europe/Kyiv')::date)$$,
 'Trusted reporting resolver finalizes the USD UAH equivalent');
SELECT is((SELECT tax_base_uah_minor FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          401235::bigint, 'USD converted UAH tax base rounds only at the final kopek');
SELECT is((SELECT total_income_taxes_minor FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          24074::bigint, 'USD taxes use 5 and 1 percent of the stored UAH base');
SELECT is((SELECT amount_uah_minor FROM public.payment_reporting_values
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          401235::bigint, 'Management value uses the identical stored FX rate');
SELECT is((SELECT fx_rate FROM public.payment_reporting_values
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          40.12345678::numeric, 'Precise NBU rate is snapshotted for reporting');
SELECT lives_ok(
 $$SELECT public.finalize_payment_reporting_value(current_setting('crm_test.g.usd')::uuid,
  42::numeric, (now() AT TIME ZONE 'Europe/Kyiv')::date)$$,
 'Resolving an already-ready report is idempotent');
SELECT is((SELECT fx_rate FROM public.payment_reporting_values
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          40.12345678::numeric, 'Later FX resolver calls cannot overwrite the snapshot');
SELECT lives_ok(
 $$SELECT public.finalize_payment_tax_accrual(current_setting('crm_test.g.usd')::uuid,
  42::numeric, (now() AT TIME ZONE 'Europe/Kyiv')::date)$$,
 'Resolving an already-ready tax accrual is idempotent');
SELECT is((SELECT tax_base_uah_minor FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.usd')::uuid),
          401235::bigint, 'Tax base remains unchanged after duplicate resolver call');

-- EUR personal account: UAH reporting is necessary; PE tax is not created.
SELECT set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT set_config('crm_test.g.eur', (SELECT payment_id::text FROM
 public.record_manual_student_payment('79000000-0000-4000-8000-000000000003'::uuid,
 5000, 'EUR', current_setting('crm_test.g.eur_account')::uuid, 'bank_transfer',
 'g: personal EUR', now(), '79000000-0000-4000-8000-000000000015'::uuid)), true);
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.payment_tax_accruals
           WHERE payment_id=current_setting('crm_test.g.eur')::uuid),
          0, 'Personal EUR receipt does not generate PE income tax');
SELECT is((SELECT status::text FROM public.payment_reporting_values
           WHERE payment_id=current_setting('crm_test.g.eur')::uuid),
          'fx_pending', 'Personal EUR still requires a reporting FX snapshot');
SELECT lives_ok(
 $$SELECT public.finalize_payment_reporting_value(current_setting('crm_test.g.eur')::uuid,
   44.4::numeric, (now() AT TIME ZONE 'Europe/Kyiv')::date)$$,
 'Reporting resolver can finalize personal EUR without tax accrual');
SELECT is((SELECT amount_uah_minor FROM public.payment_reporting_values
           WHERE payment_id=current_setting('crm_test.g.eur')::uuid),
          222000::bigint, 'Personal EUR converted into UAH for analytics');
SELECT is((SELECT count(*)::integer FROM public.student_finance_transactions
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND transaction_type='payment'::public.finance_transaction_type),
          5, 'FX finalization creates no extra balance transactions');
SELECT is((SELECT count(*)::integer FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid
             AND profitability_status='ready'),
          5, 'All management receipt rows are ready after FX resolution');
SELECT is((SELECT sum(reporting_uah_minor)::bigint FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          923235::bigint, 'Final UAH reporting includes UAH, USD and EUR');
SELECT is((SELECT sum(direct_tax_uah_minor)::bigint FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          42074::bigint, 'Direct tax sum includes only PE income taxes');
SELECT is((SELECT sum(allocated_fixed_tax_uah_minor)::bigint
           FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          176000::bigint, 'Full fixed monthly ESV is allocated after FX is ready');
SELECT is((SELECT sum(net_income_uah_minor)::bigint
           FROM public.teacher_finance_receipts
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          705161::bigint, 'Net income reconciles to receipts minus direct and fixed taxes');
SELECT is((SELECT count(DISTINCT currency)::integer FROM public.student_finance_transactions
           WHERE teacher_id='79000000-0000-4000-8000-000000000001'::uuid),
          3, 'Ledger retains all three independent original currencies');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.finalize_payment_tax_accrual(uuid,numeric,date)', 'EXECUTE'),
  'Browsers cannot set tax FX snapshots directly');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.finalize_payment_reporting_value(uuid,numeric,date)', 'EXECUTE'),
  'Browsers cannot set reporting FX snapshots directly');

SELECT * FROM finish();
ROLLBACK;
