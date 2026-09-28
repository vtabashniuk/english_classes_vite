# Refactor notes — 2026-09-28

## Completed

- Removed direct Supabase access from pages/components/context.
- Added feature-specific API modules for Auth, profiles, students, lessons, recurring lessons, lesson requests, notifications, materials, assignments and teacher settings.
- Moved the Supabase client to `src/shared/api/supabaseClient.js`.
- Consolidated duplicated dashboard notification/request indicator logic into `features/dashboard/hooks/useDashboardIndicators.js`.
- Extracted TeacherSchedule date/calendar utilities and backend error mapping from the page component.
- Reduced `TeacherSchedule.jsx` from about 2050 lines to about 1580 lines without changing its UI flow.
- Added an architecture guard script: `npm run check:architecture`.
- Added the `invite-student` Edge Function to repository source control.
- Hardened the Edge Function redirect so it uses server-configured `APP_URL` (with the current production URL as fallback) instead of trusting the request Origin header.
- Added Supabase architecture audit and reviewed SQL drafts.

## Verification performed in this environment

- All JS/JSX files parse successfully with the TypeScript parser in JSX mode.
- All relative imports resolve to existing local files.
- The architecture guard passes.
- The same Supabase tables/Auth operations/Edge Function used by the original source are still represented in the refactored data layer.

A full `npm run build` / `npm run lint` could not be executed in the sandbox because dependencies are not bundled in the uploaded project and the environment cannot fetch one missing npm package from the registry. Run locally after `npm ci`.

## Backend follow-up

- `supabase/sql/20260928_rpc_and_rls_hardening.sql` is a reviewed hardening script but should be applied only after the refactored frontend is smoke-tested.
- `supabase/sql/DRAFT_teacher_student_relationship.sql` is deliberately a draft. The current installation infers a student's teacher; the relationship should become explicit before multi-teacher support or deeper finance logic.
