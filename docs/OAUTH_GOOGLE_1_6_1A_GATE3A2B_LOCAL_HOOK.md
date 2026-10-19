# OAuth Google 1.6.1a — Gate 3a.2-B: real local Auth Hook (LOCAL ONLY)

**Prerequisites:** `feature/oauth-google`; Gate 3a.2-A committed, all quality
checks green. No changes to Supabase Production. ZIP contains ONLY changed/new
files; copy relative paths into the repository root.

This step verifies that Supabase Auth **really invokes** the existing
`public.crm_before_user_created_hook(event jsonb)` before creating an account.
We keep `auth.enable_signup = true` to prove rejection is due to the Hook,
**not** due to globally disabled signup. The email invitation remains functional.

Changes: the Edge Function scrubs `crm_email_invite_ticket` to `null` **after**
a successful invited Auth creation + teacher/student link, but only when
`revoke_email_invitation_admission` confirms the Hook already consumed it.
This explicitly preserves Gate 3a.2-A Hook-OFF expectations. The existing SQL
migration/function **is unchanged**; no new SQL migration is needed.

## Gate 3a.2-B test correction — admin API is NOT a Hook test

The first local VERIFY run reached 19 PASS checks, then failed at `Ticket for a
DIFFERENT email`. The old test used `auth.admin.createUser()` to assert a 403.
**That expectation was invalid:** trusted service-role `admin.createUser()`
performs privileged user provisioning and does not invoke the Before User
Created Hook. It can succeed for a mismatched ticket, but this is **not** an
untrusted browser signup bypass. The failed run may have inserted a synthetic
`wrong-email` Auth account. No application SQL or Edge Function change is
indicated by this failure.

The revised test now:

- exercises wrong-email, expired, revoked and replay attempts through public
  `auth.signUp()` (the actual untrusted Auth path, which invokes the Hook);
- consumes the replay fixture's valid ticket using real server-side
  `auth.admin.inviteUserByEmail()` (which invokes the Hook), then deletes that
  disposable account and verifies public signup cannot reuse the ticket;
- explicitly verifies that cleanup removes every synthetic Auth account,
  including one created by the old invalid admin test.

**If the previous VERIFY failed on this exact scenario, do not rerun VERIFY
immediately using the existing fixture.** After replacing the test script,
execute the cleanup below with Hook still ON, then restore Hook OFF, restart
local Supabase, run PREPARE again and finally enable Hook ON and rerun VERIFY.
No database reset or Production change is needed.

## Critical guards

- **Never** run `supabase db reset`, `db push --linked`, `functions deploy`,
  `supabase secrets set` or Production dashboard Auth changes for this gate.
- Always remain on `feature/oauth-google`, with Docker and LOCAL Supabase.
- `supabase/config.toml` edits are **temporary and must NOT be committed**.
- Stop the Edge Function terminal before restarting local Supabase; restart
  `functions serve` after local Supabase is running.
- `supabase/functions/.env.local` must contain `APP_URL=http://localhost:5173`.
  This file is git-ignored. Never let the fallback Production APP_URL be used.
- The script checks `project_id = "english_classes_vite"`, the matching folder
  name, exact local API/DB ports and DB container, and LOCAL status keys.
- Credentials are not printed. The `prepare` mode stores ONLY disposable
  synthetic test-account passwords in a state file in Windows `%TEMP%`.
  The `cleanup` mode deletes the state file. No service-role key or real user
  data is stored there.
- The test generates only randomized `@example.invalid` fixture emails and
  deletes only those. Mailpit test messages may persist. No production links
  or user accounts are contacted.

## 1. Preparation with Auth Hook OFF

Make sure the original `[auth.hook.before_user_created]` is commented in
`supabase/config.toml` and local Supabase is actually running with Hook OFF.
If local config had already been edited, restart local Supabase before this.
Do NOT disable `[auth].enable_signup` or `[auth.email].enable_signup`.

In PowerShell **Terminal B** from `D:\Projects\english_classes_vite`:

```powershell

git branch --show-current
npx supabase status
$localStatus = npx supabase status -o env
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase status failed' }
$env:CRM_SUPABASE_LOCAL_STATUS = $localStatus -join "`n"
try {
    node scripts/oauth-local-email-admission-hook-http.mjs prepare
}
finally {
    Remove-Item Env:CRM_SUPABASE_LOCAL_STATUS -ErrorAction SilentlyContinue
}
```

Expect 2 positive preparation checks. `prepare` creates exactly one synthetic
teacher and one synthetic access-control student BEFORE Hook activation. Do
NOT rerun `prepare` before `cleanup` or manually delete the temp state file.
If preparation fails, inspect the error then use `cleanup` as instructed below.

## 2. Temporarily configure LOCAL Auth Hook

Change **only** these two existing places in `supabase/config.toml`:

1. In the existing `[auth]` section, **REPLACE** the one existing key
   `additional_redirect_urls = ["https://127.0.0.1:3000"]` with:

```toml
additional_redirect_urls = ["https://127.0.0.1:3000", "http://localhost:5173/**"]
```

   Never add a second `additional_redirect_urls` key: TOML would fail to parse.

2. Uncomment the existing Before User Created Hook block and set the URI to
   the actual already-migrated SQL function:

```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/crm_before_user_created_hook"
```

**IMPORTANT:** do not use the generic commented template URI
`pg-functions://postgres/auth/before-user-created-hook`. Keep general
`[auth].enable_signup = true` and `[auth.email].enable_signup = true`.

