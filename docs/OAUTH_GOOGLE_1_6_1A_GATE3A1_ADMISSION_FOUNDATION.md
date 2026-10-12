# Google OAuth — 1.6.1a / Gate 3a.1: email admission foundation

**Status: implemented as a dormant database mechanism, not activated.**

## Why

Gate 0 proved `signUp({ options: { data: { role: 'teacher' } } })` could promote itself before Gate 2a.
Gate 1 observed that `inviteUserByEmail()` and ordinary signUp look effectively identical to
Supabase's `Before User Created Hook`; neither `user_metadata.role` nor `app_metadata.provider = email`
is authorization evidence. Gate 2a removed role escalation; Gate 2b–2d introduced/tested pending Google
invitations and preserved the original email invitation flow.

## Trust boundary and flow

1. **Future Gate 3a.2**: Only `invite-student` (after authenticating an active teacher) may call
   `issue_email_invitation_admission(teacher_id,email)` via its service-role client.
2. The RPC validates the active teacher, normalizes the email, refuses an existing account,
   creates a two-UUID-v4 (roughly 244-bit) unpredictable one-use ticket and persists **only SHA-256**.
   The ticket expires after **10 minutes**. The server MUST NOT print it or return it to the browser.
3. **Future Gate 3a.2**: the server passes that ticket only as
   `data.crm_email_invite_ticket` to Supabase's `admin.inviteUserByEmail()`.
4. When explicitly enabled, `crm_before_user_created_hook(event)` checks provider=`email`,
   target email, ticket hash, expiration, unused status and active issuing teacher. It atomically
   marks one matching ticket consumed. No valid ticket -> `403` error. Google signups are denied
   by this *email-only* hook; Gate 3b needs its own independently proved Google admission path.
5. If `inviteUserByEmail()` fails, the server revokes the ticket via its service-role client.
   Cleanup of the ticket after a successful invite and potential Auth metadata sanitization
   will be determined by the real integration test. Tickets are one-use in all cases.

## Installed in Gate 3a.1

- `crm_private.email_invitation_admissions`: no direct browser access (RLS enabled).
- `public.issue_email_invitation_admission` and `revoke_email_invitation_admission`:
  **service_role only**, never exposed to `anon` or `authenticated`.
- `public.crm_before_user_created_hook(event jsonb)`: callable by `supabase_auth_admin`,
  not browser roles. Uses a fixed empty search path and private table access.
- SQL file `13_email_invitation_admission_foundation.sql`, **31 assertions** (synthetic;
  transaction rolled back).

There is **no change** to `supabase/config.toml` or to the Edge Function in this ZIP.
As a result, **the Auth Hook does not execute on live registrations** at this stage.
The SQL tests invoke the hook directly; they cannot prove the real GoTrue invite flow.

## Local installation/check (only feature/oauth-google)

```powershell
npx supabase migration list --local
npx supabase migration up --local
npx supabase test db --local
node --test tests/*.test.js
npm run check:architecture
npm run lint
npm run build
```

Expected **13 SQL files / 402 SQL assertions** (371 existing + 31 new) and **90 JS tests**.
These are expectations, not claims that the tests have already passed in your environment.

**DO NOT** deploy this migration, enable the hook in Cloud Dashboard, change `auth.enable_signup`,
commit a temporary `supabase/config.toml` observer setup or call `db reset`.
If local checks fail, inspect the first failing SQL statement before making any Auth config changes.

## Gate 3a.2 acceptance criteria (not completed here)

- Against local Supabase Auth, `inviteUserByEmail()` carries `data.crm_email_invite_ticket`
  into the actual Before User Created event and creates exactly one student UUID/profile/link.
- Hook enabled only in an isolated *local* check; unauthenticated `signUp` with a fabricated
  teacher role, an arbitrary student role, or an already-invited email **without the ticket** fails.
- Bad, expired, reused or wrong-email tickets are rejected; legitimate invitation does not break.
- Local teacher fixture users are created **before** the restrictive hook is enabled (Gate 2d's
  baseline helper uses `admin.createUser`, which may be rejected under the restrictive hook).
- Behavior on invitation errors/rollback is verified; no tickets are logged; no client-visible
  ticket leakage; no OAuth provider enabled yet.
- `supabase/config.toml` is restored and inspected before commit. Production remains untouched.

## Open deployment issue

The Gate 2a role-escalation fix is tested only locally and is not yet deployed to Cloud.
Handle a separate production security hotfix with verified authorization and rollback plan.
Do not merge unfinished Google admission work into Production in order to deploy Gate 2a.
