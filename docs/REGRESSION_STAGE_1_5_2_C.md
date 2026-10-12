# CRM — Stage 1.5.2c: Calendar & Lesson Finance Integration Regression

## Scope

- One new `supabase/tests/database/03_calendar_finance_regression.sql` file, with 34 pgTAP assertions.
- **No changes** to React business logic, database schema, Supabase migrations, or environment settings.
- Tested concepts: calendar creation/overlap/slot/working-hours/role restrictions, single-lesson reschedule with immutable price snapshot, teacher cancellation without billing, service-only finance helper, lesson charge timestamp, repeated-charge idempotency, append-only reversal.
- This suite complements the 40 tests from Stage 1.5.2b. It does **not** yet cover all student-initiated early/late cancellation, recurring-series generation, tax and FX flows. Those remain separate integration test areas.

## How to run — LOCAL Supabase only

From the repository root in PowerShell, with Docker/Supabase running:

```powershell
npx supabase status
npx supabase test db --local
```

**Never use `--linked`, `--db-url`, production credentials or a remote database. Do not run `db reset` for this test.** The pgTAP runner wraps the SQL files in transactions and rolls them back; the test file also explicitly uses `BEGIN`/`ROLLBACK`.

All test accounts use `@crm-tests.invalid` and synthetic UUIDs. The test does not use SMTP or any real user accounts.

Expected result if previous two test files are present and all tests pass: `Files=3, Tests=74`, `Result: PASS`.

## Control after installing

Run:

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
npx supabase test db --local
```

The 81 JavaScript tests from Stage 1.5.2a should stay unchanged. GitHub CI does not currently start a local PostgreSQL service; **the pgTAP result is checked locally**, not by the current Quality checks job.

Do not commit until the pgTAP runner has passed. If it fails, send the full console log; investigate the test fixture first and change business logic only if a genuine defect is demonstrated.
