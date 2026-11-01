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

The checked-in Vite development server uses the standard **`http://127.0.0.1:5173`**; this matches the local Auth Site URL, callback allowlist, `.env.example` and Edge Function `APP_URL` documented for local tests. Open Vite using **127.0.0.1**, not `localhost`, so the origin matches the configured redirects. Check the actual port printed by Vite: if 5173 is occupied, Vite may choose another port. Update local Auth URL/redirect allowlist and app URL together, or free port 5173. Keep Production Auth settings separate from this local configuration.

Start Vite:

```powershell
npm run dev
```

**Safety:** Localhost Vite may still use **Supabase Cloud** if `.env.local` points to the cloud. Before testing passwords, payments, invitations or data modification, confirm the backend URL and use disposable test accounts.

## Run checks

```powershell
npm run check:architecture
node --test tests/*.test.js
node --test scripts/tests/*.test.mjs
npm run lint
npm run build
npx supabase test db --local
```

SQL tests require the local DB; they use synthetic fixtures with transaction rollback. Do not use `--linked` for test runs. `db reset` destroys data in the target database; avoid it unless intentionally recreating a disposable local database.

## Auth email tests

Local Auth sends mail to Mailpit, visible through the local Supabase stack; it does not send external email. The standard Supabase Cloud mail service has restrictive limits. Custom SMTP and a verified sending domain are deferred until the user acquires the production domain.

## Windows troubleshooting

If `npm ci` fails on `EPERM` while removing a Rolldown `.node` binary, stop running Vite/Node processes that hold the file, then rerun `npm ci`. Only if necessary, remove **local** `node_modules` and reinstall. Removing `node_modules` does not remove code or database records.

## Student balance and payment instructions (S2)

Requires local migration `20261027120000_teacher_payment_instructions.sql`. Teacher edits public payment instructions for UAH/USD/EUR on their Settings page; student sees published items in `/student-area/balance`. These are informative only; recording received payments remains the teacher's existing manual finance workflow. A QR image is entered as a trusted public HTTPS image URL; no file upload or payment gateway has been added.
