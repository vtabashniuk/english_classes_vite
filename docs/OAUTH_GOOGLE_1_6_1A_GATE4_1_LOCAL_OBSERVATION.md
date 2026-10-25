# CRM — Google OAuth Gate 4.1: safe LOCAL observation

**Scope:** only LOCAL Supabase + a new Google OAuth Web Client. This is **not** Gate 4.2 admission implementation and not production deployment. The current `public.crm_before_user_created_hook(jsonb)` remains the only source of admission decisions. A temporary wrapper logs **shape only** and then delegates to the original hook, returning its result unchanged. No CRM user/profile/link is intentionally created by the Google test.

**Expected outcome of the first real Google sign-in with a NEW Google identity:** denial of new account creation, and one `CRM_GATE4_SHAPE synthetic=false` diagnostic log line. This is a successful **observation**, not a successful Google login.

## Hard limits

- Work only from `D:\Projects\english_classes_vite` on `feature/google-oauth-gate4` and with `npx supabase status` showing `127.0.0.1:54321` / DB `54322`.
- Never run `db push --linked`, `db reset`, cloud Dashboard Auth changes, `functions deploy`, `secrets set`, or remote SQL Editor for this gate.
- Never insert real passwords, client secrets, tokens or email addresses into source, Git, ZIP, screenshots, reports, or chat.
- Do **not** modify existing `supabase/migrations`, `src/`, `invite-student`, `public.crm_before_user_created_hook`, or business data.
- Temporary edits to `supabase/config.toml` must be fully restored. Backup outside Git.
- The diagnostic logs field **names**, normalized provider categories, and booleans. Do not share full Docker logs: they may contain unrelated sensitive information.
- Use a controlled **test Google account not present in LOCAL `auth.users`**. If the Google identity already exists locally, the Before User Created Hook may not run (identity linking / existing account).

## Step 0 — Prepare local Supabase and a reversible backup

From PowerShell 7 in the actual project root:

```powershell
git branch --show-current
git status --short
npx supabase status
Copy-Item supabase/config.toml "$env:TEMP\crm-gate4-config.toml.backup" -Force
```

Confirm `supabase/config.toml` initially has the local Google provider absent/disabled, and the original Hook block is commented as in the repository.

To enable the **existing restrictive** hook **locally**, uncomment its original block (or add it once if absent):

```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/crm_before_user_created_hook"
```

No other auth policy is changed. Apply to LOCAL only:

```powershell
npx supabase stop
npx supabase start
npx supabase status
```

If the local database has not been migrated up to Gate 3a.1, STOP; do not use this diagnostic to repair/reset it. You can check migration status locally without changing any data.

## Step 1 — Install local-only wrapper while Google is OFF

```powershell
node scripts/oauth-gate4-local-observer.mjs install
```

This tool checks the expected project folder, project ID, ports, local Docker container, original hook URI, and Google being OFF. SQL is executed via Docker to the exact local database container; no Supabase cloud credentials or API connection are used.

If `oauth_gate4` already exists, the installer **fails without replacing** it. Do not drop an unexpected existing schema without examining it.

## Step 2 — Create a separate Google Web OAuth client

