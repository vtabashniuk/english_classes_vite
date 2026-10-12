-- CRM 1.5.2i: bulk material sharing, assignment links and access revocation.
-- Only run via `npx supabase test db --local`. Test data is rolled back.
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;
SELECT plan(27);
DO $$ BEGIN
 IF current_database() <> 'postgres' OR current_user NOT IN ('postgres','supabase_admin')
 THEN RAISE EXCEPTION 'LOCAL_TEST_ONLY: use npx supabase test db --local'; END IF;
END $$;

INSERT INTO auth.users (
 id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('82000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','materials.teacher.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"teacher"}',now(),now()),
 ('82000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','materials.teacher.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"teacher"}',now(),now()),
 ('82000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','materials.student.a@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"student"}',now(),now()),
 ('82000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','materials.student.b@crm-tests.invalid','!',now(),'{"provider":"email","providers":["email"]}','{"role":"student"}',now(),now());
INSERT INTO public.teacher_students(teacher_id,student_id) VALUES
 ('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000003'),
 ('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000004');
INSERT INTO public.materials(id,teacher_id,title,description,url,tags) VALUES
 ('82100000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Material A1','Complete metadata A1','https://example.invalid/a1',ARRAY['A2']),
 ('82100000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','Material A2','Complete metadata A2','https://example.invalid/a2',ARRAY['A2']),
 ('82100000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','Material not shared','Complete metadata A3','https://example.invalid/a3',ARRAY['A2']),
 ('82100000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000002','Material owned by B','Complete metadata B1','https://example.invalid/b1',ARRAY['B1']);

SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
 $$SELECT public.grant_collection_materials_to_student('82000000-0000-4000-8000-000000000003'::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid])$$,
 'P0001','ACCESS_DENIED','Another teacher cannot grant to an unrelated student');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
 $$SELECT public.grant_collection_materials_to_student('82000000-0000-4000-8000-000000000004'::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid])$$,
 'P0001','ACCESS_DENIED','Teacher cannot bulk-grant to another teacher student');
SELECT throws_ok(
 $$SELECT public.grant_collection_materials_to_student('82000000-0000-4000-8000-000000000003'::uuid,
 ARRAY['82100000-0000-4000-8000-000000000004'::uuid])$$,
 'P0001','ACCESS_DENIED','Teacher cannot grant another teacher material');
SELECT throws_ok(
 $$SELECT public.grant_collection_materials_to_student('82000000-0000-4000-8000-000000000003'::uuid,ARRAY[]::uuid[])$$,
 'P0001','INVALID_MATERIAL_SELECTION','Empty material selection cannot be shared');
SELECT is(public.grant_collection_materials_to_student(
 '82000000-0000-4000-8000-000000000003'::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid,
       '82100000-0000-4000-8000-000000000002'::uuid,
       '82100000-0000-4000-8000-000000000001'::uuid]), 2,
 'Two unique materials are granted once despite duplicate IDs');
SELECT is((SELECT count(*)::integer FROM public.student_materials
 WHERE student_id='82000000-0000-4000-8000-000000000003'::uuid AND revoked_at IS NULL),2,
 'Exactly two active grants exist after the batch');
-- Notification rows belong to the student and are not RLS-visible to the teacher.
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.notifications
 WHERE user_id='82000000-0000-4000-8000-000000000003'::uuid AND type='material_shared'),1,
 'One bulk share produces only one sharing notification');
SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.material_access_events
 WHERE student_id='82000000-0000-4000-8000-000000000003'::uuid AND event_type='assigned'),2,
 'Each new grant has an audit event');
SELECT is(public.grant_collection_materials_to_student(
 '82000000-0000-4000-8000-000000000003'::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid,
       '82100000-0000-4000-8000-000000000002'::uuid]),0,
 'Re-running batch sharing is idempotent for existing active grants');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.notifications
 WHERE user_id='82000000-0000-4000-8000-000000000003'::uuid AND type='material_shared'),1,
 'No new material notification is created on idempotent retry');
SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT ok(length(set_config('crm_test.i.assignment',
 public.create_assignment('82000000-0000-4000-8000-000000000003'::uuid,
 'Homework with shared resources','A2 practice',current_date+10,NULL::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid,
       '82100000-0000-4000-8000-000000000002'::uuid])::text,true))>30,
 'Teacher creates a real assignment with two shared materials');
SELECT is((SELECT count(*)::integer FROM public.assignment_materials
 WHERE assignment_id=current_setting('crm_test.i.assignment')::uuid),2,
 'Assignment references both shared resources');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.materials),2,
 'Student sees only actively granted materials before revocation');
SELECT is((SELECT count(*)::integer FROM public.assignments
 WHERE id=current_setting('crm_test.i.assignment')::uuid),1,
 'Student can read own assigned task');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
 $$SELECT public.revoke_material_from_student('82100000-0000-4000-8000-000000000001'::uuid,
 '82000000-0000-4000-8000-000000000003'::uuid)$$,
 'Teacher revokes one resource used in an assignment');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.materials),1,
 'Revoked resource disappears from student catalog');
SELECT is((SELECT count(*)::integer FROM public.assignment_materials
 WHERE assignment_id=current_setting('crm_test.i.assignment')::uuid),2,
 'Historical assignment links remain despite revocation');
SELECT is((SELECT count(*)::integer FROM public.materials
 WHERE id='82100000-0000-4000-8000-000000000001'::uuid),0,
 'Assignment link does not restore visibility of revoked material');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
 $$SELECT public.update_assignment(current_setting('crm_test.i.assignment')::uuid,
 '82000000-0000-4000-8000-000000000003'::uuid,'Homework updated',null::text,current_date+10,NULL::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid,
       '82100000-0000-4000-8000-000000000002'::uuid,
       '82100000-0000-4000-8000-000000000003'::uuid])$$,
 'P0001','MATERIAL_NOT_SHARED','Unshared third resource cannot be added to the assignment');
SELECT lives_ok(
 $$SELECT public.update_assignment(current_setting('crm_test.i.assignment')::uuid,
 '82000000-0000-4000-8000-000000000003'::uuid,'Homework updated',null::text,current_date+10,NULL::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid,
       '82100000-0000-4000-8000-000000000002'::uuid])$$,
 'Unchanged historical link may remain without silently restoring access');
SELECT is((SELECT count(*)::integer FROM public.assignment_materials
 WHERE assignment_id=current_setting('crm_test.i.assignment')::uuid),2,
 'Assignment update preserves exactly the two historical material links');
SELECT ok((SELECT revoked_at IS NOT NULL FROM public.student_materials
 WHERE student_id='82000000-0000-4000-8000-000000000003'::uuid
 AND material_id='82100000-0000-4000-8000-000000000001'::uuid),
 'Assignment update does not undo the material revocation');
SELECT is(public.grant_collection_materials_to_student(
 '82000000-0000-4000-8000-000000000003'::uuid,
 ARRAY['82100000-0000-4000-8000-000000000001'::uuid]),1,
 'Explicit bulk grant restores previously revoked material');
SELECT is((SELECT count(*)::integer FROM public.material_access_events
 WHERE student_id='82000000-0000-4000-8000-000000000003'::uuid AND event_type='restored'),1,
 'Explicit restoration is logged exactly once');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.notifications
 WHERE user_id='82000000-0000-4000-8000-000000000003'::uuid AND type='material_shared'),2,
 'Restoration batch generates a single additional notification');

SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.materials),2,
 'Student visibility is restored only after explicit re-grant');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.materials),0,
 'Another teacher student never sees shared resources from this relationship');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
