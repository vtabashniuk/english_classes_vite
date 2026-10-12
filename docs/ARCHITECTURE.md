# CRM architecture (as of 2026-10-12)

## Runtime structure

```text
Vercel: React 19 / React Router 7 / Vite 8
  pages + layouts + shared UI (toast, pagination, i18n)
      ↓
  src/features/* (components, hooks, lib, API)
      ↓
  src/shared/api/supabaseClient.js (browser anon key only)
      ↓
Supabase: Auth + PostgreSQL (RLS, RPC, triggers, migrations)
          + Edge Functions + local pgTAP integration tests
```

The frontend has no direct Supabase client import in its UI; `npm run check:architecture` enforces this boundary.

## Implemented domains

- `features/auth`: auth APIs, password-change service/form, invite/recovery authorization, idle logout guard.
- `features/students`, `features/profiles`, `features/studentLifecycle`: teacher/student relationships and access lifecycle.
- `features/studentFinancialAccess`: student access policy based on debt and authorized overrides.
- `features/lessons`, `features/lessonRequests`, `features/schedule`: lesson slots, requests, blocks, recurring lessons, reschedules and cancellations.
- `features/finance`: transactions, monetary formatting and tax-related application logic.
- `features/materials`, `features/assignments`: material catalogue/collections, grants and assignments.
- `features/notifications`: notifications and their read states.
- `features/settings`, `features/dashboard`: settings and dashboard state.
- `src/locales/{ua,ru,en}`: UI translations.

The SQL migrations under `supabase/migrations/` are the schema source of truth. Rules requiring consistency across rows, financial ledgers or users must be enforced by the database (RLS, constraints, triggers/RPC), not only by UI checks. Never mutate stored payment operations to recompute balances; use the implemented ledger/compensating operations.

## Meeting links and materials

Lesson meeting links are provider-neutral `meeting_url` values; UI may identify Zoom, Google Meet or Microsoft Teams for display. Materials are stored as metadata, descriptions, tags and external resources, with teacher/student access enforced by the backend.

## Auth and deployment boundaries

- The frontend receives **public** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only.
- Privileged Supabase keys are restricted to backend Edge Functions and carefully controlled local-only administrative scripts.
- Existing student invitations, password recovery and manual password changes have different authorized flows.
- The activity timeout is enforced in the application (90 minutes teacher, 60 minutes student, warning 2 minutes before); it is not a claim of server-side JWT revocation or a change in browser storage when a tab closes.
- Merging to protected `main` may trigger Vercel deployment, whereas database migrations and Edge Functions are deployed separately.

## Testing and delivery

`Quality checks` in `.github/workflows/ci.yml` runs npm install from lockfile, architecture validation, JavaScript tests, ESLint, Vite build, a Docker-backed local Supabase DB, and pgTAP tests. The `main` ruleset requires the check to succeed before merging a Pull Request.

See `docs/LOCAL_SETUP.md` and `docs/RELEASE_RUNBOOK.md`. External OAuth (Google, Apple, Microsoft) and online payment-provider integration remain separate planned work, not completed functionality.
