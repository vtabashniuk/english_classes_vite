-- CRM 1.5.2i: due-day reminder timing, actual dispatcher and deduplication.
-- Only run via `npx supabase test db --local`. No external email or network is used.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(20);
DO $$ BEGIN
 IF current_database() <> 'postgres' OR current_user NOT IN ('postgres','supabase_admin')
 THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY: use npx supabase test db --local'; END IF;
END $$;

-- Pure timing assertions are stable at any runner wall-clock hour.
SELECT ok(NOT public.assignment_reminder_eligible_at('2026-10-14'::date,NULL,
 '2026-10-14 08:59'::timestamp AT TIME ZONE 'Europe/Kyiv'),
 'Unlinked assignment must not be reminded before 09:00 Kyiv');
SELECT ok(public.assignment_reminder_eligible_at('2026-10-14'::date,NULL,
 '2026-10-14 09:00'::timestamp AT TIME ZONE 'Europe/Kyiv'),
 'Unlinked assignment becomes eligible at 09:00 Kyiv');
SELECT ok(NOT public.assignment_reminder_eligible_at('2026-10-14'::date,NULL,
 '2026-10-13 10:00'::timestamp AT TIME ZONE 'Europe/Kyiv'),
 'No reminder on previous calendar date');
SELECT ok(NOT public.assignment_reminder_eligible_at('2026-10-14'::date,NULL,
 '2026-10-15 10:00'::timestamp AT TIME ZONE 'Europe/Kyiv'),
 'No reminder on following calendar date');
SELECT ok(NOT public.assignment_reminder_eligible_at('2026-10-14'::date,
 '2026-10-14 14:00'::timestamp AT TIME ZONE 'Europe/Kyiv',
 '2026-10-14 12:59'::timestamp AT TIME ZONE 'Europe/Kyiv'),
 'Linked assignment is not eligible 61 minutes before scheduled lesson');
SELECT ok(public.assignment_reminder_eligible_at('2026-10-14'::date,
 '2026-10-14 14:00'::timestamp AT TIME ZONE 'Europe/Kyiv',
 '2026-10-14 13:00'::timestamp AT TIME ZONE 'Europe/Kyiv'),
 'Linked assignment becomes eligible exactly an hour before lesson');
SELECT ok(public.assignment_reminder_eligible_at('2026-10-14'::date,
 '2026-10-14 14:00'::timestamp AT TIME ZONE 'Europe/Kyiv',
 '2026-10-14 13:45'::timestamp AT TIME ZONE 'Europe/Kyiv'),
 'Linked assignment stays eligible after its reminder threshold');

