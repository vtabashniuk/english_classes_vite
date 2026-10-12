# Release runbook — English Classes CRM

## Rules and environments

- Protected `main` is the stable branch. Implement changes in a `feature/*` (or `fix/*`) branch, submit a Pull Request, and require green **Quality checks**.
- The GitHub CI runs an **isolated** local PostgreSQL instance. It does not deploy to Supabase Cloud and should not use Production secrets.
- Vercel deploys the frontend independently. Supabase migrations and Edge Functions require separate planned actions.
- Treat student profiles, financial operations, secrets and access credentials as sensitive.

## Before requesting merge

1. Verify the diff contains only approved files; ensure no `.env*` secrets, backup archives, `node_modules`, `dist` or real student exports have been included. `.env.example` is safe only when it contains placeholders.
2. Run `npm run check:architecture`, `node --test tests/*.test.js`, `npm run lint`, `npm run build` and `npx supabase test db --local` (with a running local DB).
3. Ensure no completed business feature was changed without a demonstrated defect and regression test.
4. Inspect the GitHub Pull Request, all commits and the required `Quality checks` status.
5. Confirm whether merging into `main` will trigger an automatic Vercel Production deployment and plan the timing accordingly.

## Database changes (only if a release includes a new migration)

1. Add a new SQL migration; never rewrite a migration already applied in the cloud.
2. Test on a disposable local database and review RLS grants, triggers, financial effects and migration order.
3. Prepare a database backup and a **forward recovery plan** for schema/data changes; a Vercel rollback does not roll back PostgreSQL.
4. Verify the linked Supabase project is the expected one before running cloud commands.
5. Review the result of `npx supabase migration list --linked` and `npx supabase db push --linked --dry-run`.
6. Execute `npx supabase db push --linked` **only when explicitly approved** for a scheduled release. Inspect results and verify production data invariants.

**Forbidden on production:** `db reset`, SQL test fixtures, `--local` scripts repointed at cloud, destructive data cleanup, direct edits to applied migrations, or unattended admin scripts with `service_role`.

## Edge Functions (only if changed)

Deploy only the reviewed function; confirm cloud configuration such as `APP_URL` is correct for the active frontend origin. Never print service-role keys or store them in frontend `VITE_*` variables. Check the function logs and the affected scenario after deployment.

## After merge / Vercel deployment

1. Confirm `main` and Production deployment correspond to the intended commit.
2. Check public page loading and direct navigation to `/login`, `/student-area` or `/teacher-dashboard` with expected auth redirects.
3. Run smoke tests with disposable accounts: teacher and student sign-in, password change with a **wrong old password** (must fail), recovery/invite only when email quota permits, session timeout warning and Logout.
4. Verify the affected feature's workflows (lessons, finances, materials, assignments) without creating irreversible real payments or notifying real students.
5. Check runtime logs and error notifications. Document the deployed revision and test result.

## If deployment fails

- For a **frontend-only** defect, fix by a new Pull Request/revert commit and redeploy. A Vercel rollback can restore a previous frontend deployment but does not reverse Supabase state.
- For a backend or database defect, stop further changes, preserve diagnostics, assess data impact, and execute the prepared forward recovery plan; do not run ad-hoc rollbacks or delete financial history.
- Do not disable protected checks merely to merge.

## Known deferred items

- External sign-in providers (Google, Apple, Microsoft) planned separately in stage 1.6.
- Custom SMTP with own domain, and online payments, deferred to their respective deployment stages.
- Potential timezone discrepancy in assignment reminders when teacher schedule timezone differs from `Europe/Kyiv` requires scenario-based confirmation before code changes.
- Bundle splitting for the current router is an optimization candidate only; do not claim improved load time without measurements.
