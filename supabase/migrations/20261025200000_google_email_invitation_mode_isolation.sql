-- Gate 4.5-B: keep Google-pending and Email+password invitation methods isolated.
-- Applies locally first. Does not alter Production configurations or any existing migration.
BEGIN;

-- One-time repair: an actively linked student can no longer accept a pending
-- Google offer. Do not delete audit history or change accepted invitations.
UPDATE crm_private.pending_google_invitations i
SET status = 'cancelled', updated_at = now()
WHERE i.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    JOIN public.teacher_students ts ON ts.student_id = u.id AND ts.is_active = true
    WHERE lower(btrim(u.email)) = i.email
      AND lower(btrim(p.email)) = i.email
      AND p.role = 'student'::public.user_role
  );

-- Defense in depth: never show an offer that is no longer actionable because
-- the matching account already has an active teacher relationship.
CREATE OR REPLACE FUNCTION public.list_my_pending_google_invitations()
RETURNS TABLE(id uuid, email text, full_name text, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT i.id, i.email, i.full_name, i.created_at, i.expires_at
  FROM crm_private.pending_google_invitations i
  JOIN public.profiles teacher ON teacher.id = i.teacher_id
  WHERE i.teacher_id = (SELECT auth.uid())
    AND teacher.role = 'teacher' AND teacher.is_active = true
    AND i.status = 'pending' AND i.expires_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM auth.users u
      JOIN public.profiles student ON student.id = u.id
      JOIN public.teacher_students ts ON ts.student_id = u.id AND ts.is_active = true
      WHERE lower(btrim(u.email)) = i.email
        AND lower(btrim(student.email)) = i.email
        AND student.role = 'student'::public.user_role
    )
  ORDER BY i.created_at DESC, i.id DESC;
$fn$;
REVOKE ALL ON FUNCTION public.list_my_pending_google_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_google_invitations() TO authenticated;

