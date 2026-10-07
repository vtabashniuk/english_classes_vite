begin;

-- Expose the persisted financial block state together with lifecycle data so
-- the teacher student list can group active debtors without N+1 policy calls.
drop function if exists public.list_teacher_students_lifecycle();

create function public.list_teacher_students_lifecycle()
returns table (
  student_id uuid,
  email text,
  full_name text,
  phone text,
  profile_is_active boolean,
  learning_status public.student_learning_status,
  created_at timestamptz,
  status_changed_at timestamptz,
  pause_until date,
  is_financially_blocked boolean,
  manual_unlock_active boolean,
  financial_access_restricted boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_REQUIRED'; end if;

  perform public.reconcile_expired_student_pauses(auth.uid(), null);

  return query
  select
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.is_active,
    rel.learning_status,
    p.created_at,
    rel.status_changed_at,
    rel.pause_until,
    coalesce(policy.is_financially_blocked, false),
    coalesce(policy.manual_unlock_active, false),
    coalesce(policy.access_restricted, false)
  from public.teacher_students rel
  join public.profiles p
    on p.id = rel.student_id
  left join public.teacher_student_financial_access_policy policy
    on policy.teacher_id = rel.teacher_id
   and policy.student_id = rel.student_id
  where rel.teacher_id = auth.uid()
    and rel.is_active = true
    and p.role = 'student'
  order by p.full_name nulls last, p.email;
end;
$function$;

revoke all on function public.list_teacher_students_lifecycle()
  from public, anon;
grant execute on function public.list_teacher_students_lifecycle()
  to authenticated, service_role;

commit;
