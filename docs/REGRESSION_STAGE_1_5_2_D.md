# CRM — Stage 1.5.2d: Student Cancellation Policy Regression

This stage adds **only one SQL pgTAP test file**:

`supabase/tests/database/04_cancellation_policy_regression.sql`

There are **36 new assertions**, covering:

- The teacher's six-hour free-cancellation threshold, including student preview.
- Authenticated student requests vs. teacher-only cancellation/resolution RPCs.
- Another student/teacher being denied access to the request workflow.
- Early request (free), duplicate pending-request rejection, and early-charge prohibition.
- Late request charged in full, price snapshot, correct `effective_at` (lesson start), and idempotency.
- Late request waived only with a recorded reason; no charge posted.
- Teacher rejection preserving the scheduled lesson with no ledger charge.

The test creates **synthetic** teachers, students and four **50-minute** lessons. Short-notice lessons are inserted directly rather than through the schedule RPC, to keep the tests deterministic regardless of local time and weekday. Actual create-lesson RPC and calendar rules are covered by Stage 1.5.2c.

## Run ONLY against the LOCAL database

```powershell
npx supabase status
npx supabase test db --local
```

Never use `--linked` or `--db-url` for regression tests and never run these tests against Production. No `db reset` is required. pgTAP runs in transactions and the file explicitly ends with `ROLLBACK`.

**Expected only if all previous files 01–03 are present and this suite passes:**

`Files=4, Tests=110, Result: PASS` (74 existing + 36 new).

The SQL was checked against the current migration source and fixture requirements but **has not been executed against PostgreSQL in the delivery environment**. If it fails locally, share the complete output. Do not modify production migrations or business functions to accommodate a test until a genuine regression is confirmed.

## After the SQL test passes

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
git status -sb
```

Do not commit this new SQL test before the local pgTAP run succeeds. This stage does not change any React code, RPC implementation, database schema, existing migrations, npm packages or CI workflow.

**Not yet covered:** automatic resolution of requests after lesson start, teacher payment decision after an automatic late cancellation, recurring-series cancellation, or student pause cancellation behavior. These can be separate focused regression tests.
