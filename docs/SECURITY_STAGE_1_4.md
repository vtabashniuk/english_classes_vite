# Security stage 1.4 — privileged and test operations

Scope: **local-only administrative password reset helper**. No changes to the already-tested UI, authentication flows, business logic, SQL migrations or deployed Supabase Edge Functions.

## Risk addressed

Previously `scripts/reset-test-student-password.mjs` accepted any `SUPABASE_URL` and a `SUPABASE_SERVICE_ROLE_KEY`, then called `auth.admin.updateUserById` on `TEST_USER_ID` without additional checks. With cloud credentials this could update a real user's password.

## New restrictions

- **Hard deny on remote endpoints.** The script accepts only `http://127.0.0.1:54321`, `http://localhost:54321` or `http://[::1]:54321`. No cloud URL is accepted; there is no production override.
- Explicit `--confirm-local-reset` flag required.
- Require `SUPABASE_SERVICE_ROLE_KEY`, `TEST_USER_ID`, `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` (minimum eight characters).
- Before changing any password, look up the user with `auth.admin.getUserById` and verify the email matches `TEST_USER_EMAIL` case-insensitively.
- Fail closed if the lookup fails, email differs, or endpoint is not local. Secrets and new passwords are not logged.
- URL and confirmation checks run before importing the Supabase SDK or creating the privileged client.

## Optional local use (only if required)

1. Run local Supabase (Docker is needed for this workflow): `npx supabase start`. Check your local port via `npx supabase status`.
2. From an isolated **local PowerShell session**, set the environment variables. `SUPABASE_URL` **must** be `http://127.0.0.1:54321`. Use the **local** service role key, not your cloud project's secret. Set `TEST_USER_ID` and `TEST_USER_EMAIL` to the same local user. Do not commit any secret or include a real password in an archive.
3. Run: `node scripts/reset-test-student-password.mjs --confirm-local-reset`.
4. Clear sensitive values from the PowerShell session when finished, especially `SUPABASE_SERVICE_ROLE_KEY` and `TEST_USER_PASSWORD`.

Ordinary users should continue to change or recover passwords through the tested self-service forms. This is an optional test-only utility.

## Verification

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
```

No database, external auth service, production secrets, or user accounts are accessed by the automated tests. The executable's fail-closed behavior is tested against an inert sample cloud URL with a dummy key.

## Remaining security scope

Supabase Edge Functions `invite-student`, `resolve-payment-tax` and `refresh-finance-fx-rates` legitimately use server-side privileged credentials after user authorization checks. They were **not modified** in this isolated substage. A separate server-side permission and RLS/RPC audit belongs to broader regression/security testing, without touching production data.
