# Supabase architecture audit — 2026-09-28

## Current public tables

- profiles
- teacher_settings
- lessons
- recurring_lessons
- lesson_requests
- notifications
- materials
- student_materials
- assignments
- assignment_materials

RLS is enabled on all public application tables.

## Strong points

- Roles and business statuses use PostgreSQL enums.
- Lesson overlap is protected at database level with exclusion constraints for both teacher and student.
- Lessons enforce a valid time range and duration limits.
- Recurring lessons have date/weekday/range constraints.
- Most important multi-step mutations are implemented as SECURITY DEFINER RPC functions with an empty search path.
- Assignments and notifications use read-only RLS from the client while mutations are performed through RPCs.

## Structural findings

### 1. Student-to-teacher ownership is implicit

`resolve_my_teacher_id()` currently resolves the student's teacher from the most recent lesson and, if no lesson exists, falls back to the first active teacher with settings. This is acceptable for the current single-teacher installation but is not a durable domain relationship.

Before supporting multiple teachers, introduce an explicit teacher/student relationship rather than inferring ownership from lesson history.

### 2. Some tables still permit direct client mutations

Teacher RLS policies currently permit direct INSERT/UPDATE on `lessons` and `recurring_lessons`, even though the frontend uses RPCs for the business operations. This means a client that bypasses the UI can avoid some RPC-level working-hours/weekend/state-transition rules while still satisfying table constraints.

Recommended direction: make RPCs the only client mutation path for business-critical scheduling tables and keep RLS SELECT policies for reads.

### 3. RPC grants are broader than necessary

Custom application functions currently have EXECUTE grants for `anon`, `authenticated`, and `service_role`. The functions generally perform their own authentication checks, but anonymous EXECUTE is unnecessary. Internal/helper routines also do not need to be directly callable by clients.

Recommended direction: revoke unnecessary anonymous execution and expose only the public RPC surface required by authenticated clients.

### 4. Database code is not yet version-controlled

The Edge Function is now stored with the frontend source, but the live table/RLS/RPC definitions are not yet represented as migrations in the repository. This is the main remaining architecture gap before adding Finance.

## Finance prerequisite

The current scheduling schema does not require a rewrite before Finance. Finance should be added as a separate domain after the database migration workflow is established. Suggested concepts are student account(s), immutable ledger transactions, lesson-price snapshots, and payments/provider events kept separate from the ledger.
