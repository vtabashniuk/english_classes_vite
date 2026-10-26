# CRM Google OAuth — Gate 4.2-A: LOCAL Google Admission SQL

**Status:** candidate for local testing, NOT approved for Production.

## Baseline and scope

- Based on `english_classes_vite(2).zip` supplied for the Gate 4 audit, after Gates 0–3b (`main` at `fdc8bc7` as reported by the user).
- The user's local `package-lock.json` was updated for Supabase CLI. This patch does **not** include or replace it.
- Gate 4.1 completed: a REAL Google OAuth attempt reached the local Before User Created Hook with `app_metadata.provider=google`, `app_metadata.providers` present, `user_metadata.email_verified` present, `identities=[]`, `is_anonymous` present. **The values of `email_verified` and `is_anonymous` were not logged**, and positive Google admission is NOT yet proven.
- The Gate 4.1 observer was removed. The repository `supabase/config.toml` has no active Before User Created Hook; that is the safe baseline before this migration.
- Production Supabase Auth Hook is ON, but **do not deploy** this migration to Production.

## Changes in ZIP (2 SQL files + this document)

1. `supabase/migrations/20261025120000_google_pending_admission.sql`: replaces the preexisting `public.crm_before_user_created_hook(jsonb)` with the same email-ticket branch plus a guarded Google branch. It does **not** enable local Auth Hook, Google Provider, or any frontend UI.
2. `supabase/tests/database/14_google_pending_admission.sql`: 31 isolated pgTAP assertions inside a transaction that is rolled back. Exercises allowed invitation, no invitation, expired/cancelled, inactive teacher, unverified email, wrong provider, existing user, and multi-teacher pending invitations.

## Trust and admission contract

Supabase Auth validates the Google OAuth flow and supplies `user.app_metadata.provider` and `providers` in the Before User Created event. The hook requires those **server-generated fields**, a `user_metadata.email_verified` **boolean true as an additional check** (never independently sufficient), and `is_anonymous=false`. Admission also requires one active teacher's unexpired pending invitation matching normalized `user.email`, and no existing matching account/profile.

The hook must NOT rely on `identities[0]` (absent during initial Auth creation), accept a forged `user_metadata.provider`, or trust `user_metadata.role`. The SQL never sets `accepted_at`/`accepted_user_id`, does not create `teacher_students`, and does not mark the Google invitation consumed. Those responsibilities belong to Gate 4.3 with authenticated, explicit student consent.

**Caveat:** No accepted real Google signup has been observed yet. If GoTrue emits a different boolean format for `email_verified` or `is_anonymous`, Gate 4.2-B must fail closed; inspect only sanitized metadata/shape and revise after a controlled LOCAL test. Synthetic SQL tests alone cannot validate Google OAuth identity assurance or automatic linking of preexisting email accounts.

## Safety rules

- Work only on `feature/google-oauth-gate4`.
- Do not use `supabase db reset`, `supabase db push`, `supabase db push --linked`, `supabase migration up --linked`, `functions deploy`, or Production dashboard Auth settings.
- **Always** include `--local` for migration commands. The CLI is linked to Production, but `--local` explicitly targets the Docker database.
- Keep `[auth.hook.before_user_created]` commented out in `supabase/config.toml` for this Gate 4.2-A SQL phase. No need to configure Google Client Secret again.
- No secrets, personal email addresses, or genuine user records belong in fixtures/logs.
- After migration the local SQL function changes; it is *inert* until the local Hook is explicitly enabled in a separate controlled step.

## Local procedure (PowerShell, repository root)

```powershell
cd D:\Projects\english_classes_vite
git branch --show-current
git status --short
npx supabase status

# Copy this ZIP into the project root, preserving relative paths.
# Confirm exactly one new migration and new test, and Hook not active:
Test-Path supabase/migrations/20261025120000_google_pending_admission.sql
Test-Path supabase/tests/database/14_google_pending_admission.sql
Select-String -Path supabase/config.toml -Pattern '^\s*\[auth\.hook\.before_user_created\]'

# Apply ONLY missing migration(s) to LOCAL Docker Postgres:
npx supabase migration up --local

# All SQL security/regression suites, including file 14:
npx supabase test db --local
```

Expected: `migration up --local` applies the new file and the full SQL test suite passes, including **31/31** assertions in suite 14. This expectation is **not** a claim of test execution by the patch author: no local Docker/Postgres environment was available when generating this ZIP.

If any command reports a failure, stop. Send the specific error and failing test numbers. Do NOT enable the Hook or Google Provider until SQL suite and real local OAuth control are reviewed.

## Gate 4.2-B (not included here)

Controlled positive and negative HTTP Google OAuth with a synthetic teacher/invitation, while original email invitation/recovery path is regression-tested. Validate the real `email_verified` boolean value and original Auth UUID behavior. In particular, auto-linking to existing accounts is NOT checked by the Before User Created Hook and needs separate policy/tests before production rollout.

## Diff/commit policy

- New SQL migration + test + document only. Do not edit previously applied migrations.
- Keep intentionally upgraded `package-lock.json` separate; do not overwrite it with archived contents.
- Do not include temporary `supabase/snippets/`, OAuth secrets, `.env.local`, or Docker data in Git or ZIP.
- Wait for the local migration and pgTAP results before marking Gate 4.2-A complete or committing/deploying this patch.
