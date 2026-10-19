# OAuth Google 1.6.1a — Gate 3a.2-C: Security audit & release readiness

**Scope:** `feature/oauth-google`, LOCAL ONLY. **Do not touch Production** or
merge to `main` for this gate. This is an audit and a supplementary negative
HTTP probe, not an Auth/DB migration, a Google OAuth launch or a new feature.

## Baseline and scope of evidence

- Gate 3a.1 foundation: verified earlier (402 SQL / 90 JS; CI PASS).
- Gate 3a.2-A: 22 local HTTP/Auth/DB/Mailpit checks PASS and CI PASS.
- Gate 3a.2-B: 36 local HTTP/Auth/DB/Mailpit checks PASS, full regressions and
  GitHub Actions PASS. Hook switched OFF in local config after cleanup.
- The Gate C `review` mode is a **static check** of the repository, not proof
  that any production settings match. `probe` verifies two more REAL Auth
  endpoints against the LOCAL Hook; it does not exercise production.

## Audit observations and trust boundaries

| Boundary | Finding | Required handling |
| --- | --- | --- |
| Public email/password `signUp` | Gate B: denied with no valid admission | Preserve real HTTP test as a release gate |
| Default email OTP (`signInWithOtp` with create-user enabled) | Not part of Gate B; test in Gate C | Must not create an Auth user without admission |
| Email invite by trusted teacher | Gate B: one Auth user, student profile and relationship | Retain `inviteUserByEmail` and verify with Hook ON |
| Ticket | Server-issued, hash only in private table; 10-minute validity; consumed once | Never log or return ticket; distinguish `consumed_at` vs `revoked_at` |
| Admin `createUser()` / Dashboard users | Privileged provisioning is **not protected by this Hook** | Protect server secrets, admin roles and provisioning workflows; do not call a 403 from Admin API a security test |
| Google OAuth | Provider OFF; no Google admission in email-only Hook | Do **not** enable provider until separate Google gate |
| Other sign-up modes | Anonymous OFF, SMS sign-up OFF, manual linking OFF in local TOML | Independently verify the actual cloud dashboard state before release |
| Hook failure or availability | Missing/incorrect permission can break new invites | Test real invite immediately after enabling, with a rollback plan |
| Idempotent invitation | Gate B: existing UUID retained | Preserve current business rules |
| Client privileges | Browser must not mint tickets or read private admissions | Check EXECUTE grants and private-schema access before activation |
| Auth metadata | Ticket string cleared after real Hook consumption | Do not confuse `null` key with a live secret; check for absence of usable string |
| Redirect links | Supabase may silently fall back to Site URL if redirect disallowed | Check exact production redirect allowlist and `APP_URL` before release |

References for behavior: https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook ;
https://supabase.com/docs/guides/auth/users ;
https://supabase.com/docs/reference/javascript/auth-signinwithotp ;
https://supabase.com/docs/guides/auth/general-configuration .

## 1. Offline review (Hook OFF)

From `D:\Projects\english_classes_vite` (PowerShell), after restoring Gate B
config and cleanup:

```powershell
git branch --show-current
node scripts/oauth-gate3a2c-local-readiness.mjs review
```

Expect **15 PASS** checks. No Docker, network, credentials or test accounts
are required. The script rejects a wrong branch/project and unapproved changes
in local Auth settings. If it fails, stop and investigate: do not weaken tests
or automatically reset files.

## 2. Supplementary LOCAL-only HTTP probe (Hook ON)

The probe sends ONLY two generated `@example.invalid` addresses to the local
Supabase Auth API: email/password self-signup and OTP/magic-link auto-create.
It is designed to create **zero users, zero profiles and zero admission rows**.
It checks the actual Docker-backed local database after the requests.

1. Temporarily change **only** the commented Hook block in
   `supabase/config.toml` to:

   ```toml
   [auth.hook.before_user_created]
   enabled = true
   uri = "pg-functions://postgres/public/crm_before_user_created_hook"
   ```

   Do not add a duplicate stanza. Keep `[auth].enable_signup = true` and
   `[auth.email].enable_signup = true`. **No redirect URL edits are needed** for
   this probe; no invitation email is being sent.

