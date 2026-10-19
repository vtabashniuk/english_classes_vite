# CRM OAuth 1.6.1a — Gate 2a: hardened Auth profile role

## Evidence (Gate 0 and Gate 1)

- `auth.admin.inviteUserByEmail` and public `signUp` were both observed in the
  Before User Created Hook with `app_provider = email`, no `invited_at` and no
  trustworthy source marker.
- `user_metadata.role` is explicitly user-controlled: Gate 0 demonstrated a
  forged teacher profile. Gate 1 confirmed the hook payload cannot distinguish
  these flows by the examined fields.
- Therefore never use `user_metadata.role`, a supplied `invitation_id`, or a
  plain role field as proof of privileged authorization.

## This change (safe, narrow and reversible via another migration)

1. New SQL migration updates `handle_new_user()` to **always start with the
   non-privileged `student` role** for any *new* Auth user; existing profiles
   are untouched. The full name and email behavior remains unchanged.
2. Nine local pgTAP files now provision *synthetic test teachers* explicitly
   with a privileged `UPDATE public.profiles`, rather than depending on forged
   metadata. Their production behavior and RLS assertions do not change.
3. One new regression file (10 assertions) proves that untrusted `teacher` or
   invalid role metadata cannot raise privileges and that the existing student
   invitation defaults still work.
4. This does **not yet block all public signups**, nor does it implement the
   pending Google invitation or an administrative teacher onboarding flow.
   Next phase: restricted pending invitation database, proof-based admin email
   invitation, and a server-verified Google-first Auth Hook. No OAuth provider
   or browser UI is activated by this step.

## Apply to LOCAL ONLY

1. First remove Gate 1 diagnostic hook. Keep a backup if config.toml had any
   user edits. Then (assuming no pre-existing uncommitted config changes):

   ```powershell
   git restore -- supabase/config.toml
   npx supabase stop
   npx supabase start
   node scripts/oauth-local-hook-observer.mjs cleanup
   ```

2. Unzip this archive **over** the current repository in
   `feature/oauth-google`. Do NOT run `db reset` and do NOT push to Cloud.
3. Apply the pending new migration to the existing LOCAL database using
   `npx supabase migration up --local` (do NOT use `--linked`).
   Inspect `npx supabase migration list --local` first to confirm the current
   local migrations are all installed. Do NOT use `db reset` or manually run
   this migration in Studio; it must be tracked in local migration history.
4. Execute `npx supabase test db --local`, `node --test tests/*.test.js`,
   `npm run check:architecture`, `npm run lint`, `npm run build`.
5. Expected **345 SQL** (= 335 + 10), **84 JS**. Confirm actual output.
6. Do **NOT** commit or push until checks pass, and do not deploy this migration
   to Production before we audit whether any other privileged teacher-creation
   flows rely on user metadata and complete the rollout checklist.

## Rollout safety

- No Production change is authorized in this Gate.
- Leaving the observer hooked during tests changes Auth behavior; clean it up
  first and verify `git diff -- supabase/config.toml` shows no changes.
- Existing teacher profiles do not lose their role (UPDATE applies only to new
  Auth users in `handle_new_user`).
- Future teacher provisioning must use an explicitly privileged server process,
  not client `signUp` metadata. Do not reintroduce the old cast.
