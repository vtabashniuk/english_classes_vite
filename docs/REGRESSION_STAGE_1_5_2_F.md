# CRM — Stage 1.5.2f: Recurring schedule, tariffs and pauses

This stage adds a **test only** SQL file. It does not modify production migrations,
RLS policies, RPCs, React code or the existing GitHub Actions workflow.

## Scope

`supabase/tests/database/06_recurring_pricing_pause_regression.sql` has **48 pgTAP assertions** covering:

- initial lesson rate snapshots and later scheduled tariff changes;
- preservation of the price and pricing date with `keep_original`;
- destination repricing with `target_date_tariff`;
- open-ended recurring lessons and the eight-week materialization horizon;
- recurring reservations outside the materialization horizon;
- fixed series fully materialized to their ending date;
- materialized occurrence identity after moving just one lesson and regenerating;
- scheduled learning pauses (maximum 14 days), cancelled lesson charges,
  unchanged recurring series, and cancellation of a planned pause by the student.

The data is synthetic (`@crm-tests.invalid`) and is created in a transaction
that ends in `ROLLBACK`.

## How to run

Stay on `feature/regression-stage-1-5-2`. Extract the stage ZIP into the
project root, retaining the `supabase/` and `docs/` directories. Start your
**local** Supabase with Docker, then run:

```powershell
npx supabase status
npx supabase test db --local
```

**Do not** use `--linked`, the production URL, `db push`, or `db reset`.
No Auth emails should be sent by these tests.

If the preceding stages 1.5.2b–e are present, the expected summary is:

```text
Files=6, Tests=212
Result: PASS
```

This is an **expected** result, not a verified local-database run. These SQL
tests need to be executed against the locally migrated Supabase instance.
If anything fails, **do not commit**. Send the complete failing assertion,
actual/expected values and error text. We will first check whether the test
expectation or fixture is incorrect before considering business-logic changes.

After PASS, run the usual Node checks if you wish to verify the entire tree:

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
```

Only after a successful local SQL run, commit the new test and document:

```powershell
git add supabase/tests/database/06_recurring_pricing_pause_regression.sql
git add docs/REGRESSION_STAGE_1_5_2_F.md
git commit -m "test: cover recurring lessons, rate policies and pauses"
git push
```

These SQL tests intentionally remain **local-only**; the existing GitHub CI
runs JavaScript tests and build checks, not the local Supabase database.
