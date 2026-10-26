# Gate 4.4-B — Google invitations in Teacher > Students (local-only)

## Scope

Frontend only: switch between existing `email_password` invitation and `google_no_email`, display teacher's own pending Google invitations, cancel pending invitation after confirmation. No migrations, Edge Function deployments or Production changes. Google controls are hidden unless `VITE_GOOGLE_OAUTH_ENABLED=true`.

The existing email mode is selected by default and sends the **same request body** as before (`{email, fullName}`), preserving email invitation compatibility. Google sends an explicit `invitationMethod: "google_no_email"`. The Edge Function and SQL RPCs already exist from previous gates.

An invitation does **not** send an email or create `auth.users`/`profiles`/`teacher_students` before first Google sign-in. Google pending invitations appear in their own section, not in the student roster. The existing accepted users remain regular students.

## Local verification (do not modify Production)

1. Extract ZIP into repository root, keeping paths. Do **not** replace `.env.local` or `supabase/config.toml`.
2. Confirm Git branch is `feature/google-oauth-gate4` and local Supabase is running with Gate 4.2/4.3 migrations, Google Provider and CRM Hook locally ON.
3. Run:

   ```powershell
   node --test scripts/tests/studentInvitationMethod.test.mjs
   node --test scripts/tests/googleOAuthPolicy.test.mjs
   npm run lint
   npm run build
   npm run check:architecture
   ```

4. Start the local CRM at `http://127.0.0.1:3000` with `.env.local` using local Supabase URL, publishable key and `VITE_GOOGLE_OAUTH_ENABLED=true`.
5. Sign in as the **teacher**, navigate to **Students**, open the invite form:
   - Email+password remains preselected; send a controlled email test and verify the existing flow remains unchanged.
   - Choose Google (no email), enter a **new test Google address** not already registered, submit. Expect pending list entry and no email, no student roster entry before first sign-in.
   - Refresh the page; pending invitation should persist.
   - Create a second Google invitation, cancel it after confirmation, refresh; it must be absent.
   - For a separate pending test invitation, sign in as the invited Google user and accept the teacher explicitly. Refresh teacher page; the pending invitation must disappear and the student must appear in the active student roster.
6. Repeat the invite/cancel UI checks in UA/RU/EN, including a narrow browser viewport.
7. Set `VITE_GOOGLE_OAUTH_ENABLED=false`, restart Vite and verify Google invitation controls disappear and legacy email invitation remains usable.

## Regression/security checks

- Teacher-list and cancel RPCs take identity exclusively from `auth.uid()`; browser does not send teacher ID, and cannot query `crm_private` directly.
- Cancelling a pending invitation invalidates first-time admission and acceptance, but does not delete existing users or links.
- Existing email/password invitation and `/auth/callback`, `/set-password`, `/reset-password` must remain unchanged.
- Do not interpret successful frontend compilation as Production readiness. Gate 4.5 security/regression and Gate 4.6 Production go/no-go remain pending.

## Deployment scope

This ZIP contains only changed/new frontend, language, test and documentation files. No secrets, generated builds, migrations, or linked-cloud changes.
