# CRM — Regression baseline 1.5.2a (no database)

## Scope

Adds automated regression tests **only**. The existing React code, financial functions, database migrations, and deployed services are untouched.

Tests protect previously agreed behavior in three existing pure modules:

- Schedule: 50-minute lessons, 30-minute slots, working-day boundaries, conflicts with a lesson or schedule block, cancelled lessons, and timezone/DST conversion.
- Finance: descending sorting by business date, event creation time and ID; totals by original currency; UAH reporting snapshots; pending flags for incomplete reporting and profitability.
- Meeting links: provider-neutral matching for Zoom, Google Meet, and Microsoft Teams; false positives for spoofed domains.

## Checks

Run in PowerShell from the project root:

```powershell
node --test tests/*.test.js
npm run check:architecture
npm run lint
npm run build
```

The existing GitHub Actions `Quality checks` already executes the test glob; no workflow changes are necessary.

## Important boundaries

These are fast unit-level regression tests. They **do not** validate actual PostgreSQL RLS policies, SECURITY DEFINER behavior, finance RPC transactions, price snapshots in the database, nor the behavior of cron jobs. The next part (`1.5.2b`) requires a dedicated local Supabase database, isolated test identities and repeatable fixture setup/cleanup. Never run integration test setup against the linked/cloud production database.

If a test fails, first investigate the cause; do not change a completed business rule solely to make the test green.
