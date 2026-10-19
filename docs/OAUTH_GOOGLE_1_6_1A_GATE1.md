# Google OAuth 1.6.1a — Gate 1: LOCAL Supabase Auth Hook observation

## Gate 0 findings

- `inviteUserByEmail` creates a profile with the same UUID and `student` role.
- Ordinary anonymous `auth.signUp({ options: { data: { role: 'teacher' } } })` creates a `teacher` profile: **security defect**.
- Both disposable users were deleted.
- Google has **not** been enabled or tested.

## Objective

Determine the real, **server-supplied** difference (if any) between an admin invitation and anonymous signup in the `Before User Created` event. Do **not** trust `user_metadata.role`; a browser can supply it.

The observer always returns `{}` to GoTrue (does not block signup) and saves only event shape, provider, role claim **explicitly marked untrusted**, and boolean presence of selected fields. It does not save email, IP, user metadata contents, credentials, or tokens. It is strictly diagnostic, **not a security fix**.

## Local-only installation (PowerShell)

Keep `feature/oauth-google`. Extract this ZIP over the existing project. It replaces `supabase/config.toml` with a **temporary, uncommittable** hook setting and adds a diagnostic SQL file, a Node helper, and this document.

Check that Supabase Docker is currently local:

```powershell
npx supabase status
```

Install the local diagnostic SQL. The script checks that the CLI API URL is `http://127.0.0.1:54321`, then uses Docker **only** for the exact container `supabase_db_english_classes_vite`:

```powershell
node scripts/oauth-local-hook-observer.mjs install
```

Restart the LOCAL services to activate the temporary `config.toml` hook. Default `supabase stop` keeps the local database volume (DO NOT use `--no-backup` or `db reset`):

```powershell
npx supabase stop
npx supabase start
node scripts/oauth-local-hook-observer.mjs probe
```

Expected result: TWO event objects, one for `admin invitation`, one for `public signup`. Compare `app_provider`, `has_invited_at`, `has_email_confirmed_at`, and the arrays of field names. The JS script deletes both disposable local Auth users after the probe and fails if no hook event is recorded. Do not infer trust from `untrusted_role`.

If the restart refuses to start or the probe returns a permission/error message, **stop** and share only the error. Do not change cloud Auth settings in response.

## Restore local configuration immediately after capturing the output

`supabase/config.toml` is a temporary Gate 1 modification and **must not be committed**. To disable the local hook, restore the tracked config before restarting:

```powershell
git restore -- supabase/config.toml
npx supabase stop
npx supabase start
node scripts/oauth-local-hook-observer.mjs cleanup
git status -sb
```

`cleanup` refuses to delete the hook schema while the temporary hook is still enabled in `config.toml`. It drops **only** the disposable local `oauth_probe` schema.

If `git restore` would overwrite other intentional `supabase/config.toml` edits, do **not** run it; instead manually revert just the `[auth.hook.before_user_created]` diagnostic block and confirm no active hook.

## Strict safety gates

- **Never** push this `supabase/config.toml`: GitHub CI would not have its local diagnostic hook installed at the moment Auth starts.
- **Never** use `npx supabase db push --linked`, `db reset`, a cloud SQL editor, or hosted Auth Dashboard for this diagnostic.
- Do not change `handle_new_user()` or existing test fixtures yet. SQL regression fixtures currently insert teacher profiles using role metadata.
- When implementing enforcement, use server-owned invitation state and enforce confirmed Google identity separately. A pending invitation email by itself cannot authenticate an anonymous email/password signup.
- Do not create pre-activated users for Google-no-email invitations.
- Before deploying any hook, test compatibility with `inviteUserByEmail` and both auth branches locally.

Once you share Gate 1 output, select the actual safe trusted discriminator and implement the server policy with corresponding SQL/JS test fixtures. The observer is not meant to remain in the final migration chain.