2. In PowerShell stop any local `functions serve` process, then restart **only
   local** Supabase (no database reset):

   ```powershell
   npx supabase stop
   npx supabase start
   npx supabase status
   ```

3. Run this from the project root:

   ```powershell
   $localStatus = npx supabase status -o env
   if ($LASTEXITCODE -ne 0) { throw 'Local Supabase status failed' }
   $env:CRM_SUPABASE_LOCAL_STATUS = $localStatus -join "`n"
   try {
       node scripts/oauth-gate3a2c-local-readiness.mjs probe
   }
   finally {
       Remove-Item Env:CRM_SUPABASE_LOCAL_STATUS -ErrorAction SilentlyContinue
   }
   ```

   Do not paste `$localStatus` or the key values into a chat, issue, or file.
   The script must report **0 new Auth users, 0 profiles, 0 tickets**.
   Auth's OTP response may be a generic success or a controlled 4xx; the
   decisive criterion is **no account created** plus the separate real
   email/password Hook 403. HTTP 429/5xx is never a PASS.

   If any account is unexpectedly created, the script intentionally **does not
   delete it automatically** so that the local failure can be diagnosed. Do
   not rerun or commit; preserve logs, and provide only the redacted failure
   message. Do not run destructive SQL to "fix" a failed audit.

4. After PASS, restore the Hook block to its originally commented/OFF form.
   Restart local Supabase (`stop`, `start`) without `db reset`.
   Repeat `review` to confirm the repository/config is back to baseline.

## 3. Final regression, Git review and commit (only after all PASS)

```powershell
npx supabase test db --local
node --test tests/*.test.js
npm run check:architecture
npm run lint
npm run build
git diff --check
git diff -- supabase/config.toml
git status --short
```

`git diff -- supabase/config.toml` MUST be empty; do not add TOML, `.env.local`,
credential dumps or fixture files to this commit. Keep the C patch to exactly
these **two new files**:

- `scripts/oauth-gate3a2c-local-readiness.mjs`
- `docs/OAUTH_GOOGLE_1_6_1A_GATE3A2C_SECURITY_READINESS.md`

No SQL migration, Edge Function, frontend or other business code changes are
required by findings so far. Do not commit until the user confirms results.

## 4. Future Production activation plan — NOT part of Gate C

Use a separately approved and scheduled release. Before any production change:

1. Confirm **which migrations already exist remotely** and review the entire
   deployment diff (migration list and dry-run). Make a database backup and
   document an exact recovery/rollback owner. Never use `db reset` remotely.
2. Confirm real Production Auth settings in the Supabase Dashboard: Hook
   currently OFF, email signup ON, SMS signup/anonymous/manual linking OFF,
   Google OFF, trusted administrators and service keys limited. TOML reflects
   LOCAL settings; it is not sufficient evidence of cloud settings.
3. Confirm the deployed `invite-student` revision, `APP_URL`, Site URL,
   allowed redirect URLs, sender and email quota/SMTP capacity. Ensure the
   production hostname is correct. Never use a local-only test fixture or
   `--no-verify-jwt` in Production.
4. Plan the dependency order: database foundation available, the reviewed
   Gate A+B Edge Function deployed, then activate the **Production** Hook
   explicitly. Activating Hook before the updated invitation flow would block
   new invitations. Do not enable Google during this release.
5. During a maintenance/controlled window verify: existing teacher/student
   login, password recovery/set-password, authorized invitation to a
   designated test mailbox, Auth user/profile/relationship exactly once,
   admission `consumed_at` (not `revoked_at`), metadata scrub and email link.
   Check logs without exposing tickets or customer data. Then verify that
   unauthenticated sign-up is denied; use narrowly scoped test accounts only.
6. **Rollback readiness:** if new invitations fail due to the Hook, stop the
   release, preserve evidence and revert the Hook to its known prior OFF state
   under explicit authorization; recognize that this temporarily removes the
   self-registration restriction. Do not drop admission tables, delete real
   users, rewrite applied migrations, or assume a Vercel rollback reverts DB.

**Gate C completion criterion:** REVIEW PASS + PROBE PASS + Hook returned OFF +
full regression and quality checks PASS + no unintended git changes + documented
remaining Production requirements. This certifies only **local readiness**, not
Production deployment approval.
