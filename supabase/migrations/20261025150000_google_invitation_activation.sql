-- CRM Google OAuth / Gate 4.3-A: student-confirmed invitation activation.
-- Only deploy locally until Gate 4.5 security + regression review is complete.
-- Does not touch email signup, admission hook, provider configuration, or finance.
BEGIN;

-- This RPC exposes ONLY an authenticated Google student's own *pending* offers.
-- It never reveals email addresses from other users or arbitrary invitations.
CREATE OR REPLACE FUNCTION public.list_my_google_invitation_choices()
RETURNS TABLE (
  invitation_id uuid,
  teacher_id uuid,
  teacher_name text,
  expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT i.id, i.teacher_id, coalesce(p.full_name, ''), i.expires_at
  FROM crm_private.pending_google_invitations i
  JOIN public.profiles p ON p.id = i.teacher_id
  JOIN public.profiles student ON student.id = (SELECT auth.uid())
  JOIN auth.users u ON u.id = student.id
  WHERE student.role = 'student'::public.user_role
    AND student.is_active = true
    AND u.email_confirmed_at IS NOT NULL
    AND lower(btrim(coalesce(student.email, ''))) = lower(btrim(coalesce(u.email, '')))
    AND i.email = lower(btrim(u.email))
    AND i.status = 'pending'
    AND i.expires_at > now()
    AND p.role = 'teacher'::public.user_role
    AND p.is_active = true
    AND EXISTS (
      SELECT 1 FROM auth.identities ai
      WHERE ai.user_id = u.id AND ai.provider = 'google'
        AND lower(btrim(coalesce(ai.identity_data ->> 'email', ''))) = lower(btrim(u.email))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.teacher_students ts
      WHERE ts.student_id = u.id AND ts.is_active = true
    )
  ORDER BY i.created_at DESC, i.id DESC;
$fn$;
REVOKE ALL ON FUNCTION public.list_my_google_invitation_choices()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_google_invitation_choices()
  TO authenticated;

-- Accepting is an explicit, logged-in student action. The caller never supplies
-- a teacher ID, email, student ID, or auth UUID. All of these are checked in DB.
-- The RPC and its writes execute in a single PostgreSQL transaction.
CREATE OR REPLACE FUNCTION public.accept_my_pending_google_invitation(p_invitation_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_teacher_id uuid;
  v_inv_email text;
  v_status text;
  v_expires_at timestamptz;
  v_accepted_user_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_AUTH_REQUIRED';
  END IF;
  IF p_invitation_id IS NULL THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_NOT_AVAILABLE';
  END IF;

  -- Serialize competing acceptance attempts by the *same* student. The unique
  -- partial index on teacher_students.student_id is a second safety boundary.
  SELECT lower(btrim(u.email)) INTO v_email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = v_user_id
    AND p.role = 'student'::public.user_role
    AND p.is_active = true
    AND u.email_confirmed_at IS NOT NULL
    AND lower(btrim(coalesce(p.email, ''))) = lower(btrim(coalesce(u.email, '')))
  FOR UPDATE OF p;

  IF v_email IS NULL OR v_email = '' OR NOT EXISTS (
    SELECT 1 FROM auth.identities ai
    WHERE ai.user_id = v_user_id
      AND ai.provider = 'google'
      AND lower(btrim(coalesce(ai.identity_data ->> 'email', ''))) = v_email
  ) THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_GOOGLE_IDENTITY_REQUIRED';
  END IF;

  -- The row lock also serializes cancellation with student acceptance.
  SELECT i.teacher_id, i.email, i.status, i.expires_at, i.accepted_user_id
  INTO v_teacher_id, v_inv_email, v_status, v_expires_at, v_accepted_user_id
  FROM crm_private.pending_google_invitations i
  WHERE i.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND OR v_inv_email <> v_email THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_NOT_AVAILABLE';
  END IF;

  -- An exact retry is safe, but only while the original relationship exists.
  IF v_status = 'accepted' AND v_accepted_user_id = v_user_id THEN
    IF EXISTS (
      SELECT 1 FROM public.teacher_students ts
      WHERE ts.teacher_id = v_teacher_id
        AND ts.student_id = v_user_id
        AND ts.is_active = true
    ) THEN
      RETURN v_teacher_id;
    END IF;
    RAISE EXCEPTION 'GOOGLE_INVITATION_RELATIONSHIP_CONFLICT';
  END IF;

  IF v_status <> 'pending' OR v_expires_at <= now() THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_NOT_AVAILABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_teacher_id
      AND p.role = 'teacher'::public.user_role
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_TEACHER_NOT_ACTIVE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.teacher_students ts
    WHERE ts.student_id = v_user_id AND ts.is_active = true
  ) THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_RELATIONSHIP_CONFLICT';
  END IF;

  -- No UPSERT: an unrelated or inactive historical relationship must not be
  -- silently revived or overwritten. A conflict fails the whole transaction.
  BEGIN
    INSERT INTO public.teacher_students (teacher_id, student_id, is_active)
    VALUES (v_teacher_id, v_user_id, true);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'GOOGLE_INVITATION_RELATIONSHIP_CONFLICT';
  END;

  UPDATE crm_private.pending_google_invitations i
  SET status = 'accepted', accepted_at = now(), accepted_user_id = v_user_id,
      updated_at = now()
  WHERE i.id = p_invitation_id AND i.status = 'pending';

  -- Explicit selection of one teacher resolves any competing pending offers
  -- for the same email; other teachers won't keep a non-actionable invite.
  UPDATE crm_private.pending_google_invitations i
  SET status = 'cancelled', updated_at = now()
  WHERE i.email = v_email AND i.id <> p_invitation_id AND i.status = 'pending';

  RETURN v_teacher_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.accept_my_pending_google_invitation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_my_pending_google_invitation(uuid)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
