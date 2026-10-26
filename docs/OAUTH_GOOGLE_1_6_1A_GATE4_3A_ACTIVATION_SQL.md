# Gate 4.3-A — Google invitation activation (LOCAL ONLY)

Baseline: `feature/google-oauth-gate4`; Gate 4.2-A was applied locally and 433 SQL assertions passed. Do **not** deploy to linked Production. This is a new migration, not a revision of historical migrations.

## Current real OAuth fixture (LOCAL only)

Gate 4.2-B returned: `auth.users.id = 00af286e-836d-46fb-830d-d28507c5a550`, Google identity present, verified email, CRM role `student`, pending invitation `10726e13-a472-49d1-84b0-93baf300054d`, no active teacher link. Keep this fixture intact for Gate 4.3-B / frontend explicit consent.

## Read-only preflight

Before applying, open **LOCAL** SQL Editor at `http://127.0.0.1:54323` and run:

```sql
SELECT
  u.id,
  u.email_confirmed_at IS NOT NULL AS confirmed_email,
  count(ai.id) FILTER (WHERE ai.provider = 'google') AS google_identities,
  coalesce(bool_or(
    ai.provider = 'google'
    AND lower(btrim(coalesce(ai.identity_data ->> 'email','')))
      = lower(btrim(u.email))
  ), false) AS google_identity_email_matches
FROM auth.users u
LEFT JOIN auth.identities ai ON ai.user_id = u.id
WHERE u.id = '00af286e-836d-46fb-830d-d28507c5a550'::uuid
GROUP BY u.id, u.email, u.email_confirmed_at;
```

Expected: `confirmed_email=true`, `google_identities=1`, `google_identity_email_matches=true`. If the last result is false, stop: adjust assumptions to actual provider schema rather than weakening authorization. Do not share raw identity metadata or secrets.

## Local application

1. Unzip the patch in `D:\Projects\english_classes_vite` preserving paths, while on `feature/google-oauth-gate4`.
2. Check `git status --short`, `npx supabase status` and confirm local API/database are `127.0.0.1:54321/54322`.
3. Apply to **local database only**: `npx supabase migration up --local`.
4. Run all regression tests: `npx supabase test db --local`.

Expected **if there are no other added test files**: 15 test files, 459 assertions (= previous 433 + 26 new tests). The SQL has been reviewed statically but **has not been executed** in the artifact-building environment. Do not claim Gate 4.3-A PASS until local pgTAP confirms it.

## New API contracts

`public.list_my_google_invitation_choices()` returns only signed-in, verified Google user's own actionable invitation(s): `invitation_id`, `teacher_id`, `teacher_name`, `expires_at`. A user with an active teacher relationship gets no choices. The private invitations table remains inaccessible to the browser.

`public.accept_my_pending_google_invitation(p_invitation_id uuid)` is callable **only by authenticated**, and must be initiated by an explicit student click in Gate 4.4. It reads `auth.uid()` rather than accepting a claimed student ID or email. It verifies `auth.users` email confirmation, the `auth.identities` Google provider record and matching identity email, active CRM student profile, and the selected pending invitation with active teacher. It locks the student's profile and invitation, creates one `teacher_students` relation, records acceptance and cancels competing open offers in one DB transaction. Returns the selected teacher UUID; an exact retry is idempotent. No financial data, pre-existing lessons or profile roles are modified.

Failure codes (`P0001`): `GOOGLE_INVITATION_AUTH_REQUIRED`, `GOOGLE_INVITATION_GOOGLE_IDENTITY_REQUIRED`, `GOOGLE_INVITATION_NOT_AVAILABLE`, `GOOGLE_INVITATION_TEACHER_NOT_ACTIVE`, `GOOGLE_INVITATION_RELATIONSHIP_CONFLICT`.

## Boundaries and follow-up

- This patch does not touch `config.toml`, `invite-student`, Auth Hook, Google Cloud settings, frontend, or existing migrations.
- **Do not manually call the acceptance RPC using the live test user's identity in the SQL Editor.** We deliberately preserve the real fixture as `pending` until the UI displays the selected teacher and the user explicitly confirms.
- The new test file works with synthetic Auth users and identities inside a `BEGIN` / `ROLLBACK` pgTAP transaction.
- A true two-session concurrency test (two simultaneous acceptances) and authenticated browser RLS test remain for Gate 4.5.
- Test Google account linking, multi-teacher behavior, expired/revoked invitations, and legacy email signup before enabling in Production.
- If local migration or tests fail, capture **only the failure names and messages**; do not reset DB, delete user `00af…`, force push, or enable this migration in Production.
