# OAuth Google 1.6.1a — Gate 3b.1: Production Auth Security Preflight (READ ONLY)

**Branch:** `feature/oauth-google`. **Goal:** independently confirm current cloud readiness before proposing a separate, expressly authorized deployment/activation. **This gate must not change Production data, migrations, functions, secrets, Auth settings, or accounts.**

## Evidence already known — and not yet known

- Gate 3a.2-A: 22/22 local HTTP/Auth/DB/Mailpit PASS.
- Gate 3a.2-B: 36/36 local Hook-ON checks PASS. Hook returned OFF afterward.
- Gate 3a.2-C: offline and local Auth-path readiness checks PASS, committed; GitHub Actions PASS.
- The Supabase Production state **is not established by local tests or CLI config.toml**. Treat it as `UNKNOWN` until the read-only inspections below are completed.
- `supabase/config.toml` controls the local CLI stack; the cloud Auth Hook is configured separately in the Production Dashboard.
- This preflight is for **email invitation admission only**. Google OAuth and Google sign-in activation remain out of scope.

## 0. Guardrails (do this first)

- Work only in the root `D:\Projects\english_classes_vite` on `feature/oauth-google`.
- Do not run `db push`, `db reset`, `migration repair`, `migration up/down`, `functions deploy`, `secrets set`, `link` to a different project, or change any Dashboard setting.
- Do not create test users or send test invitations to Production during Gate 3b.1.
- Do not paste access tokens, database URLs/passwords, anon/service-role keys, SQL function bodies, production emails or personal data into chat/Git.
- Existing local `.env.local` and Docker settings can stay as they are; no need to switch frontend to Production or start the local database.
- An Admin `createUser()` call is privileged provisioning and is not proof the Hook rejected public signup.

## 1. Offline repository review — no network

Unpack this ZIP into the project root, preserving folder paths, then:

```powershell
node scripts/oauth-gate3b1-offline-preflight.mjs
```

Expected: `GATE 3b.1 LOCAL REVIEW PASS: 15 checks.` It confirms *local code/config posture only*. If it reports an error, stop — do not bypass the guardrail to get PASS.

## 2. Read-only Production migration history (via linked Supabase CLI)

Your existing linked project should be `zqanhujauejfaxywqckc`. Confirm the link without changing it:

```powershell
Get-Content .\supabase\.temp\project-ref
```

Check that it prints **exactly** `zqanhujauejfaxywqckc` before proceeding. The project reference is not a key. If the file is absent or points elsewhere, **stop**. Do not re-link during this preflight.

Next, read (do NOT push) migration history:

```powershell
npx supabase migration list --linked
```

Review and record separately whether these dependencies exist in **REMOTE** column:

| Migration | Purpose | Required before eventual Hook ON? |
| --- | --- | --- |
| `20261012172000` | Ignore untrusted signup role | Yes; inspect if missing |
| `20261012200000` | Private schema, pending Google invitations and RPC | Yes (dependency of private admissions schema) |
| `20261012232000` | Private admission table, issue/revoke RPC and Hook | Yes |

`LOCAL only` rows mean these changes are **not yet present remotely**; that is acceptable for the preflight but **blocks activation**. Also examine every unrelated `LOCAL only` migration: never use `db push` automatically because it can apply a larger backlog than the email admission feature needs. Differences in history need investigation rather than `migration repair`.

If the CLI cannot access the linked database, stop this substep and report the access issue (redact credentials), rather than trying a write command.

## 3. READ-ONLY Production SQL audit (Supabase Dashboard)

Open Supabase Dashboard for the project reference above → **SQL Editor**. Check you are in the correct **Production project**. Open file:

`supabase/audits/20261018_gate3b1_production_readonly.sql`

Paste its SQL into the editor and run it. The SQL is enclosed in `BEGIN TRANSACTION READ ONLY` / `COMMIT`; it runs only catalog metadata checks using `SELECT`. It does **not** query user records, raw token values, invitation emails or secret values. Result is 17 rows with `READY` or `NOT_READY`.

Important interpretation:

