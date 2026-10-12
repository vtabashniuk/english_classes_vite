# CRM — Google OAuth 1.6.1a / Gate 2c: invite-student server branch

## Scope

The existing `invite-student` Edge Function supports an additional **explicit** mode in its JSON body:

```json
{"email":"student@example.com","fullName":"Student Example","invitationMethod":"google_no_email"}
```

It does NOT send email, call `inviteUserByEmail`, create an Auth user, create a profile or a teacher-student relationship, or grant access. It calls the Gate 2b `create_pending_google_invitation` RPC, passing `p_teacher_id` **only from the server-verified access token**. The database stores a private, expiring pending invitation. The response returns `pendingActivation: true`, `emailSent: false` and the invitation UUID.

An omitted `invitationMethod` retains the **unchanged** legacy email/password path. The explicit `"email_password"` value does the same. Malformed/unknown values return HTTP 400; the function never silently converts an invalid explicit mode to an email invitation.

Example of a successful Google-pending result:

```json
{"success":true,"email":"student@example.com","invitationId":"...","invitationMethod":"google_no_email","pendingActivation":true,"emailSent":false}
```

This branch is **server-only**. There is no frontend mode switch, Google provider, OAuth callback, automatic student activation, or public registration gate in Gate 2c. Teachers cannot yet select the mode in the UI. The existing email invite UI and success toast are unaffected.

### Security boundaries

- A valid teacher JWT, active teacher `profiles` row, and service-role RPC call are all required.
- No caller-provided teacher ID is ever accepted.
- The private table and the invitation-create RPC remain unavailable to `anon` and `authenticated` database roles.
- Conflicting existing account and invalid input errors are mapped to controlled responses; raw unexpected DB failures are not disclosed to the caller.
- Pending invitation by itself **must never allow public email signup**. Actual user creation requires a later verified Google OAuth event + server-side admission control + explicit relationship-activation checks.
- A Google invitation for an email already present in Auth/CRM is rejected; user-confirmed linking is a different future flow.
- The existing Supabase email invitation path is intentionally kept as-is (no regression in reminder or invitation toast assumptions).

## Local verification and commit policy

Do not alter `supabase/config.toml` for this gate. Keep the observational Gate 1 hook disabled.

1. Extract the ZIP into the root of the `feature/oauth-google` working tree.
2. Run:

   ```powershell
   node --test tests/*.test.js
   npx supabase test db --local
   npm run check:architecture
   npm run lint
   npm run build
   git status -sb
   ```

   Expected **90 JS** (= 84 + 6) and **371 SQL** tests. In particular, SQL tests confirm that only `service_role` can create a pending invitation and teachers cannot directly write to its table.

3. **A passing JS suite verifies the request mode parser, not the actual Edge Function.** Before deploying `invite-student`, a separate local HTTP integration check must authenticate a real local teacher and exercise both branches. Expected: Google branch returns an invitation UUID without creating an Auth user or sending a Mailpit message; the legacy branch still creates exactly one invited Auth user, and a non-teacher request fails with 403. This live Edge Function test is deferred to the next checkpoint, not assumed to have passed.
4. Do **not** deploy this Edge Function by itself to Production: its Google branch references the Gate 2b database RPC, which is not yet deployed in Cloud. Deployment order and a secured authentication gate are required. Never use `db reset`, `db push --linked` or a Production secret to test this gate.
5. Do not commit local Hook observer scripts or temporary `config.toml` changes. Inspect `git diff --cached --stat` before committing.

## Follow-up (not implemented here)

1. Local Edge Function HTTP integration tests and mode error handling (Gate 2c control).
2. Server-side Auth admission based on verified Google sign-in, not user-provided metadata, to reject unauthorised signups (Gate 2d).
3. Atomic promotion of an authenticated, admitted user into `profiles` + `teacher_students`, with idempotence, expiry/revocation and conflicting-teacher protection.
4. Teacher UI mode selector with localized feedback, pending invitations list/cancellation, OAuth login & callback and user-confirmed linking to additional teachers.