-- New Auth account path: never issue an email admission while a live Google
-- invitation for this email exists. Teacher must cancel the Google offer first.
CREATE OR REPLACE FUNCTION public.issue_email_invitation_admission(
  p_teacher_id uuid, p_email text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ticket text;
BEGIN
  IF p_teacher_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_teacher_id AND p.role = 'teacher' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'ADMISSION_TEACHER_NOT_ACTIVE';
  END IF;
  IF length(v_email) NOT BETWEEN 3 AND 254
     OR position('@' IN v_email) <= 1 OR v_email ~ '[[:space:]]'
     OR position('.' IN split_part(v_email, '@', 2)) = 0 THEN
    RAISE EXCEPTION 'ADMISSION_INVALID_EMAIL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM crm_private.pending_google_invitations i
    WHERE i.email = v_email AND i.status = 'pending' AND i.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'ADMISSION_GOOGLE_INVITATION_PENDING';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(btrim(u.email)) = v_email)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE lower(btrim(p.email)) = v_email) THEN
    RAISE EXCEPTION 'ADMISSION_ACCOUNT_ALREADY_EXISTS';
  END IF;
  v_ticket := pg_catalog.gen_random_uuid()::text || '.' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO crm_private.email_invitation_admissions (teacher_id, email, ticket_hash)
  VALUES (p_teacher_id, v_email, pg_catalog.sha256(pg_catalog.convert_to(v_ticket, 'UTF8')));
  RETURN v_ticket;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_email_invitation_admission(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_email_invitation_admission(uuid,text)
  TO service_role;

-- Existing Auth/profile path. An unlinked Google account may ONLY join a
-- teacher through an explicit Google acceptance, never by sending an email
-- invitation to the same address. The trusted Edge Function handles this RPC
-- instead of writing teacher_students directly.
CREATE OR REPLACE FUNCTION public.link_existing_student_email_invitation(
  p_teacher_id uuid, p_student_id uuid, p_email text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_active_teacher uuid;
  v_has_own_history boolean;
BEGIN
  IF p_teacher_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_teacher_id AND p.role = 'teacher' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'EMAIL_LINK_TEACHER_NOT_ACTIVE';
  END IF;
  IF p_student_id IS NULL OR length(v_email) NOT BETWEEN 3 AND 254
     OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'EMAIL_LINK_STUDENT_NOT_AVAILABLE';
  END IF;

  -- The Google acceptance RPC locks this same profile row, so an email
  -- re-link and a Google acceptance cannot attach competing teachers.
  PERFORM 1
  FROM public.profiles p JOIN auth.users u ON u.id = p.id
  WHERE p.id = p_student_id
    AND lower(btrim(p.email)) = v_email
    AND lower(btrim(u.email)) = v_email
    AND p.role = 'student'::public.user_role AND p.is_active = true
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMAIL_LINK_STUDENT_NOT_AVAILABLE';
  END IF;

  SELECT ts.teacher_id INTO v_active_teacher
  FROM public.teacher_students ts
  WHERE ts.student_id = p_student_id AND ts.is_active = true;
  IF v_active_teacher IS NOT NULL AND v_active_teacher <> p_teacher_id THEN
    RAISE EXCEPTION 'EMAIL_LINK_OTHER_ACTIVE_TEACHER';
  END IF;
  IF v_active_teacher = p_teacher_id THEN
    -- Repair stale invitations even when the call is idempotent.
    UPDATE crm_private.pending_google_invitations i
    SET status = 'cancelled', updated_at = now()
    WHERE i.email = v_email AND i.status = 'pending';
    RETURN 'already_linked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teacher_students ts
    WHERE ts.student_id = p_student_id AND ts.teacher_id <> p_teacher_id
  ) THEN
    RAISE EXCEPTION 'EMAIL_LINK_OTHER_HISTORICAL_TEACHER';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_students ts
    WHERE ts.student_id = p_student_id AND ts.teacher_id = p_teacher_id
  ) INTO v_has_own_history;

  -- Pending Google onboarding always takes precedence over email restoration.
  -- A brand-new Google profile is never silently adopted by email invitation,
  -- even if its pending Google offer has expired or was cancelled.
  IF EXISTS (
    SELECT 1 FROM crm_private.pending_google_invitations i
    WHERE i.email = v_email AND i.status = 'pending' AND i.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'EMAIL_LINK_PENDING_GOOGLE_INVITATION';
  END IF;
  IF NOT v_has_own_history AND EXISTS (
    SELECT 1 FROM auth.identities ai
    WHERE ai.user_id = p_student_id AND ai.provider = 'google'
  ) THEN
    RAISE EXCEPTION 'EMAIL_LINK_GOOGLE_ACCEPTANCE_REQUIRED';
  END IF;

  IF v_has_own_history THEN
    UPDATE public.teacher_students ts
    SET is_active = true
    WHERE ts.teacher_id = p_teacher_id AND ts.student_id = p_student_id;
  ELSE
    INSERT INTO public.teacher_students (teacher_id, student_id, is_active)
    VALUES (p_teacher_id, p_student_id, true);
  END IF;

  -- Any old expired/inert offers must not remain displayed after linking.
  UPDATE crm_private.pending_google_invitations i
  SET status = 'cancelled', updated_at = now()
  WHERE i.email = v_email AND i.status = 'pending';
  RETURN 'relationship_restored';
END;
$fn$;
REVOKE ALL ON FUNCTION public.link_existing_student_email_invitation(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_existing_student_email_invitation(uuid,uuid,text)
  TO service_role;

-- Race guard: if a Google offer appeared after an email ticket was issued,
-- refuse its use at the *actual* Auth user-creation boundary. Preserve the
-- existing tested email-ticket flow, and all Google admission conditions.
CREATE OR REPLACE FUNCTION public.crm_before_user_created_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(event #>> '{user,email}', '')));
  v_provider text := coalesce(event #>> '{user,app_metadata,provider}', '');
  v_ticket text := event #>> '{user,user_metadata,crm_email_invite_ticket}';
  v_count integer := 0;
BEGIN
  IF v_provider = 'email'
     AND length(v_ticket) = 73
     AND v_ticket ~ '^[0-9a-f-]{36}\.[0-9a-f-]{36}$'
     AND length(v_email) BETWEEN 3 AND 254
     AND NOT EXISTS (
       SELECT 1 FROM crm_private.pending_google_invitations i
       WHERE i.email = v_email AND i.status = 'pending' AND i.expires_at > now()
     ) THEN
    UPDATE crm_private.email_invitation_admissions a
    SET consumed_at = now()
    WHERE a.email = v_email
      AND a.ticket_hash = pg_catalog.sha256(pg_catalog.convert_to(v_ticket, 'UTF8'))
      AND a.expires_at > now()
      AND a.consumed_at IS NULL AND a.revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = a.teacher_id AND p.role = 'teacher' AND p.is_active = true
      );
    GET DIAGNOSTICS v_count = row_count;
  END IF;
  IF v_count = 1 THEN
    RETURN '{}'::jsonb;
  END IF;

  IF v_provider = 'google'
     AND event #> '{user,app_metadata,providers}' @> '["google"]'::jsonb
     AND event #> '{user,user_metadata,email_verified}' = 'true'::jsonb
     AND event #> '{user,is_anonymous}' = 'false'::jsonb
     AND length(v_email) BETWEEN 3 AND 254
     AND position('@' IN v_email) > 1
     AND v_email !~ '[[:space:]]'
     AND position('.' IN split_part(v_email, '@', 2)) > 0
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.email) = v_email)
     AND EXISTS (
       SELECT 1
       FROM crm_private.pending_google_invitations i
       JOIN public.profiles p ON p.id = i.teacher_id
       WHERE i.email = v_email AND i.status = 'pending' AND i.expires_at > now()
         AND p.role = 'teacher' AND p.is_active = true
     ) THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'error', pg_catalog.jsonb_build_object(
      'http_code', 403,
      'message', 'Invitation required to create a CRM account.'
    )
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_before_user_created_hook(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.crm_before_user_created_hook(jsonb) TO supabase_auth_admin;

COMMIT;
NOTIFY pgrst, 'reload schema';
