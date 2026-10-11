# Security Stage 1.2 — password recovery and invitation link access

Status: code prepared; manual browser and Supabase Cloud flow checks required before merge.

## Goal

The `/reset-password` and `/set-password` password forms must never open
solely because `getSession()` returned a signed-in session.

## Implementation

- A successful `PASSWORD_RECOVERY` event from Supabase authorizes the reset
  screen for the authenticated user, temporarily and in the current tab.
- The existing PKCE `?code=...` reset callback grants recovery access only
  after `exchangeCodeForSession` and `getUser` succeed.
- Supabase's verified implicit invitation callback (`#type=invite` together
  with the access and refresh tokens that Supabase accepted) grants access
  to `/set-password`; the existing `/auth/callback?code=...` invite path
  grants it only after a valid exchange and student profile confirmation.
- Grants are stored in `sessionStorage` for at most 15 minutes and bound to
  flow type and Supabase user ID; they are removed on success or sign-out.
- An ordinary signed-in session, arbitrary `?type=invite` parameter, expired
  or mismatched grant never authorizes either form.
- Password and confirmation fields/validation are reused across both flows.

These grants are a UI guard, NOT a cryptographic replacement for Supabase
Auth verification. Keep **Require current password when updating** enabled.
Do not enable extra OAuth providers until their callback rules are defined.

## Mandatory manual regression tests

Use disposable invited/student and teacher accounts only. If `.env.local`
points to Supabase Cloud, changing a password affects that cloud account.

1. Signed-in teacher visits `/reset-password` and `/set-password` directly:
   no password form; no password change.
2. Signed-in student visits both routes directly without an email link:
   no password form; no password change.
3. Request reset link, follow it, enter a new password, sign out and log in:
   login with the new password succeeds; old password fails.
4. After completing reset, revisit `/reset-password`: no form.
5. Invite a *new disposable student* using the teacher invite feature, open
   the invite email, set a password, log out/in: success. Verify the student's
   teacher relationship and that no duplicate profile was created.
6. Directly open `/set-password` after normal student login: no form.
7. Repeat relevant screens in UA/RU/EN; test erroneous passwords, expired
   invitation, refresh before and after setting password.
8. Re-check current-password validation from security settings for both
   teacher and student roles (step 1.1 regression).

If invitation tests fail after the Cloud setting was enabled, do not disable
that security setting to make invitations work. Diagnose the Supabase invite
email format and server behavior before changing Production.

No SQL migration, Edge Function change, Supabase Dashboard write, or
Production deployment is part of this change set.