- `READY` means a given structural permission/configuration prerequisite exists in the Production DB; it **does not prove** the cloud Auth Hook is currently enabled, nor that the live Edge Function matches the tested code.
- If `NOT_READY` arises because a migration is absent, classify as **needs future deployment**. Do not apply it in this gate.
- If all required objects exist but privileges differ, classify as **investigate mismatch**. Do not auto-fix with GRANT/REVOKE.
- An SQL error is not a PASS. Report the error text only, with any sensitive details redacted.

The full set of results may be shared because only check IDs and readiness booleans are returned.

## 4. Read-only Production Dashboard checklist

Record the following facts manually, without touching toggles or copying secret values:

| Read-only item | Target for later release | Evidence/status |
| --- | --- | --- |
| Auth → Hooks → Before User Created | OFF now; no other unexpected Hook in use | UNKNOWN |
| Auth → Providers → Email | Enabled; current sign-up policy verified | UNKNOWN |
| Auth → Providers → Google | OFF until separate Google gate | UNKNOWN |
| Auth → other providers | Confirm no unexpected public sign-up method | UNKNOWN |
| Auth → General / Advanced | Anonymous and phone signup, user creation/linking policies reviewed | UNKNOWN |
| Auth → URL Configuration | Site URL = Production domain; exact `/set-password` redirect allowed | UNKNOWN |
| Edge Functions → `invite-student` | Deployment revision / date identified; compare to Gate 3a.2-B | UNKNOWN |
| Edge Functions → Secrets | `APP_URL` configured for Production; others present **without revealing values** | UNKNOWN |
| Auth → SMTP / email rate limits | Email sending configured and within capacity | UNKNOWN |
| Access / team permissions | Service-role secrets and privileged DB/admin access tightly limited | UNKNOWN |
| Backups and incident operations | Recovery approach, responsible person, rollback window documented | UNKNOWN |

**Crucial:** the `config.toml` comment saying Hook OFF is only a **local** fact. Verify remote Hook status in the Dashboard, do not infer it from Git.

Never enable Google or the Hook during preflight. Existing Production teachers and students should not be modified. Avoid test email invitations until a separate, approved release window.

## 5. Decision gate and future deployment sequencing — informational only

**GO for a future change proposal**, *not* for deployment, requires: correct linked reference, migration backlog fully understood, read-only SQL prerequisites classified, cloud Auth configuration recorded, deployable function revision identified and rollback documented.

If Foundation migration is absent, the next phase needs an explicit migration rollout plan with a reviewed full migration delta; then a separately approved Edge Function deployment; only then may a later phase consider enabling the Production Hook. The exact order must prevent a period where a Hook blocks legitimate invites.

Post-release smoke tests (when separately approved) will need existing-account sign-in, password reset, legitimate invite to a controlled mailbox, correct profile/teacher link, consumed ticket, scrubbed metadata, denied public signup and SMTP/redirect confirmation. These are **not** Gate 3b.1 tasks.

**Rollback caution:** switching Hook OFF restores the old sign-up exposure. Rollback must be explicitly authorized and accompanied by short-term monitoring/mitigation; reverting Vercel alone does not restore Auth/DB settings. Never delete real users or undo applied migrations as an emergency shortcut.

## 6. Git check and sharing results

```powershell
git diff --check
git diff -- supabase/config.toml
git status --short
```

Expected changes from this patch: only three **new** files:

- `scripts/oauth-gate3b1-offline-preflight.mjs`
- `supabase/audits/20261018_gate3b1_production_readonly.sql`
- `docs/OAUTH_GOOGLE_1_6_1A_GATE3B1_PRODUCTION_PREFLIGHT.md`

Do **not** commit until results have been reviewed. Send back: offline PASS, `migration list --linked` (migration timestamps only; no credentials), 17 SQL audit statuses, and redacted Dashboard checklist. Missing migrations or `NOT_READY` are useful audit findings, not reasons to modify Production during this gate.

## Official documentation

- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
- https://supabase.com/docs/guides/auth/auth-hooks
- https://supabase.com/docs/reference/cli/supabase-migration-list
