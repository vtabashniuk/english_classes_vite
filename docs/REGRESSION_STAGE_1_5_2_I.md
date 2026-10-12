# CRM — Stage 1.5.2i: final critical SQL regression gaps

**Scope:** new pgTAP tests only. No production SQL migrations, frontend edits, OAuth changes, external API calls, or secrets.

## Test suite

| File | Checks | Focus |
| --- | ---: | --- |
| `08_financial_access_lifecycle_regression.sql` | 24 | Rate-based blocking, strict entry boundary, temporary teacher override, re-lock on next ledger transaction, recovery hysteresis, unauthorized actors |
| `09_materials_assignments_access_regression.sql` | 27 | Teacher isolation, bulk share, deduplicated notifications, assignment material links, revocation, re-grant and audit |
| `10_assignment_reminder_dedup_regression.sql` | 20 | Kyiv 09:00 / lesson-hour reminder timing, live local dispatcher, one event and notification after repeated dispatch, deadline change |
| **New** | **71** | |
| Previously verified 1.5.2b–g | 264 | |
| **Expected combined** | **335** | |

Test fixture IDs use unused `81…`, `82…`, `83…` UUID prefixes and `.invalid` email domains. Every test file begins a transaction and calls `ROLLBACK`. These are local database tests; do not run against an externally connected or production database.

## Control sequence

```powershell
# In branch feature/regression-stage-1-5-2, local Supabase running
npx supabase status
npx supabase test db --local

# Only after SQL PASS
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
```

Expected SQL result: `Files=10, Tests=335, Result: PASS`.

Do not commit until the SQL tests pass. If a test fails, capture the failing assertion, SQL error code, and traceback; investigate whether the fixture, expected outcome, or business rule caused the difference. A failure is not permission to change the existing business logic without a separate diagnosis.

Because `Quality checks` now runs the local Supabase suite, push after a successful local pass will verify the new tests in GitHub CI as well.

**Known outstanding P2 work:** full reschedule-request workflow, read/retention of notifications, and non-Kyiv reminder timezone support remain separately tracked. CI passing this suite does not establish those scenarios as correct.

**Testing limitation:** these three SQL files were statically reviewed but not executed against a running PostgreSQL instance by the assistant. Actual execution must be confirmed using the local Supabase test runner.
