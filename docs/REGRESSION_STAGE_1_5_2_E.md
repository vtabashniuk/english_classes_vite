# CRM — Stage 1.5.2e: Started cancellation & outcome automation regression

## Scope

Adds one pgTAP file, `supabase/tests/database/05_started_cancellation_outcome_regression.sql`, with **54** assertions. It complements the already-tested Stage 1.5.2b–d SQL suites (40 + 34 + 36 = 110 assertions), giving **164 SQL assertions across five files**.

Covered cases:

- After lesson start, students cannot submit a new cancellation request and teachers cannot manually cancel the lesson.
- Previously submitted **early** requests are automatically approved and canceled for **no charge**.
- Previously submitted **late** requests automatically cancel the lesson, but the teacher must make an explicit **charge or waive** decision.
- Only the correct teacher may make the payment decision; a waiver requires a reason, and decisions are nonrepeatable.
- Financial journal entries use the original lesson-price snapshot and the scheduled lesson start as the business timestamp.
- Correcting **missed → completed → missed** does not produce duplicate lesson charges.
- The lifecycle worker creates a teacher reminder after lesson end and automatically marks an unresolved lesson **missed after 18 hours**.
- Worker re-execution is safe from duplicate lesson charges and duplicate reminders.

## Isolation and limitations

- **Local Supabase only.** Test identities use `.invalid` email domains and reserved synthetic UUIDs. No real Auth email is sent.
- The test is wrapped in `BEGIN` / `ROLLBACK`; pgTAP checks are nonpersistent.
- It temporarily backdates `lesson_outcome_automation_state.activated_at` **inside the test transaction** so a synthetic lesson can enter the 18-hour auto-missed pathway. This is rolled back.
- The lifecycle worker operates on all eligible local rows, not just the fixture. A clean/local test database is recommended. **Never run this suite against Cloud or Production.**
- This suite verifies the database behavior under the tested scenarios; it does not simulate the exact minute of a live cron tick or test browser notifications end to end.
- No SQL migrations, frontend files, or actual CRM business logic are modified.

## Run after committing 1.5.2d

In PowerShell from the project root:

```powershell
npx supabase status
npx supabase test db --local
```

Expected *if every existing suite remains present and passes*:

```
Files=5, Tests=164
Result: PASS
```

Do **not** use `--linked`, `--db-url`, Production environment variables, or `supabase db reset` for this operation. The test runner does not require a reset.

After a successful local SQL run:

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
git status -sb
```

Commit only after the SQL test and checks succeed. On a failure, share the unabridged SQL test output; a failed assertion is not automatic evidence of a production defect until the synthetic fixture and local migration state are checked.
