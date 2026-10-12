# CRM OAuth 1.6.1a — Gate 0b: local Auth Hook observation

Status: **temporary LOCAL experiment only**. No CRM migrations, no Cloud/Production changes, no Google activation, no security fix in this ZIP.

## What we already proved

- Local `inviteUserByEmail()` creates the correct auth UUID and `profiles.role='student'`.
- Local anonymous `signUp()` with attacker-controlled `options.data.role='teacher'` creates `profiles.role='teacher'`: **confirmed authorization vulnerability**. Do not claim Production is safe until the server-side guard has been deployed and verified.
- Previous disposable users were removed.

## Question being investigated

Does the **Before User Created** hook run for both the authorized `auth.admin.inviteUserByEmail()` and ordinary public `signUp()`? What fields are actually present and distinguishable in this project's local Supabase Auth version? A value in `user.user_metadata` is untrusted and cannot itself distinguish admin-created invitations.

The official hook input contains `metadata` and `user`; an allow response is `{}`. The hook in this diagnostic **always allows** and writes a small observation record; it **does not protect access**. Do not copy it into the future production policy. No email addresses, secrets, JWTs or entire event payloads are stored; only a prospective UUID, provider, requested role, booleans and JSON key names are recorded.

## Procedure (Windows PowerShell, project root)

**A. Prepare**

1. Remain on `feature/oauth-google`. Verify `git status -sb`.
2. Verify the local API URL (`npx supabase status`) is `http://127.0.0.1:54321`, and Studio is `http://127.0.0.1:54323`. **Never use** hosted Supabase Studio or `db push --linked` for this procedure.
3. Backup the config on your computer (outside Git):

```powershell
Copy-Item supabase/config.toml supabase/config.toml.gate0b.backup
```

**B. Install temporary observation code**

1. In **local** Supabase Studio → SQL Editor (`http://127.0.0.1:54323`), open and run `scripts/oauth-gate1/01_install_local.sql`. It creates only schema `oauth_gate1`. If the schema exists already, stop and investigate; don't overwrite it.
2. Add the following block at the **end** of `supabase/config.toml`:

```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/oauth_gate1/observe_before_user_created"
```

3. Restart **local only** to apply config (ordinary stop preserves data):

```powershell
npx supabase stop
npx supabase start
```

**Do not use `--no-backup`, `db reset`, `--linked`, or a dashboard for the hosted Supabase project.**

**C. Run the two test flows**

```powershell
node scripts/oauth-local-auth-baseline.mjs
```

Expected: the old invitation is still accepted and creates `student`, and ordinary signup still creates `teacher`. This last result remains insecure **on purpose in this diagnostic**, so that we can compare the event shapes before implementing a rejecting hook.

If the baseline aborts because Auth could not call the hook (e.g. permission denied, timeout), copy the error. Stop before applying real security rules.

**D. Collect observation**

In **local** Studio SQL Editor, run `scripts/oauth-gate1/02_report_local.sql`. Share the table output (provider, requested role, booleans, key arrays, total events), **not** keys, tokens or passwords.

- Two events and expected roles: both invitation and signup hit the hook.
- One event: investigate which path skipped the hook.
- Zero: hook may not be installed, not running, or events were rolled back; check local Auth logs and exact status.
- Provider alone is NOT proof of invitation; both might show `email`.

**E. Restore the working setup after saving the report**

1. Restore config:

```powershell
Copy-Item supabase/config.toml.gate0b.backup supabase/config.toml -Force
Remove-Item supabase/config.toml.gate0b.backup
npx supabase stop
npx supabase start
```

2. In local Studio SQL Editor execute `scripts/oauth-gate1/03_remove_local.sql` to remove the diagnostic schema.
3. Verify `git status -sb` (only the new script/documentation files should be untracked; `supabase/config.toml` must not be modified).

## Stop / error handling

- If a local Auth container fails to start with hook enabled, **first restore** the original config from the backup, then use `npx supabase stop` / `npx supabase start`. Don't drop the hook function while still configured.
- If the baseline returns an error, don't manually delete other users or reset the database. The baseline attempts cleanup itself, and you can inspect whether it reported cleanup success.
- If this experiment does not provide a **trustworthy** way to distinguish privileged invitation from user registration, **do not implement** a policy based on metadata.role, email text, IP, or unverified client-supplied flags. Revisit the server proof / invitation model first.

## Next stage after results

1. Design safe server-issued proof and private pending-invitation schema; confirm hook compatibility for `inviteUserByEmail`.
2. Replace `handle_new_user()` trusting `raw_user_meta_data.role`; add positive and negative tests for teacher signup/legitimate email invitation.
3. Test Google-specific provider/verified-email behavior separately with a real local/staging Google OAuth round-trip before enabling Production.

## References

- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
- https://supabase.com/docs/guides/auth/auth-hooks
- https://supabase.com/docs/guides/local-development/cli/config
- https://supabase.com/docs/reference/cli/supabase-migration-repair
