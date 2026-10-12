# Local setup and environment isolation

## Prerequisites

Windows PowerShell, Node.js 24.x, npm, Docker Desktop and the repository. Use `npm ci` to reproduce the locked dependency tree; use the same major version as GitHub CI when possible.

## Prepare the frontend

```powershell
npm ci
Copy-Item .env.example .env.local
```

Edit `.env.local` with *public* Supabase URL/anon credentials for the intended environment. These three variables are read by the frontend:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | URL of the selected Supabase backend |
| `VITE_SUPABASE_ANON_KEY` | Browser public/anon key — **never** `service_role` |
| `VITE_APP_URL` | Frontend origin for password reset links (`/reset-password`) |

`.env.local` is intentionally ignored by Git. The sample `.env.example` contains no live credentials.

For **isolated local** SQL/Auth testing, start Docker Desktop and run:

```powershell
npx supabase start
npx supabase status
```

The local API normally listens at `http://127.0.0.1:54321`; database port 54322, Studio 54323 and Mailpit 54324 are configured in `supabase/config.toml`. Use the actual values printed by `supabase status` rather than assuming they are unchanged.

When using local Auth through the frontend, ensure the local Auth Site URL and allowed redirect URLs match the frontend's actual origin, commonly `http://localhost:5173`; the checked-in default `supabase/config.toml` does not currently target this Vite port. Keep any environment-specific auth configuration separate from Production unless it is reviewed and intended for commit.

Start Vite:

```powershell
npm run dev
```

**Safety:** Localhost Vite may still use **Supabase Cloud** if `.env.local` points to the cloud. Before testing passwords, payments, invitations or data modification, confirm the backend URL and use disposable test accounts.

## Run checks

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
npx supabase test db --local
```

SQL tests require the local DB; they use synthetic fixtures with transaction rollback. Do not use `--linked` for test runs. `db reset` destroys data in the target database; avoid it unless intentionally recreating a disposable local database.

## Auth email tests

Local Auth sends mail to Mailpit, visible through the local Supabase stack; it does not send external email. The standard Supabase Cloud mail service has restrictive limits. Custom SMTP and a verified sending domain are deferred until the user acquires the production domain.

## Windows troubleshooting

If `npm ci` fails on `EPERM` while removing a Rolldown `.node` binary, stop running Vite/Node processes that hold the file, then rerun `npm ci`. Only if necessary, remove **local** `node_modules` and reinstall. Removing `node_modules` does not remove code or database records.
