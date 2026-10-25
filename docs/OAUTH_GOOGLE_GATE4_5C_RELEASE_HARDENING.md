# CRM online lessons — Gate 4.5-C Fix 1: Release hardening

**Prepared:** 2026-10-26. **Scope:** local/repository hardening only. **Production remains unchanged.**

## What the patch changes

1. `.github/workflows/ci.yml`: keeps existing JS suite and also runs `scripts/tests/*.test.mjs`; runs a release-hygiene check. Database-only CI steps use nonfunctional, explicitly dummy Google env values, never real credentials.
2. `tests/pagesRouteBoundary.test.js`: updates the legacy route count from 22 to 24 and checks relative imports in the two new Google pages. Without this change, the existing CI unit-test step would fail after Gate 4 added those routes.
3. `scripts/check-release-hygiene.mjs`: checks tracked/staged filenames for secret files and archives, and checks that both Google OAuth credentials in `supabase/config.toml` use `env()`. It deliberately does **not** read `.env` files.
4. `scripts/tests/releaseHygiene.test.mjs`: unit tests for the release guard.
5. `.gitignore`: explicitly excludes root ZIP/7z/RAR archives and Edge Function `.env` files. Existing dotenv ignore rules remain.
6. `supabase/config.toml`: remains a **local development** config (NOT a Production config). Removes a hardcoded local Google client ID, preserves local Auth callback, adds the tested `/set-password` and `/reset-password` redirects.
7. `.env.example`: documents the local Google client variable names and the distinct Edge Function `APP_URL`.

**Not changed:** database migrations, Auth Hook, Google callback logic, `invite-student` behavior, and Production settings.

## Applying the ZIP safely

The provided files are based on the latest shared full source archive plus Gate 4.5-A Fix 1, the test 16 correction and Gate 4.5-B Fix 2. The user's live Windows working tree was not available for byte-for-byte comparison. **Back up the live `supabase/config.toml` outside the project before replacing it**, then compare any extra local edits with the installed version. This patch carries the three verified local redirect URLs. Do not overwrite any unrelated unshared local settings without reviewing them.

The committed `supabase/config.toml` is intended for the local Supabase stack. **Never** run `supabase config push --linked` using its `127.0.0.1` addresses or development Google client ID. Production settings must be maintained and verified separately.

### Local Google client configuration (required for future local OAuth tests)

Before restarting Supabase after applying this patch, **add** these variable names to the **ignored root `.env`** (not `.env.example`):

```dotenv
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=YOUR_EXISTING_LOCAL_GOOGLE_OAUTH_CLIENT_ID
```

Set the real value privately, copied from the Google Cloud local Web OAuth client or a trusted previous local config backup. **Do not send it or the secret in chat.** Keep the existing `VITE_*` values unchanged. The client secret is still read via `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)`; continue using the established masked PowerShell environment-variable workflow before `supabase start`, or store the secret safely in the ignored root `.env`. No Google client credentials belong in the tracked `config.toml`.

Keep `APP_URL=http://127.0.0.1:3000` in **`supabase/functions/.env`** (ignored by Git); `VITE_APP_URL` in the root `.env` does not set the Edge Function's server-side `APP_URL`.

The current `vite.config.js` still defaults to port **5173**. For the Gate 4 localhost OAuth configuration shown above, start Vite specifically on port **3000** using `npm run dev -- --port 3000`. Do not run two different frontend ports and assume the redirects are interchangeable.

The patch does **not** require `supabase stop`, `supabase start`, or `db reset` just to run Node/ESLint/build checks. Configuration is reloaded the next time the local stack is restarted.

### Commands in the local project root

```powershell
node --test tests/*.test.js
node --test scripts/tests/*.test.mjs
node scripts/check-release-hygiene.mjs
npm run lint
npm run build
npm run check:architecture
npx supabase test db --local
```

Expected: **502 SQL assertions** (17 files) based on the last user-confirmed run; **26 Gate 4/release JS checks** (18 existing plus eight new); the legacy unit suite currently contains **90 checks** (including the updated route-count test). This patch changes no SQL migrations.

`node scripts/check-release-hygiene.mjs` checks **Git-tracked/staged** files, not all ignored files on disk. It is a precommit and CI guard, *not* an archive-creation scrubber. When preparing a ZIP, manually exclude `.git/`, `.env*`, `supabase/.temp/`, `supabase/functions/.env*`, `node_modules/`, `dist/` and credentials. Before staging, review `git status --short`, `git diff --check`, and `git ls-files -o --exclude-standard`. Add only reviewed files by explicit path, not `git add .`.

## Policy: Google identity linking

