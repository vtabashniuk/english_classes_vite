-- Gate 4.5-A / P1: safe re-invitation of admitted, not-yet-linked Google users.
-- Deliberately does not change the email invitation flow, Auth Hook or RLS.
BEGIN;

create or replace function public.create_pending_google_invitation(
  p_teacher_id uuid, p_email text, p_full_name text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_id uuid;
  v_user_id uuid;
  v_user_count integer;
  v_profile_count integer;
begin
  if p_teacher_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_teacher_id and p.role = 'teacher' and p.is_active = true
  ) then
    raise exception 'INVITATION_TEACHER_NOT_ACTIVE';
  end if;

  if length(v_email) not between 3 and 254
     or position('@' in v_email) <= 1
     or v_email ~ '[[:space:]]'
     or position('.' in split_part(v_email,'@',2)) = 0
     or length(v_name) > 200 then
    raise exception 'INVITATION_INVALID_DETAILS';
  end if;

  -- A new Google identity may have been admitted, but still have no teacher
  -- because the student has not consented. Allow ONLY this precise recovery
  -- case: one confirmed, active Google student with matching Auth/profile email,
  -- NO current or historical teacher relationship and NO prior acceptance.
  -- NEVER adopt ordinary email users, teachers, unconfirmed identities or a
  -- previously linked student. Acceptance remains the student's own action.
  select count(*), (array_agg(u.id))[1] into v_user_count, v_user_id
  from auth.users u where lower(btrim(u.email)) = v_email;
  select count(*) into v_profile_count
  from public.profiles p where lower(btrim(p.email)) = v_email;

  if v_user_count > 0 or v_profile_count > 0 then
    if v_user_count <> 1 or v_profile_count <> 1 or not exists (
      select 1 from auth.users u
      join public.profiles p on p.id = u.id
      where u.id = v_user_id
        and lower(btrim(u.email)) = v_email
        and lower(btrim(p.email)) = v_email
        and u.email_confirmed_at is not null
        and p.role = 'student'::public.user_role
        and p.is_active = true
        and exists (
          select 1 from auth.identities ai
          where ai.user_id = u.id
            and ai.provider = 'google'
            and lower(btrim(coalesce(ai.identity_data ->> 'email', ''))) = v_email
        )
        and not exists (
          select 1 from public.teacher_students ts where ts.student_id = u.id
        )
        and not exists (
          select 1 from crm_private.pending_google_invitations i
          where i.accepted_user_id = u.id
        )
    ) then
      raise exception 'INVITATION_ACCOUNT_ALREADY_EXISTS';
    end if;

    -- Serialize re-invitation and activation against the profile row lock
    -- acquired by accept_my_pending_google_invitation(). Check again after
    -- acquiring the lock to close the acceptance race.
    perform 1 from public.profiles p where p.id = v_user_id for update;
    if not exists (
      select 1 from auth.users u
      join public.profiles p on p.id = u.id
      where u.id = v_user_id and u.email_confirmed_at is not null
        and lower(btrim(u.email)) = v_email
        and lower(btrim(p.email)) = v_email
        and p.role = 'student'::public.user_role and p.is_active = true
        and exists (select 1 from auth.identities ai
                    where ai.user_id = u.id and ai.provider = 'google'
                      and lower(btrim(coalesce(ai.identity_data ->> 'email', ''))) = v_email)
    ) or exists (select 1 from public.teacher_students ts where ts.student_id = v_user_id)
       or exists (select 1 from crm_private.pending_google_invitations i
                  where i.accepted_user_id = v_user_id) then
      raise exception 'INVITATION_ACCOUNT_ALREADY_EXISTS';
    end if;
  end if;

  insert into crm_private.pending_google_invitations (
    teacher_id, email, full_name
  ) values (p_teacher_id, v_email, v_name)
  on conflict (teacher_id, email) where status = 'pending'
  do update set
    full_name = excluded.full_name,
    updated_at = now(),
    expires_at = now() + interval '14 days'
  returning id into v_id;

  return v_id;
end;
$fn$;

-- Preserve service-only invitation creation.
REVOKE ALL ON FUNCTION public.create_pending_google_invitation(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_google_invitation(uuid,text,text)
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