INSERT INTO auth.users (
 id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('83000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reminder.teacher@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"teacher"}',now(),now()),
 ('83000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reminder.student@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"student"}',now(),now());

-- TEST FIXTURE ONLY: under postgres, provision synthetic teachers explicitly.
-- Production role assignment must never trust auth.users.raw_user_meta_data.
UPDATE public.profiles SET role = 'teacher'::public.user_role
WHERE id IN (
 '83000000-0000-4000-8000-000000000001'::uuid
);

INSERT INTO public.teacher_students(teacher_id,student_id)
VALUES ('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002');
INSERT INTO public.teacher_settings(teacher_id) VALUES ('83000000-0000-4000-8000-000000000001');
INSERT INTO public.student_lesson_rates(teacher_id,student_id,amount_minor,currency,effective_from)
VALUES ('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',10000,'UAH',current_date-20);

-- Before 09:00 Kyiv we attach a direct synthetic lesson starting 15 min from
-- now, making the dispatcher eligible regardless of CI runner local time.
-- At/after 09:00 an unlinked assignment is already eligible by design.
INSERT INTO public.lessons(id,teacher_id,student_id,starts_at,ends_at,duration_minutes)
SELECT '83100000-0000-4000-8000-000000000001'::uuid,
 '83000000-0000-4000-8000-000000000001'::uuid,
 '83000000-0000-4000-8000-000000000002'::uuid,
 now()+interval '15 minutes', now()+interval '65 minutes',50
WHERE (now() AT TIME ZONE 'Europe/Kyiv')::time < time '09:00';

SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT ok(length(set_config('crm_test.i.reminder_assignment',
 public.create_assignment('83000000-0000-4000-8000-000000000002'::uuid,
 'Reminder due today','Synthetic homework',
 (now() AT TIME ZONE 'Europe/Kyiv')::date,
 (SELECT id FROM public.lessons WHERE id='83100000-0000-4000-8000-000000000001'::uuid),
 ARRAY[]::uuid[])::text,true))>30,
 'Teacher creates a due-today assignment through authorized RPC');
RESET ROLE;
SELECT is((SELECT due_date FROM public.assignments
 WHERE id=current_setting('crm_test.i.reminder_assignment')::uuid),
 (now() AT TIME ZONE 'Europe/Kyiv')::date,
 'Assignment due date matches Kyiv local current date');
SELECT ok((SELECT public.assignment_reminder_eligible_at(a.due_date,l.starts_at,now())
 FROM public.assignments a LEFT JOIN public.lessons l ON l.id=a.lesson_id
 WHERE a.id=current_setting('crm_test.i.reminder_assignment')::uuid),
 'Due-today assignment is eligible at any runner hour');
SELECT ok(NOT has_function_privilege('authenticated',
 'public.dispatch_due_assignment_reminders()','EXECUTE'),
 'Regular signed-in users cannot execute the privileged reminder dispatcher');
SELECT lives_ok($$SELECT public.dispatch_due_assignment_reminders()$$,
 'Privileged local dispatcher runs without emailing users');
SELECT is((SELECT count(*)::integer FROM public.assignment_reminder_events
 WHERE assignment_id=current_setting('crm_test.i.reminder_assignment')::uuid),1,
 'First dispatch creates one reminder audit event');
SELECT is((SELECT count(*)::integer FROM public.notifications
 WHERE user_id='83000000-0000-4000-8000-000000000002'::uuid
   AND type='assignment_due_reminder'
   AND data ->> 'assignmentId'=current_setting('crm_test.i.reminder_assignment')),1,
 'First dispatch creates one in-app reminder notification');
SELECT lives_ok($$SELECT public.dispatch_due_assignment_reminders()$$,
 'Repeating the dispatcher is valid and does not fail');
SELECT is((SELECT count(*)::integer FROM public.assignment_reminder_events
 WHERE assignment_id=current_setting('crm_test.i.reminder_assignment')::uuid),1,
 'Repeated dispatch never duplicates the event');
SELECT is((SELECT count(*)::integer FROM public.notifications
 WHERE user_id='83000000-0000-4000-8000-000000000002'::uuid
 AND type='assignment_due_reminder'
 AND data ->> 'assignmentId'=current_setting('crm_test.i.reminder_assignment')),1,
 'Repeated dispatch never duplicates the notification');

-- Changing a deadline does not erase historical event; the composite primary
-- key permits a separate event for a genuinely different deadline later.
UPDATE public.assignments SET lesson_id=NULL, due_date=(now() AT TIME ZONE 'Europe/Kyiv')::date + 1
WHERE id=current_setting('crm_test.i.reminder_assignment')::uuid;
SELECT is((SELECT count(*)::integer FROM public.assignment_reminder_events
 WHERE assignment_id=current_setting('crm_test.i.reminder_assignment')::uuid
 AND due_date=(now() AT TIME ZONE 'Europe/Kyiv')::date),1,
 'Historical event remains associated with the original deadline');
SELECT is((SELECT count(*)::integer FROM public.assignment_reminder_events
 WHERE assignment_id=current_setting('crm_test.i.reminder_assignment')::uuid
 AND due_date=(now() AT TIME ZONE 'Europe/Kyiv')::date + 1),0,
 'A new deadline has no audit event until it becomes eligible');
SELECT ok(public.assignment_reminder_eligible_at(
 (now() AT TIME ZONE 'Europe/Kyiv')::date + 1,NULL,
 (((now() AT TIME ZONE 'Europe/Kyiv')::date+1)::timestamp+interval '09:00') AT TIME ZONE 'Europe/Kyiv'),
 'Rescheduled deadline becomes independently eligible on its new date');

SELECT * FROM finish();
ROLLBACK;
