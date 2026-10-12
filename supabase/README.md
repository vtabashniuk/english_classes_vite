# Supabase backend — English Classes CRM

The database schema is maintained as **versioned SQL migrations** in `supabase/migrations/` (66 files at completion of release stage 1.5.2). PostgreSQL business rules use constraints, RLS policies, triggers and RPCs. Do not edit migrations already deployed to Supabase Cloud; author a new forward-only migration for a change.

## Edge Functions

- `functions/invite-student/index.ts`: teacher-authorized student invitation and link restoration; `APP_URL` sets the frontend origin for invite redirect to `/set-password`.
- `functions/resolve-payment-tax/index.ts`: server-side payment/tax resolution.
- `functions/refresh-finance-fx-rates/index.ts`: exchange rate update workflow.

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to server-side functions as configured. The service role is **server-only**; never use it in `VITE_*` variables or frontend code. Do not commit environment secrets.

## Local development and SQL tests

```powershell
npx supabase start
npx supabase status
npx supabase test db --local
```

Tests reside under `supabase/tests/database/` and use pgTAP, synthetic fixtures and transaction rollback. At completion of stage 1.5.2 there were 335 SQL checks. `supabase db start` is used by GitHub CI to start its isolated database without production credentials.

Local Auth test emails can be inspected via the Mailpit UI exposed by the Supabase local stack (usually port 54324; see `npx supabase status`).

## Production migration procedure

Only after reviewing a new migration, backup/recovery arrangements, local tests and the GitHub Pull Request:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Review the exact migration filenames and potential data impact before any real `db push`. Execute a real cloud push only as an explicitly approved release action and then validate the production application. Do not run `db reset` against Production, and do not assume a frontend deploy applies database schema changes.

Deployment procedures and rollback cautions are in [`docs/RELEASE_RUNBOOK.md`](../docs/RELEASE_RUNBOOK.md).
