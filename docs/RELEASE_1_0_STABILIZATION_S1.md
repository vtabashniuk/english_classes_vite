> **Historical S1 note. Superseded by S2:** balance link is restored with a real page; port is back to 5173. Follow `docs/RELEASE_1_0_STABILIZATION_S2.md` for the current patch.

# Release 1.0 stabilization — S1

Prepared from `english_classes_vite(6).zip` (2026-10-27). Source ZIP was supplied for static/local testing; **this patch does not change Production**. Apply to a reviewed local branch rather than copying directly into deployed environments.

## Scope

- F-01: Removed a broken sidebar link to `/student-area/balance`. The underlying student balance page is not implemented; its addition is a separate product decision. No existing finance flows were changed.
- F-02: Added `scripts/check-release-archive.mjs`, validating the **actual** ZIP central/local filenames. It rejects `.env` secrets, Supabase `.temp` and `.branches`, raw ZIP-in-ZIP, generated directories, unsafe paths and symlinks. This is a file/path guard, **not** a comprehensive content secret scanner.
- F-03: Made Vite dev use `http://127.0.0.1:3000` by default, with strict port. This matches the local Supabase Auth config and `.env.example`. Production Vercel settings remain independent.
- F-04: In `resolve-payment-tax`, the authenticated user's RLS-scoped query on `payments` must find a payment owned by their teacher ID before a `service_role` RPC can create/finalize reporting rows. Unauthorized and missing payments return `403`, RLS/query errors return `500` without privileged mutations. Existing ownership checks on the resulting reporting and accrual rows remain intact.
- F-05: Updated local setup, release runbook, architecture and legacy Gate 4 release-hardening notes.
- No migrations, public page texts, or invitation/Auth Hook configuration modified.

## Apply safely (Windows PowerShell)

1. Ensure local changes are committed/backed up; use a `fix/release-1-stabilization-s1` branch from the exact revision used to create archive (6). Inspect for any newer local edits before overwriting the 11 files in this patch.
2. Extract the patch ZIP **into the project root** preserving subfolders.
3. Review changes: `git diff --check`, `git diff --stat`, `git status --short`. Do not stage secrets, backups, local Supabase files or archives.
4. Run:

```powershell
node --test tests/*.test.js
node --test scripts/tests/*.test.mjs
npm run check:architecture
node scripts/check-release-hygiene.mjs
npm run lint
npm run build
npx supabase test db --local
```

For SQL tests use only the isolated local Supabase DB. The packaged code has not been validated against the user's current local DB or Production.

5. Check local Auth flows on `http://127.0.0.1:3000`: student navigation; email login, invite, password recovery; Google callback and invite activation if local Google OAuth configured; verify teacher and student roles. Confirm your local `.env.local` and local Supabase `site_url` target the same origin. Avoid using real student data for testing.
6. **Finance authorization integration gate before deployment:** create two disposable teachers A and B and one succeeded payment belonging to B in the isolated local DB. As teacher A invoke `resolve-payment-tax` with B's payment ID. Expect `403` and assert **no new or changed** `payment_reporting_values` or `payment_tax_accruals` rows for B's payment. As teacher B invoke on B's payment and verify normal behavior (allow for NBU external service availability). Test unknown UUID as teacher A (expect `403` and no mutations). A static regression test exists, but **this cross-user database/Edge Function test is not included in the Node suite**.
7. Only then PR + CI, and separately review whether Vercel merge deploys Production. If deploying the modified Edge Function, do so through a separately approved backend release; changing local source is insufficient to update running Edge Functions.

## ZIP packaging policy

- Normal source releases: after **committing** and reviewing changes, use `git archive --format=zip --output=release.zip HEAD` in the repository root. The archive contains `HEAD` source and **does not include uncommitted edits**. Always verify the commit contains all intended files.
- Verify any archive before sharing: `node scripts/check-release-archive.mjs release.zip`.
- Do not zip a working folder wholesale; never include `.git`, `node_modules`, `dist`, `supabase/.temp`, `supabase/.branches`, local `.env*`, private keys or personal exports.
- This S1 delivery is intentionally a **changed-files-only ZIP**; it is not a full source release.
- A ZIP passing the filename guard can still contain inline credentials in otherwise normal source files; review diffs and sensitive config before publication.

## Verification performed in the isolated assistant runtime

- Node.js source suites **127/127 PASS** (baseline 120/120; +7 tests).
- `node scripts/check-architecture.mjs` PASS.
- `scripts/check-release-archive.mjs` reports unsafe paths in the user's original ZIP (6).
- No `npm ci`, lint, production Vite build, local PostgreSQL/pgTAP or Edge Function HTTP integration in the isolated runtime. Run the above commands locally and in CI; there are no assumptions about Production deployment state.
