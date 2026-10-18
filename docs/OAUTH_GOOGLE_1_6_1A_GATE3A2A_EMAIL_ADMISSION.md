# OAuth 1.6.1a / Gate 3a.2-A — server email admission handoff (LOCAL FIRST)

**Scope:** `feature/oauth-google`, no Production changes. This archive is a *patch*,
not a whole-project ZIP. Its paths are relative to `english_classes_vite`.
Gate 2a–2d and Gate 3a.1 must already be installed locally.

## What changed

- `supabase/functions/invite-student/index.ts`: **only the new email/Auth-user
  path** issues `issue_email_invitation_admission` through the service-role
  client, after validating a real teacher JWT and active teacher profile and
  after checking the pre-existing student compatibility path.
- The 73-character server-issued ticket is passed **only** in
  `inviteUserByEmail(..., { data: { crm_email_invite_ticket: ticket } })`.
  No ticket is returned to the app or printed to logs.
- After the Auth request, `revoke_email_invitation_admission` tries to revoke
  any **unused** ticket whether the call succeeded or returned an error.
  If the Hook is ON, it has already atomically **consumed** the ticket, so
  revoke returns `false` (expected). If OFF, revocation closes the unused
  capability (expected). Failed network calls have an *ambiguous* Auth outcome;
  the API returns 502 and does not assume it may delete/reinvite the user.
- Existing profile/link restoration and `google_no_email` are untouched.
  No SQL migration, Auth Hook toggle, `auth.enable_signup` change, or frontend
  change is included in this patch.

**Important limitation:** with the Before User Created Hook OFF, unsolicited
`signUp()` remains possible **locally**, exactly as it was at Gate 3a.1.
*This patch alone does NOT block self-registration.* The missing-token,
wrong-token, replay, expiration and Google negative Auth integration cases
belong to Gate 3a.2-B, AFTER this handoff is proven against real local Auth.
Gate 3a.1 already has separate synthetic SQL tests for these failure cases.

**Metadata hygiene (follow-up):** this Gate 3a.2-A patch intentionally
retains the already revoked ticket in the new Auth user's `user_metadata` long
 enough to prove real Supabase transmission. Even if retrieved, it can never
pass the Hook after being consumed/revoked. In Gate 3a.2-B, after observing
real Hook consumption and verifying account creation, verify a safe
`admin.updateUserById()` scrub that preserves full name and other metadata.
Do not commit a debug bypass or log the actual token.

## Preflight

1. Confirm active Git branch: `git branch --show-current` MUST output
   `feature/oauth-google`. Apply only these three patch files at repository
   root (preserve directory structure). Do not extract over another branch.
2. Docker Desktop/local Supabase already running. Confirm
   `npx supabase status` and `npx supabase migration list --local`.
   **Never** run `db reset` to make this test pass.
3. Check the SQL migration
   `20261012232000_email_invitation_admission_foundation.sql` is applied
   **locally**. The before-user-created Hook must still be OFF in
   `supabase/config.toml`, and the local Auth container must have been started
   with the hook disabled.
4. `git diff -- supabase/config.toml` should be empty at baseline.

## Temporary LOCAL redirect setup (not included in patch)

The existing Edge Function has a fallback to the **Production** URL if
`APP_URL` is absent. For this HTTP test do NOT use the fallback.

In local `supabase/config.toml`, temporarily allow local Vite redirect:

```toml
[auth]
# (leave existing settings unchanged)
additional_redirect_urls = ["https://127.0.0.1:3000", "http://localhost:5173/**"]
```

`additional_redirect_urls` belongs **inside** the existing `[auth]` section;
REPLACE its existing value, do not add a duplicate key. Restart **only local**
Supabase with `npx supabase stop` then `npx supabase start` to reload this
redirect allowlist. This is a *temporary, uncommitted* local modification.
No migration/reset is needed; this stop/start should retain local DB state.

Create a temporary, git-ignored file `supabase/functions/.env.local` containing
only the following value (no service-role credentials):

```dotenv
APP_URL=http://localhost:5173
```

Use this file only while serving the Edge Function locally. The HTTP test
checks that the Mailpit invitation contains a **local** `localhost:5173`
`/set-password` redirect, never the Production domain. The frontend need not
be running just to inspect the message, but it can be running for a manual
click-through after the automated check.

## Run (two PowerShell terminals, repository root)

Terminal A:

```powershell
npx supabase functions serve invite-student --no-verify-jwt --env-file supabase/functions/.env.local
```

`--no-verify-jwt` is **LOCAL-only** for the unauthenticated 401 test. The
function **still** verifies user JWT via `auth.getUser()` and an active teacher
profile. NEVER deploy a Function with disabled JWT verification to Cloud.

Terminal B:

```powershell
$localStatus = npx supabase status -o env
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase status failed' }
$env:CRM_SUPABASE_LOCAL_STATUS = $localStatus -join "`n"
try {
    node scripts/oauth-local-email-admission-http.mjs
}
finally {
    Remove-Item Env:CRM_SUPABASE_LOCAL_STATUS -ErrorAction SilentlyContinue
}
```

**Do not paste `supabase status -o env` to chat**: it contains local keys.
The script refuses Cloud API URLs; confirms exact Docker DB container,
local ports and disabled Hook config; creates unique `@example.invalid`
fixture accounts; calls real Edge Function with a teacher JWT; inspects
Postgres hash, Auth metadata, relationship and Mailpit; and deletes only the
accounts from this run. Mailpit messages remain as test artifacts.

## Automated Gate 3a.2-A assertions

- Unauthorized caller gets 401; student caller 403.
- Google-pending branch creates exactly one pending record, not a new Auth
  user, email ticket or sent email.
- Legacy email invitation (method omitted) creates **one** Auth user,
  student profile, teacher relationship and Mailpit email.
- Real Auth `user_metadata` contains a ticket matching **the hash** stored in
  `crm_private.email_invitation_admissions`; only the hash is stored privately.
- While Hook OFF, the ticket's `revoked_at` is set, `consumed_at` stays NULL,
  and calling the SQL Hook directly with that ticket rejects it (403).
- The HTTP response and invitation email do **not** reveal the admission
  ticket; the email redirect remains local and points to `/set-password`.
- Repeating the invitation reuses the student UUID, sends no extra email,
  and creates no second ticket.

These prove data reaches real Auth and unused permissions are revoked.
They do **not** prove the live Auth Hook will observe and consume the ticket.
That is the next **separately approved** Gate 3a.2-B.

## Regression and checkpoint

```powershell
npx supabase test db --local
node --test tests/*.test.js
npm run check:architecture
npm run lint
npm run build
```

Then **stop local Function serving**, remove temporary
`supabase/functions/.env.local`, restore original `supabase/config.toml`
using Git **only if its diff consists solely of your temporary redirect
change**, and restart local Supabase to restore original Auth configuration.
Run:

```powershell
git status --short
git diff -- supabase/config.toml
git diff -- supabase/functions/invite-student/index.ts
```

Expected tracked changes: only this Edge Function and this new guide/test
script. The Hook stays DISABLED. Do not deploy Edge Functions, migrations,
Google Provider settings or Auth Hooks to Production. Do not merge into `main`.

**Before marking this gate PASS:** share test totals and redacted error output
if relevant, but never Auth tokens, raw admission tickets, Mailpit bodies,
JWTs, or service-role keys. If the Edge Function returns `502` or invitation
fails after a timeout, inspect local `auth.users` and profile state for that
email BEFORE retrying.
