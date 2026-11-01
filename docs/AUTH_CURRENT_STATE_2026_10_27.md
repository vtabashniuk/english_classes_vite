# English Classes CRM — current authentication status (27 October 2026)

This is the current implementation **as inferred from source archive (6)**, checked against the prior local Gate 4 reports; this document is **not** a fresh inspection of Supabase Production settings. The older Gate 0–4 documents are historical testing logs and can describe earlier states.

## Account entry and role model

- Public self-registration is not a supported onboarding path. The Supabase `crm_before_user_created_hook` is configured locally with `enabled = true` and admission logic requires an authorized invitation. Never rely solely on hiding a signup button; the hook and server authorization are critical.
- Teacher accounts are provisioned administratively. The public Auth create-user callback defaults to `student`; unauthenticated metadata does not grant `teacher` privileges.
- Student invitations support email/password and Google invitation modes (explicit discriminator). Email invitations and first-time Google onboarding use server-controlled admission. Pending Google invitations can be viewed, cancelled/reissued and accepted only by the designated signed-in identity.
- Email login, password setup/recovery, password change with current password, email callback, session protection and Google callback/acceptance pages are implemented.
- Google is opt-in at frontend through `VITE_GOOGLE_OAUTH_ENABLED`. This UI flag does NOT enforce authorization; role/link checks and server-side gates do.
- Google identity linking for an existing verified-email account can occur without a new Auth user being created. Before User Created Hook alone does not prevent that; test teacher account linking deliberately before rollout.
- Teacher and student session inactivity periods: 90 and 60 minutes respectively, warning 2 minutes before expiry (client side). Protected routes require active profiles and appropriate roles.

## Local development: explicit origin

- Standard Vite dev origin: `http://127.0.0.1:5173` (if port 5173 is unavailable, Vite may use another port; align the Auth redirects). All three must match: Vite origin, root `VITE_APP_URL`, and Supabase local Auth `site_url` / `additional_redirect_urls`.
- Local Supabase provider credentials are injected with `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `_SECRET`, not tracked in Git. The server-side `APP_URL` for the invite Edge Function belongs in ignored `supabase/functions/.env`, **not** the frontend `.env`.
- Callback paths: `/auth/google/callback`, `/set-password`, `/reset-password`. The Google Cloud OAuth redirect URI points to the Supabase Auth callback endpoint (not the frontend callback page).

## Status split: verified vs unknown

- **Local code and previously recorded tests:** invitation-only Google activation, malicious signup denial, email invitation continuity, callback and linked profiles were verified during Gate 4; latest archive (6) includes corresponding migrations, pages and tests. Re-run local tests after changes.
- **Last user-confirmed Production state:** Auth Hook ON, legacy email invitations working; exact current Google Auth provider toggle, frontend feature flag, deployment revision, SMTP setup, and applied Gate 4 migrations have **not** been re-verified by this audit. Do not state Production Google onboarding as live without confirming it.
- **Release gates:** CI JS tests, local SQL pgTAP/RLS and Auth HTTP scenarios, linked migration list dry-run, separate Production release approval. Do not use `db reset` against linked/Production DB, and do not copy development callback URLs into Production config.

## Relevant source files

`src/router.jsx`, `src/pages/GoogleAuthCallback/`, `src/pages/GoogleInvitationAcceptance/`, `src/features/auth/api/`, `src/features/students/api/studentInvitesApi.js`, `supabase/functions/invite-student/index.ts`, `supabase/config.toml`, `supabase/migrations/20261025*`.