In [Google Auth Platform](https://console.cloud.google.com/auth/clients), choose a test/development Google Cloud project and **Web application** client. Add:

- Authorized JavaScript origin: `http://127.0.0.1:3000` (diagnostic return origin, not Production).
- Authorized redirect URI: **`http://127.0.0.1:54321/auth/v1/callback`** (Supabase Auth, NOT the CRM route).
- In OAuth consent screen / Audience, configure test mode and include only the Google account you control, if your configuration requires test users.

Never reuse Production Google credentials for this experiment; do not enable Google in hosted Supabase.

Temporarily adjust LOCAL `supabase/config.toml`:

1. Change the hook URI ONLY, preserving `enabled = true`:

```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/oauth_gate4/observe_before_user_created"
```

2. Add this section **once** (there is no `[auth.external.google]` in the provided baseline):

```toml
[auth.external.google]
enabled = true
client_id = "YOUR_LOCAL_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
skip_nonce_check = false
```

Do not change `[auth].site_url`, global `enable_signup` or `auth.email.enable_signup`. We deliberately use the already-configured `http://127.0.0.1:3000` callback for observation, with **no CRM frontend changes**.

For the local start, supply the secret **only in the process environment**:

```powershell
$env:SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET = Read-Host 'LOCAL Google OAuth Client Secret' -MaskInput
try {
    npx supabase stop
    npx supabase start
    npx supabase status
}
finally {
    Remove-Item Env:SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET -ErrorAction SilentlyContinue
}
```

This removes the secret from the PowerShell environment after `supabase start` returns. If you need to restart with this configuration, supply the secret again. **Never paste its value in chat.**

## Step 3 — Confirm the wrapper still denies new Google signups

```powershell
node scripts/oauth-gate4-local-observer.mjs verify
```

Expected output:

`PASS: local observer installed; permissions restrictive; mock Google signup still DENIED 403.`

This performs an **SQL-only synthetic** call. Its log has `synthetic=true`; it is not evidence of an actual Google OAuth request.

## Step 4 — Make ONE actual Google OAuth request

Before this step, use the **LOCAL** Supabase Studio SQL Editor to verify that the Google test email is absent in `auth.users`; do not paste the test email into a script or share it:

```sql
select count(*) as matching_local_users
from auth.users
where lower(email) = lower('TYPE_CONTROLLED_TEST_GOOGLE_EMAIL_LOCALLY');
```

Expected `matching_local_users = 0`. If nonzero, STOP; otherwise the Hook might not execute.

Open this URL in a private browser window (local Supabase must be running):

`http://127.0.0.1:54321/auth/v1/authorize?provider=google`

Choose only the controlled test Google account. Google authentication can succeed, **but the old CRM hook should refuse account creation**. Browser errors or a failed redirect to the deliberately unused `127.0.0.1:3000` are not themselves enough to judge success. Verify with the log and DB count below.

```powershell
node scripts/oauth-gate4-local-observer.mjs logs
```

Look for **one genuine `synthetic=false`** line and report *only* these safe fields: `app_provider`, `first_identity_provider`, `identity_count`, `email_confirmed_at_set`, `user_email_present`, `metadata_keys`, `app_metadata_keys`, `identity_keys`, `user_metadata_keys`. The `user_keys` list is also safe to share, but no other raw DB/Auth logs.

Then in LOCAL SQL Editor re-run the **same** `auth.users` count query, expecting **0**. Do not claim the test passed based solely on a browser error, absence of a session, or an HTTP 429/500. If there is no genuine observer log, stop and investigate local Auth container logs privately before the next gate.

If the test unexpectedly creates an Auth user: STOP. Do not delete it reflexively; collect its local count and investigate the hook wiring before any cleanup.

## Step 5 — Restore local behavior and remove the diagnostic schema

Restore the complete original local config **before** dropping the wrapper:

```powershell
Copy-Item "$env:TEMP\crm-gate4-config.toml.backup" supabase/config.toml -Force
npx supabase stop
npx supabase start
node scripts/oauth-gate4-local-observer.mjs cleanup
```

This returns the repository's original local Hook-OFF and Google-OFF configuration. The diagnostic schema is removed only from the exact local Docker DB. Inspect Git and config before deleting the backup:

```powershell
git diff -- supabase/config.toml
git status --short
npx supabase status
```

Expected no tracked `config.toml` difference; no changes to Production. Only after successful restoration may you remove the temporary backup:

```powershell
Remove-Item "$env:TEMP\crm-gate4-config.toml.backup"
```

If restoration fails, keep the backup, do **not** run cleanup, and report the error. If the wrapper logs a real non-denied Google signup, do not continue to Gate 4.2.

## Gate 4.1 acceptance report

Share only:

| Check | Expected |
|---|---|
| Local original hook installed | YES |
| `verify` synthetic denial | `403` |
| Real Google test identity absent before | `0` |
| One real `CRM_GATE4_SHAPE` event | `synthetic=false` |
| Real Google test identity absent after | `0` |
| Baseline config fully restored | clean diff |
| `oauth_gate4` diagnostic schema removed | YES |

**What this does not establish:** a secure rule for trusting Google email in the Hook, verified identity linking, pending-invitation acceptance, or regression safety. Those belong to Gate 4.2–4.5. In particular, a user_metadata `email_verified` boolean by itself is not trusted admission evidence.

Sources: [Supabase Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Before User Created Hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook), [Local config and secrets](https://supabase.com/docs/guides/local-development/managing-config).
