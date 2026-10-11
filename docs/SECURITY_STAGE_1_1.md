# Security — stage 1.1.2: changing a password with server enforcement

## Prerequisite (configured in Supabase Cloud)

In **Authentication → Sign In / Providers → Email**, enable **Require current password when updating**. This is distinct from the optional "Secure password change" / nonce reauthentication policy.

Both teacher settings and the student profile use the same `ChangePasswordForm`, `useChangePassword`, and `passwordService`. The form collects the *current password*, *new password*, and *confirmation*. No password is sent to the CRM database, stored in localStorage, or logged.

## Stage 1.1.2 implementation

- `passwordService` calls `changePasswordWithServerPolicy` using the existing Supabase Auth client.
- The flow checks the authenticated user with `getUser()` and verifies the identity did not switch just before update.
- It calls `supabase.auth.updateUser({ current_password, password })` **once**, so the GoTrue server verifies the current password.
- It rejects missing old password and invalid new password before any Auth update.
- Incorrect old password from GoTrue (`current_password_mismatch` / `current_password_required`) is shown using translated form messages.
- The extra isolated Auth client and secondary `signInWithPassword` verification from hotfix 1.1.1 have been removed: they created another session, could affect login audits and rate limits, and are unnecessary after enabling the server setting.

**Security boundary:** client checks are not security policy. If the hosted Supabase toggle is turned off, a direct `/auth/v1/user` request could bypass the form. Always verify server behavior on a dedicated test account before release.

## Local Supabase limitation

Supabase CLI configurations may not expose the hosted `Require current password when updating` toggle in `supabase/config.toml`. `auth.email.secure_password_change` is a separate setting for reauthentication, **not** an equivalent. Do not change it as a substitute or assume local testing proves hosted password verification.

## No change to password recovery / invitation

This substage deliberately does not alter `/reset-password` and `/set-password`. Supabase Auth can exempt a valid recovery session and a user with no existing password from the current-password requirement; however, the CRM still needs to enforce valid invitation/recovery state before allowing those forms. This is stage **1.2**. With the hosted setting now enabled, verify those scenarios with disposable test accounts before wider release.

## Functional checklist — test accounts only

1. Apply the changed-files ZIP over the project; run architecture check, `node --test tests/*.test.js`, lint and build. No npm dependency changes.
2. Teacher: wrong current password + different valid new password → translated error; old password continues to work; new password must not work; CRM session stays active.
3. Teacher: correct current password → success; explicit logout; old password rejected; new password accepted.
4. Repeat both tests on a disposable student account. Verify UA/RU/EN form labels.
5. In browser DevTools Network, inspect only HTTP status/error *codes* (never share request bodies containing passwords): wrong password must fail server-side in `PUT /auth/v1/user` with `current_password_mismatch` (or equivalent).
6. Confirm password-reset email and invited-student onboarding still work before releasing any security changes to Production.

Do not run destructive migrations or modify production user passwords during tests. No SQL changes are included.
