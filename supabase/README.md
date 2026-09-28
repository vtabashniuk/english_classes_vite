# Supabase backend source

## Edge Functions

`functions/invite-student/index.ts` contains the current student invitation function.

The function expects Supabase-provided environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

It also supports:

- `APP_URL` — canonical frontend base URL used for the invitation redirect. If it is not set, the current production URL is used as a fallback.

## Database

The production database currently contains application tables, RLS policies, constraints, indexes and PostgreSQL RPC functions that are not yet represented as repository migrations.

Before the next schema change, establish a migration baseline and commit subsequent changes under `supabase/migrations/`.
