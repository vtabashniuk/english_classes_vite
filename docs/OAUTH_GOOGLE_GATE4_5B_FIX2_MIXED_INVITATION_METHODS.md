# Gate 4.5-B Fix 2 — Google/email invitation-method isolation

**Local-only patch; do not deploy to Production.** Based on the user's mixed-method browser test and the current Gate 4.5 Fix 1 codebase.

## Confirmed problem

A pending Google invitation creates no `teacher_students` link before the student's consent. After the invited user signs in with Google and has an Auth/profile but hasn't accepted the invitation, the legacy `invite-student` **Email + password** existing-user branch could immediately create/restore a teacher-student link by matching email. The user then landed in the student dashboard after refreshing the Google acceptance page, while the private pending invitation remained `pending` and was still shown to the teacher. This bypassed the intended explicit Google-acceptance workflow. The student's identity did not necessarily change; account takeover was not demonstrated.

## Patch (4 files)

1. `supabase/migrations/20261025200000_google_email_invitation_mode_isolation.sql`:
   - Automatically cancels historical, **still pending** Google offers when the matching student already has an **active** teacher relationship. Preserves all rows, accepted history, auth users, passwords, payments and student profiles.
   - Hides non-actionable offers from `list_my_pending_google_invitations` as a second safety boundary.
   - Rejects new email admission tickets if a live Google offer already exists.
   - Rechecks the same condition at `crm_before_user_created_hook` for a Google offer that appeared after an email ticket was issued.
   - Adds `link_existing_student_email_invitation` (service-role only): uses a student-profile row lock; preserves legacy existing email-account idempotency/reactivation and refusal to move students from other teachers. Refuses email activation of unlinked Google identities, and any active pending Google offer until it is resolved.
2. `supabase/functions/invite-student/index.ts`: replaces direct existing-student link insert/update with guarded SQL RPC; adds readable HTTP 409 errors for incompatible invitation methods. Fresh email invitation and Google creation flow remain intact.
3. `supabase/tests/database/17_google_email_invitation_mode_isolation.sql`: 27 local pgTAP checks; rollback-only.
4. This document.

## Apply and verify

Extract the patch into project root, preserving relative paths. Do **not** overwrite `.env`, `.env.local` or `supabase/config.toml`.

```powershell
npx supabase migration up --local
npx supabase test db --local
node --test scripts/tests/googleOauthGate45Safety.test.mjs
node --test scripts/tests/googleOAuthPolicy.test.mjs
node --test scripts/tests/studentInvitationMethod.test.mjs
npm run lint
npm run build
npm run check:architecture
```

**Expected if all tests pass:** 17 SQL files and 502 pgTAP assertions (475 prior + 27 new). Not yet verified in a live local database; a PASS must come from the user's test run.

Restart local Supabase Edge Functions / `supabase functions serve` if running separately, to load the revised `invite-student`. Preserve local Google Client Secret during restarts; do not expose it in logs or archives.

### Browser regression after static tests

1. Reopen the teacher's student list; an already-activated Google student must **not** also have an actionable pending offer. Inspect the DB row if needed: it should have `status = cancelled`, not be deleted.
2. Create a **new** pending Google invitation for a fresh email, then attempt **Email + password** to the same address before Google first sign-in: request must fail with a clear 409; no email Auth user is created.
3. Sign in with Google using the same new test account, **do not accept** the teacher; attempt **Email + password** again: request must fail, UUID and teacher links remain unchanged. Explicit acceptance in the Google UI must work.
4. Check ordinary email invitation/new password and existing email-account idempotent/recovery flows to guard against regressions.

Use distinct test emails; do not remove auth users or reset the database. Current Production remains unchanged.

## Still open

Supabase automatic identity linking for *already existing* email accounts (Gate 4.5-A P2) remains a separate access-policy/security item. Mixed invitation protection does not determine the intended policy for teachers or previously activated email users who sign in with Google. Concurrent different-method invitation creation across separate HTTP requests is also not fully proven by the sequential pgTAP tests; evaluate under the final production readiness review.
