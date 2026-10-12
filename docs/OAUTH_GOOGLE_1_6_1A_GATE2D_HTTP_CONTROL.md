# CRM OAuth 1.6.1a — Gate 2d: local HTTP integration control

## Scope

This is a standalone, **LOCAL-only** end-to-end test of the real
`supabase/functions/invite-student/index.ts` via HTTP. It adds NO migration, hook,
frontend change, or Production configuration. It does not test Google OAuth
login; that comes after server-side admission control is built.

Checks:

- Valid, active teacher JWT and `google_no_email` creates one pending record for
  the authenticated teacher (ignoring caller-provided `teacherId`).
- The Google branch creates **no** `auth.users`, `profiles`, or `teacher_students`
  record, and sends no email to Mailpit.
- Repeated Google invitation returns the same UUID without duplicates or mail.
- Requests without authorization (401), from a student (403), or with an
  unsupported invitation method (400) fail.
- Omitting `invitationMethod` preserves the legacy email invitation: one Auth
  user, student profile, teacher relationship, and exactly one Mailpit message.
- Cleanup deletes only disposable Auth users created for this particular run;
  related pending invitations are removed via the existing teacher FK cascade.
  Mailpit messages are intentionally not deleted.

## Preconditions

1. Work on `feature/oauth-google`, with Gate 2a + 2b locally migrated and
   Gate 2c committed. Do not switch `.env.local` to a Cloud database.
2. Restore `supabase/config.toml` if the temporary Gate 1 observer is still
   enabled; do **not** use the observational hook for Gate 2d.
3. Docker Desktop running; local Supabase running on API `54321`, database
   `54322`, Mailpit `54324`.
4. Node.js 24 and project dependencies installed.

## Run: two PowerShell terminals

**Terminal A** (from the CRM root):

```powershell
npx supabase status
npx supabase functions serve invite-student --no-verify-jwt
```

Leave the `functions serve` process running. The `--no-verify-jwt` flag is
**local-only**, permits the unauthenticated 401 test to reach the handler, and
must **never** be used when deploying Production. The Edge Function itself
continues to verify the user with Supabase `auth.getUser()` and role checks.

**Terminal B**, from the same root (do not paste or print the status keys):

```powershell
$localStatus = npx supabase status -o env
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase status failed' }
$env:CRM_SUPABASE_LOCAL_STATUS = $localStatus -join "`n"
try {
    node scripts/oauth-local-invite-http.mjs
}
finally {
    Remove-Item Env:CRM_SUPABASE_LOCAL_STATUS -ErrorAction SilentlyContinue
}
```

The script refuses non-local URLs, checks the exact expected Docker DB
container/ports, and never accesses `VITE_*` variables, `.env.local` or Cloud.
It doesn't run `npx` internally (avoids earlier Windows `spawnSync` timeout).

Expected summary when all checks pass:

```
GATE 2d PASS: 18 HTTP/database/Mailpit assertions.
Local cleanup: deleted 3 disposable Auth users; pending invitation cascades with teacher profile.
```

If the function returns an error to the initial `OPTIONS` request, check the
`functions serve` process and its startup logs first. A `FUNCTION_INVOCATION_FAILED`,
403, 404, or 500 while testing often indicates the local runtime is not served,
not a Production issue. Do not respond by resetting the local DB.

If email invitation fails due to a local SMTP rate limit, do not weaken the
assertions. Inspect the local Edge Function logs and Mailpit at
`http://127.0.0.1:54324`, and send the redacted error output for review.

The script prints no credentials. Never send `supabase status -o env`, JWTs,
service-role keys, or Mailpit message bodies in your reply.

## After a pass

- Confirm `git status -sb` has no unexpected `config.toml` changes.
- Commit the two Gate 2d files only, once tests pass; Gate 2d does not need a
  separate Production deployment.
- Move to server-side Auth admission and Google first-login activation.
- **Do not** call `supabase db push --linked`, deploy the changed Edge Function,
  enable Google Provider, or merge `feature/oauth-google` into `main` yet.

## Known limitations

A green result does **not** prove the real Google OAuth flow, identity linking,
first-login activation, or blocked self-signup. These are future security gates.
The script requires local Auth, Mailpit and Edge Functions to be running, so it
is not part of the normal `node --test tests/*.test.js` CI suite.
