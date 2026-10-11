# Security Stage 1.5.1 — GitHub Actions CI

## Purpose

The workflow `.github/workflows/ci.yml` checks the CRM source code before merging changes. It does **not** deploy to Vercel, connect to a Supabase database, apply SQL migrations, or use any Production credentials.

## When it runs

- `push` to `main`, `feature/**`, `fix/**`, or `hotfix/**`;
- a Pull Request targeting `main`;
- manual launch through **GitHub → Actions → CRM CI → Run workflow** (when available in the default branch).

> A workflow committed only to a feature branch will run on a matching branch push. Manual launch through GitHub UI is generally available after the workflow exists on the default branch.

## Required checks

The single `Quality checks` job uses Ubuntu and Node.js 24.21.0 and runs:

```bash
npm ci
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
```

All five commands must exit successfully. An individual failure stops the job and marks the workflow unsuccessful.

The job uses read-only `contents: read` permissions and `persist-credentials: false`; it does not inject Supabase/Vercel secrets. `npm ci` uses the committed `package-lock.json`. Dependencies are installed from the npm registry. No artifact is published, and there is no deploy step.

The **CI build is a compilation check only**, not a Production-ready deployment bundle: no `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is supplied. The real runtime configuration remains the responsibility of Vercel/Production. The CI job does not execute the browser app or database-backed integration tests.

## How to enable and verify

1. Commit the new `.github/workflows/ci.yml` and this document to the feature branch (after confirming the previous stage changes are committed).
2. Push the branch to GitHub. Open **Actions → CRM CI** and confirm the `Quality checks` job is green. Check that each of the five steps ran.
3. Open a Pull Request from the feature branch into `main`. Verify the same CI check is attached to the Pull Request.
4. After a successful PR run, configure a GitHub branch protection rule or ruleset for `main` that requires a Pull Request and the **CRM CI / Quality checks** status check. Select the actual check label from the GitHub settings UI after the first run.
5. If Vercel automatically deploys from `main`, keep Production deploys tied to protected merges. This workflow alone does not prevent a user with sufficient permissions from pushing directly to `main`, and does not gate Vercel by itself.

## Safety boundaries

- Never add `SUPABASE_SERVICE_ROLE_KEY`, SMTP credentials, GitHub write tokens, or Vercel deploy credentials to this CI workflow.
- Keep SQL migrations and RLS tests in a separate, explicitly isolated job when Stage 1.5.2 is implemented; do not connect this job to the Production database.
- A successful CI job does not replace manual browser regression tests, RLS/RPC checks, or a controlled migration/deployment procedure.

## Local equivalent (PowerShell)

```powershell
npm ci
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
```

The warning about JavaScript chunks over 500 kB is **not** a build failure; bundle splitting can be handled separately in Stage 1.5.3 if necessary.
