# English Classes CRM

CRM for online English lessons, with separate teacher and student areas. Built with React 19, Vite 8, React Router 7, and Supabase (Auth, PostgreSQL/RLS/RPC, Edge Functions).

## Production and repository

- Frontend: Vercel (`https://english-classes-sigma.vercel.app`).
- Backend and database: Supabase Cloud; local SQL testing uses Docker-backed Supabase CLI.
- `main` is the protected stable branch. Changes go through a Pull Request with the required **Quality checks** GitHub Actions status.
- The database schema is versioned under `supabase/migrations/`; do not edit applied migration files.

## Requirements

- Node.js 24.x (used by the current GitHub CI; `package.json` permits Node.js 22.12+).
- npm and access to the repository.
- Docker Desktop and the Supabase CLI for local SQL integration tests. The CLI is included in devDependencies.

## Local application

```powershell
npm ci
Copy-Item .env.example .env.local
# Fill .env.local with the appropriate Supabase values and local frontend URL
npm run dev
```

Use `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the **intended** Supabase environment, never a `service_role` key. `VITE_APP_URL` must be the frontend's public origin (for example `http://localhost:5173` when using the default Vite port); password recovery uses it to construct its redirect.

Check that Supabase Auth **Site URL / redirect allowlist** permits the frontend callback origins you are testing. Browser access through localhost does **not** imply a local database: `.env.local` determines which Supabase backend the application will use.

See [local setup](docs/LOCAL_SETUP.md) for environment isolation, Mailpit and Windows troubleshooting.

## Quality checks

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
```

Run the PostgreSQL integration suite only with a local Supabase instance:

```powershell
npx supabase status
npx supabase test db --local
```

The protected `Quality checks` GitHub Actions job runs architecture validation, JavaScript unit/regression tests, ESLint, Vite production build, and local PostgreSQL/pgTAP tests. At completion of stage 1.5.2 the suite had 81 JavaScript tests and 335 SQL checks; counts can change as the suite grows.

## Main features

- Teacher/student sign-in and invited student onboarding; protected password-reset flows.
- Reusable password change form and idle session logout (teacher 90 minutes; student 60 minutes, warning 2 minutes before logout).
- One-off and recurring lessons, availability blocks, reschedules, cancellations and learning pauses.
- Student tariffs, payment ledger, currency handling, tax rules and student financial-access policy.
- Materials, collections, assignments, notifications and due-date reminders.
- Ukrainian, Russian and English user interface.

## Deployment and safety

Vercel builds the frontend from Git; the `vercel.json` SPA rewrite is necessary for direct route navigation. Edge Functions and database migrations are separately managed through Supabase. **A Vercel deployment does not automatically apply Supabase migrations.**

Never run local integration tests against a linked or production database. Do not run `db reset` against a database containing valuable data. Never commit `.env.local`, `service_role` credentials, real student data or database backups.

Read [release runbook](docs/RELEASE_RUNBOOK.md) before merging, deploying Edge Functions or applying database migrations. For architecture see [ARCHITECTURE.md](docs/ARCHITECTURE.md).
