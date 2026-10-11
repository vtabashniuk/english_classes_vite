-- Allow a dedicated per-teacher page size for collection definitions.
-- Existing settings stay valid; collection-content page size remains independent.
create or replace function public.valid_page_preferences(p_preferences jsonb)
returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_preferences) is distinct from 'object' then false
    else not exists (
      select 1 from jsonb_each(p_preferences) as e(key, value)
      where e.key not in (
        'teacherMaterials', 'teacherCollections', 'teacherCollectionList', 'teacherStudentMaterials',
        'teacherPendingAssignments', 'teacherCompletedAssignments', 'teacherNotifications',
        'studentMaterials', 'studentPendingAssignments', 'studentCompletedAssignments', 'studentNotifications'
      ) or jsonb_typeof(e.value) <> 'number'
        or e.value::text not in ('2', '3', '5', '10', '20', '50')
    ) end
$$;