Stop **Terminal A** (Edge Function) with Ctrl+C. In Terminal B:

```powershell
npx supabase stop
npx supabase start
npx supabase status
```

This restarts ONLY local Docker-backed Supabase without wiping the database.
**Do not execute `db reset`.** If startup fails, do not bypass Hook or deploy;
check local Auth container logs and permissions.

Validate the config has exactly one redirect key:

```powershell
Select-String -Path .\supabase\config.toml -Pattern '^\s*additional_redirect_urls\s*='
```

Terminal A (after Supabase startup):

```powershell
npx supabase functions serve invite-student --no-verify-jwt --env-file supabase/functions/.env.local
```

`--no-verify-jwt` is for the **LOCAL** 401 test only. The Edge Function itself
checks JWT via `auth.getUser()` and validates an active teacher profile.
Do not deploy this bypass setting.

## 3. Test the ACTUAL Hook ON path

Terminal B:

```powershell
$localStatus = npx supabase status -o env
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase status failed' }
$env:CRM_SUPABASE_LOCAL_STATUS = $localStatus -join "`n"
try {
    node scripts/oauth-local-email-admission-hook-http.mjs verify
}
finally {
    Remove-Item Env:CRM_SUPABASE_LOCAL_STATUS -ErrorAction SilentlyContinue
}
```

The script checks local permissions, existing-user login, missing/forged
`signUp`, unauthorized callers, *actual* teacher `inviteUserByEmail`, one Auth
user/profile/link, one Mailpit email, one **consumed** (not revoked) admission,
removal of the **token value** from `auth.users.raw_user_meta_data`, retention
of `full_name` and `role`, idempotent invite, wrong-email/expired/revoked/reused
tokens against the public `signUp` Auth endpoint, Google-pending isolation, and inactive-teacher
protection. These tests NEVER require a live Google OAuth provider.

A token key with JSON `null` may remain in metadata after sanitization;
**there must be no 73-character usable string**. If metadata scrubbing fails
or GoTrue does not honor null overwrite, the test **fails** and further
implementation is required before committing. No direct SQL update of
`auth.users` is introduced into application code.

**Stop condition:** an observed `signUp()` rejection with HTTP 429 or 500 is
NOT a PASS for Hook enforcement. The script requires the Hook's HTTP 403,
plus a separate successful ticket consumption. Any unexpected status or
`Auth Hook error` is a failure to investigate. In particular, an apparently
successful invitation with `revoked_at` rather than `consumed_at` is NOT PASS.

## 4. Cleanup while Hook is ON

After `verify` succeeds, or after inspecting a failure, run:

```powershell
$localStatus = npx supabase status -o env
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase status failed' }
$env:CRM_SUPABASE_LOCAL_STATUS = $localStatus -join "`n"
try {
    node scripts/oauth-local-email-admission-hook-http.mjs cleanup
}
finally {
    Remove-Item Env:CRM_SUPABASE_LOCAL_STATUS -ErrorAction SilentlyContinue
}
```

This deletes only synthetic accounts from this run, including a possible
`wrong-email` Auth account created by the earlier invalid admin test. The
test verifies that all fixture Auth accounts are gone; its private admission
records cascade when its disposable teacher profile is removed.
Do **not** manually remove `%TEMP%` fixture state before running cleanup.

## 5. Restore LOCAL config and run regression

Stop Terminal A with Ctrl+C, restore **only** the two temporary TOML changes:

- Restore the previous single `[auth].additional_redirect_urls` value.
- Restore the Before User Created Hook block to commented/disabled state.

If `git diff -- supabase/config.toml` shows any other changes, inspect them
rather than resetting indiscriminately. Restart local Supabase:

```powershell
npx supabase stop
npx supabase start
npx supabase status
```

Verify `git diff -- supabase/config.toml` is empty. Optionally rerun the old
Gate 3a.2-A HTTP test after `functions serve`: Hook OFF still stores a **revoked**
ticket in metadata for its historical inspection, so its expectations remain
unchanged. It MUST NOT be run while Hook is ON.

Regressions and Git review:

```powershell
npx supabase test db --local
node --test tests/*.test.js
npm run check:architecture
npm run lint
npm run build
git diff --check
git status --short
git diff -- supabase/config.toml
```

Expected patch only:

- `supabase/functions/invite-student/index.ts` (metadata sanitization on Hook ON)
- `scripts/oauth-local-email-admission-hook-http.mjs` (new local test)
- `docs/OAUTH_GOOGLE_1_6_1A_GATE3A2B_LOCAL_HOOK.md` (this guide)

The package does **not** modify any SQL migration, user management, frontend,
Google OAuth configuration, financial rules, scheduling, material or assignment
business logic. **Do not commit until Hook-ON integration tests and the full
regression suite PASS. Do not touch Production.**

Only share aggregate PASS counts and redacted errors in chat; never share
`supabase status -o env`, access tokens, raw tickets, test passwords or full
Mailpit messages.
