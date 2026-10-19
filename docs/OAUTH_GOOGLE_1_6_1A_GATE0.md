# 1.6.1a / Gate 0 — verify existing Auth behavior before SQL changes

**Status:** non-production baseline test. No SQL migrations, hooks, OAuth providers, policies, or frontend routes are changed by this package.

## Agreed product behavior

- Existing `email_password` invitation remains as is: a real Supabase Auth user is created immediately and an email is sent.
- New `google_no_email` invitation stores **only a pending invitation**, no `auth.users`, `profiles`, `teacher_students`, lessons, finances, or notifications linked to a student UUID until first authorized Google login.
- Teachers later see a separate **Awaiting activation** list; scheduling is unavailable before activation.
- Existing CRM account and student financial data must never be migrated to a different user UUID.
- Never use client-supplied `raw_user_meta_data.role` as authorization. Reject uninvited OAuth registration at the server boundary.

## What the actual code currently does

- `supabase/functions/invite-student/index.ts` calls `auth.admin.inviteUserByEmail()` and then creates `teacher_students`.
- `public.handle_new_user()` trusts `new.raw_user_meta_data.role`; browser-side `signUp` can supply this metadata if registration is enabled. This is the finding that requires a server fix.
- Existing pgTAP fixtures insert `auth.users` with `raw_user_meta_data.role='teacher'` and depend on the trigger assigning that role. **Do not change the trigger without updating the test fixture setup and preserving 335 functional test contracts.**
- `/auth/callback` grants a password-invitation flow for student profiles. A Google return must later use a distinct callback/branch that cannot authorize password setup.

## Run the safe local baseline probe

From the CRM root, on branch `feature/oauth-google`:

```powershell
npx supabase status
node scripts/oauth-local-auth-baseline.mjs
```

The script uses only the CLI's **local** `npx supabase status -o env`, enforces the literal API host `127.0.0.1`/`localhost` and port `54321`, and refuses cloud Supabase. It does **not** read `.env.local` and does not print keys. It creates two disposable accounts with unique `@example.invalid` addresses, checks admin invitation versus user-controlled sign-up metadata, and deletes their Auth UUIDs in `finally` (unless local cleanup fails). Local Mailpit catches the invitation email. A local email quota can prevent the first invitation; this is not a security regression.

Expected on the **existing unpatched local code**:

- Admin invite produces a student profile with the **same UUID**.
- Direct email signup *may produce a teacher profile* from `role:'teacher'`. If confirmed, that is a server-side authorization weakness to fix, not an intended feature.
- The script does **not** prove `Before User Created` hook behavior or verify Google email identity. It is not a green light to activate OAuth.

If cleanup fails, inspect **only local** Supabase Auth users and manually remove the `oauth-probe-...@example.invalid` test account. Never run cleanup against Production.

## Next required experiments (after baseline)

1. Install a **temporary observing hook** only in local Supabase and inspect event fields for admin email invitation versus direct sign-up. Confirm whether `inviteUserByEmail` invokes the hook and what trustworthy fields differentiate it. Merely seeing `app_metadata.provider='email'` is **not sufficient**.
2. Verify a **real local Google OAuth flow** (when local Google OAuth credentials are available): what provider data is present, if the email is verified, and the new-user / identity-linking behavior. The published hook event shape is not proof of those behaviors.
3. Only then implement a private pending-invitations table, safe server role provisioning, hook restriction, and teacher invite method while preserving admin invitations and all regression tests.
4. Deploy no new Auth hook, SQL migration or provider configuration to Production before complete local and CI tests and an explicit rollout plan.

Official documentation:
- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
- https://supabase.com/docs/guides/auth/auth-identity-linking
- https://supabase.com/docs/guides/auth/users