Local tests confirmed that an existing active student **and** a manually provisioned active test teacher can gain a verified Google identity matching the same email **without changing Auth UUID, role, or related settings**. This is Supabase Auth's automatic identity-linking behavior, not a new user signup; the Before User Created Hook alone does not veto it.

**Recommended initial Production policy (requires explicit owner approval):** allow verified-email Google auto-linking for **existing active teacher and student** accounts; keep invite-only first-time Google student admission and explicit teacher consent. Do not describe the linking of privileged teacher accounts as a second approval mechanism: it is not. If stricter teacher identity linking is desired, implement and test an actual server/Auth-level control before enabling the Production provider; hiding a button is insufficient.

## Production preflight: still NO-GO until separately approved

**No Production commands below should be run just because this file was supplied.** Prior to production changes:

- Obtain a **fresh authoritative local working-tree review**, stage an explicit file list, check `git diff --cached --stat`, and confirm GitHub Actions runs both JS suites, lint/build/architecture and SQL. Do not accidentally commit test ZIPs, observer harness, debug dumps, `.env` files or client secrets.
- Confirm **Production** Supabase Auth Hook remains ON, Google provider stays OFF, current `invite-student` version, local/remote migration history, and a verified recovery/backup plan. Never run `db reset --linked` in Production.
- Production read-only migration preflight commands, **only when ready and explicitly authorized**: `npx supabase migration list --linked` and `npx supabase db push --linked --dry-run`. Verify exactly four Gate 4 migrations are pending in this order:
  - `20261025120000_google_pending_admission.sql`
  - `20261025150000_google_invitation_activation.sql`
  - `20261025180000_google_pending_reinvite_recovery.sql`
  - `20261025200000_google_email_invitation_mode_isolation.sql`
- Confirm actual **Production** Auth Site URL is `https://english-classes-sigma.vercel.app` (or the approved newer deployment hostname), with exact approved app redirect paths `/auth/google/callback`, `/set-password` and `/reset-password`.
- Configure **Production** Google Cloud OAuth Web client with the **Production Supabase Auth** callback URI of the actual linked Supabase project, not the Vite callback URI. Keep Client Secret in the Supabase Auth provider settings, not in Git or Vercel frontend variables.
- Confirm `VITE_GOOGLE_OAUTH_ENABLED=false` on the Vercel Production build until activation is explicitly approved. Verify production-only `VITE_SUPABASE_URL`, public anon/publishable key and `VITE_APP_URL`; no localhost values.
- Establish a working **Production SMTP** sender and test deliverability, invitation and recovery flows with real permitted recipients. Local Mailpit success is insufficient. Last known custom SMTP state is OFF; independently recheck the current Dashboard setting.
- Check that `APP_URL` is set as a **Supabase Edge Function Production secret** to the approved HTTPS frontend origin. Verify the provider-neutral email invitation still works after code deployment.

### Safe deployment ordering (only after a distinct Production GO)

1. Confirm backup, owner, maintenance window, monitoring, production OAuth/provider/UI flags OFF. Apply the **four approved SQL migrations** in order.
2. Deploy the **matching** `supabase/functions/invite-student/index.ts` to Supabase Production with JWT verification ON. The updated Edge Function depends on RPC from the **fourth migration**, so **never deploy this Edge version first**.
3. While Google provider/UI are OFF, retest existing email login and the full real email invitation/recovery paths; inspect Function/Auth logs.
4. Configure Production Google Web OAuth client and Supabase Auth provider settings, then verify callback and redirect allowlists, leaving Vercel Google UI OFF until ready.
5. After explicit GO, enable Vercel `VITE_GOOGLE_OAUTH_ENABLED=true` and deploy. Smoke-test invite-only Google new student, no-invite denial, cancel/reinvite, existing active email student/teacher identity linking, and legacy email flows.
6. Monitor provider and Function errors, invitations and role/link audit results; do not infer Production success from local PASS alone.

### Containment / rollback

In an issue, first stop new Google onboarding, disable the feature flag (redeploy as required) and disable the Google Auth provider; check the already-issued sessions and JWT expiry/revocation separately. **Disabling Google UI/provider does not instantly revoke existing sessions.** Keep the SQL schema and existing identity links intact while investigating. Avoid blindly reversing migrations or deleting Auth users.

## Source of truth

- Supabase local OAuth configuration: https://supabase.com/docs/guides/local-development/managing-config
- Supabase OAuth identity linking: https://supabase.com/docs/guides/auth/auth-identity-linking
- Supabase redirects: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase local Edge secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase CLI operations: https://supabase.com/docs/guides/local-development/cli-workflows
