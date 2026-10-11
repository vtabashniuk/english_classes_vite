-- CRM Stage 1.5.2b: privileges, RLS settings, immutable ledger constraints.
-- Run exclusively via npx supabase test db --local; no fixtures or production access.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(17);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass), 'Profiles enforce RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.teacher_students'::regclass), 'Teacher-student links enforce RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.lessons'::regclass), 'Lessons enforce RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.payments'::regclass), 'Payments enforce RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.student_finance_transactions'::regclass), 'Finance ledger enforces RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.materials'::regclass), 'Materials enforce RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.student_materials'::regclass), 'Material grants enforce RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.assignments'::regclass), 'Assignments enforce RLS');

SELECT ok(NOT has_table_privilege('anon','public.payments','SELECT'), 'Anonymous clients cannot read payments');
SELECT ok(NOT has_table_privilege('authenticated','public.payments','INSERT'), 'Authenticated clients cannot insert payments directly');
SELECT ok(NOT has_table_privilege('authenticated','public.student_finance_transactions','UPDATE'), 'Authenticated clients cannot edit finance ledger');
SELECT ok(NOT has_table_privilege('authenticated','public.student_finance_transactions','DELETE'), 'Authenticated clients cannot delete finance ledger');
SELECT ok(NOT has_table_privilege('authenticated','public.student_materials','INSERT'), 'Material grants cannot be inserted directly by browser');
SELECT ok(NOT has_table_privilege('authenticated','public.teacher_students','UPDATE'), 'Teacher relationships cannot be altered directly by browser');
SELECT ok(NOT has_function_privilege('authenticated','public.dispatch_overdue_assignment_reminders()','EXECUTE'), 'Authenticated clients cannot run privileged reminder scheduler');
SELECT ok(NOT has_function_privilege('anon','public.revoke_material_from_student(uuid,uuid)','EXECUTE'), 'Anonymous client cannot invoke material revoke');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid='public.student_finance_transactions'::regclass
    AND t.tgname='student_finance_transactions_immutable'
    AND NOT t.tgisinternal AND t.tgenabled <> 'D'
), 'Immutable ledger trigger remains enabled');

SELECT * FROM finish();
ROLLBACK;
