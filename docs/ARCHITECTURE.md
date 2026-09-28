# Application architecture

## Current direction

The UI layer does not access Supabase directly. Database tables, RPC calls, Auth calls, and Edge Functions are accessed through feature-specific API modules.

```text
pages / components
       |
       v
features/*
  api / hooks / lib
       |
       v
shared/api/supabaseClient.js
       |
       v
Supabase
  Auth
  Postgres + RLS + RPC
  Edge Functions
```

## Feature boundaries

- `features/auth` — Supabase Auth operations.
- `features/profiles` — user/student profile reads and profile RPC updates.
- `features/students` — student invitation workflow.
- `features/lessons` — lesson and recurring lesson queries/commands.
- `features/lessonRequests` — extra-lesson requests and availability.
- `features/notifications` — notification reads and mark-read RPCs.
- `features/materials` — learning materials and sharing.
- `features/assignments` — assignment reads and commands.
- `features/settings` — teacher schedule settings.
- `features/schedule/lib` — pure calendar/date utilities and backend error mapping.
- `features/dashboard/hooks` — shared dashboard indicator state.
- `shared/api` — infrastructure that is not tied to one business feature.

## Rules for new code

1. Pages and components must not import the Supabase client directly.
2. New database access belongs in the appropriate `features/<feature>/api` module.
3. Multi-table business operations should prefer database RPCs so they stay transactional.
4. Database invariants belong in Postgres constraints/RLS/RPCs; UI validation is only an additional convenience.
5. Finance should be introduced as its own feature and should not store a mutable `student.balance` as the source of truth. Balance should be derived from financial ledger entries.
6. Payment-provider integration should be kept separate from ledger transactions.

## Backend source control

The current Edge Function is now stored at:

`supabase/functions/invite-student/index.ts`

The live Postgres schema is still the source of truth until database migrations are brought under version control. Future schema/RPC/RLS changes should be captured as migrations before being applied to production.
