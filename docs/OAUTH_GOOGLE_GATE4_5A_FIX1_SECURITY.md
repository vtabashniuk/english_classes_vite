# Gate 4.5-A Fix 1 — local-only security and recovery patch

**Baseline:** `english_classes_vite(3).zip` supplied for Gate 4.5-A. No existing migration is edited.

## Scope

1. **P1 — Google student re-invitation:** new migration `20261025180000_google_pending_reinvite_recovery.sql` changes ONLY the trusted `create_pending_google_invitation` service-role RPC. It allows renewal of an expired pending invitation, or a new invitation after cancellation, when the existing Auth user is a confirmed, active, *unlinked* Google student with an exact matching verified provider identity and profile email. It does not create or attach a student and preserves Auth UUID. Email-only, inactive, unconfirmed, teacher and linked users are rejected. An existing teacher link *even if inactive* or an already accepted Google invitation precludes this recovery path. Accepting still requires the student's explicit action.
2. **P3 — Callback isolation:** `/auth/callback` no longer exchanges arbitrary `code` values or grants `invite` on successful exchange. It only honors an earlier validated implicit `type=invite` Auth event. `/reset-password` no longer grants `recovery` after code exchange alone; only a verified Supabase `PASSWORD_RECOVERY` event grants it. These are fail-closed changes; **test real recovery emails before accepting this patch** (PKCE vs implicit event behavior can vary by flow).
3. **P4 — Student route:** a direct visit to `/student-area` by a Google student without an active teacher link now redirects to invitation consent. Normal linked Google students and ordinary email students are not blocked by the Google gate. The data protection boundary remains server-side RLS/RPC.
4. **P5 — Session races:** the auth context discards profile query results from old Auth sessions and never surfaces a profile under the wrong user ID. Protected routes also require matching profile UUID.

## Explicitly not resolved by this patch

- **P2 identity linking policy:** Supabase automatically links Google to an existing verified email account. `Before User Created Hook` does NOT block such linking. Until verified with a real existing teacher and an email student, Google in Production remains **OFF**. Provisional implementation accepts linked users with unchanged UUID/role; business permission to enable that behavior must be confirmed before production.
- **P6 config:** The supplied tracked `supabase/config.toml` still contains *LOCAL* Google client and redirect settings; this patch intentionally does not change them during local OAuth regression. Do NOT deploy or push that configuration as cloud-ready. Normalize it separately in Production readiness. Never store the Google client secret in the repository.
- **P7 archive hygiene:** exclude `.git/`, `supabase/.temp/`, all `.env*` except `.env.example`, `node_modules/`, `dist/`, OAuth credentials, old ZIPs and backups from the *next* source archive.

## Apply and verify (PowerShell in `D:\Projects\english_classes_vite`)

1. Unzip at project root with original paths, overwriting only the supplied changed files.
2. Confirm `git branch --show-current` is `feature/google-oauth-gate4`.
3. Apply **LOCAL** SQL only:

   ```powershell
   npx supabase migration up --local
   npx supabase test db --local
   ```

   Expected test count **475** if the prior baseline remains exactly 459 tests plus 16 new pgTAP assertions. The result is **not verified here**; the new migration has not run against your Docker database.
4. Check frontend and architecture:

   ```powershell
   node --test scripts/tests/googleOauthGate45Safety.test.mjs
   node --test scripts/tests/googleOAuthPolicy.test.mjs
   node --test scripts/tests/studentInvitationMethod.test.mjs
   npm run lint
   npm run build
   npm run check:architecture
   ```

5. **Browser regression, in an isolated LOCAL environment**:
   - Renew expired pending invitation **after** Google Auth user exists but before acceptance. Confirm same UUID, renewed expiration, successful consent, exactly one link.
   - Cancel before consent, re-invite same confirmed unlinked Google email, consent successfully. Do not reuse an account that already accepted its invitation.
   - Email-only existing student, linked student, teacher and inactive profile must be denied by Google re-invite path.
   - Unlinked Google student navigating directly to `/student-area` must reach `/google/accept-invitation`; after acceptance, the dashboard works.
   - Switch between different signed-in accounts in the same browser: no old profile or wrong dashboard should be displayed.
   - **Mandatory**: email invite from Mailpit in a fresh InPrivate window -> `/set-password` -> set password -> login; reset-password email in a fresh session -> `/reset-password` -> change password; misdirected Google `code` to `/auth/callback` must **not** grant password setup; opening email invite when another user is already signed in must not grant the wrong user access.
   - Test existing email-student and teacher Google identity linking, preserving UUID and roles; no Production enablement until explicit policy/verification.

## Stop conditions

- Any SQL test error or email invite/reset regression means **NO-GO**. Do not deploy migrations or flip Google Provider in Production.
- Never run `npx supabase db push --linked`, `db reset`, or deploy Edge Functions for this gate.
- Restore/review tracked config and perform cloud readiness separately, after Gate 4.5-B.

## Local verification performed while authoring

- 18/18 Node tests passed (existing 11 + new 7).
- Architecture boundary check passed.
- TypeScript parser accepted the modified JavaScript/JSX syntax.
- **Not run here:** Docker/PostgreSQL tests, full ESLint or Vite build (npm offline cache incomplete), real browser OAuth/email flows.
