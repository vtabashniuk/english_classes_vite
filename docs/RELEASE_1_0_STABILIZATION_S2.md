# Release 1.0 stabilization — S2 (revises S1)

**Source:** `english_classes_vite(6).zip` plus previous S1 changed-files patch; only changed files are included in delivery. **No Production modifications performed.**

## Decisions

- **F-01:** Real `/student-area/balance` page restored in sidebar. Uses `getStudentFinanceOverview` (same read model as teacher student card) and shared `getStudentBalanceDisplay` helper for currency and amount. Student data scoped to the student's active teacher relationship. No duplicate persisted balance. Separately show per-currency balances, no silent FX conversions. Teacher can publish payment recipient/IBAN/bank/purpose/notes/HTTPS payment URL/HTTPS QR-image URL for UAH, USD, EUR. Nothing is published by default and internal CRM account references are not leaked.
- **F-02:** Keep S1 `scripts/check-release-archive.mjs` to detect accidental nested `.env` / `supabase/.temp`, irrespective of whether those files were unintentionally included in an archive. Library cleanup in ChatGPT is independent of Git/ZIP hygiene.
- **F-03:** Restore the standard Vite port 5173, align local `.env.example`, `supabase/config.toml` and local docs. The old S1 port 3000 override is superseded. Changing the sample does NOT rewrite ignored `.env.local` / `supabase/functions/.env` on user's computer.
- **F-04:** Privileged `service_role` finance RPC happens **after** teacher profile validation and RLS-visible payment ownership check. This prevents a 403 occurring only after a foreign reporting record was already written. Test two distinct teachers and payments in local integration; Node static tests alone are insufficient. S2 carries forward S1 fix.
- **F-05:** `docs/AUTH_CURRENT_STATE_2026_10_27.md` is the current implementation overview; historical Gate docs remain historical. Production Google/provider state is NOT assumed from local code.

## Security and deployment

- New migration: `supabase/migrations/20261027120000_teacher_payment_instructions.sql`, with RLS teacher edit and active linked student published-only select. Neither payment data nor online transactions are stored here. Do **not** run `db push --linked` until separate Production approval.
- External QR image is an HTTPS URL to a teacher-hosted image. This patch does not upload images or generate QR automatically. Linking to an external host may expose the student's browser request; choose a trusted image host. If you want a direct image upload/automatic QR generator, it should be a separate scoped enhancement.
- Publish defaults OFF; teacher must enable it per currency. Do not put CVV, card PIN, API keys or secrets into these student-facing fields.
- Verify sample local data only, on an isolated Supabase environment. For sensitive multi-teacher isolation tests, use two disposable teachers and students and confirm both published and unpublished states.

## Verification commands (Windows PowerShell)

```powershell
node --test tests/*.test.js scripts/tests/*.test.mjs
npm run check:architecture
node scripts/check-release-hygiene.mjs
npm run lint
npm run build
npx supabase test db --local
```

If local Supabase has previously run with port 3000 auth settings, restart local services only after updating your ignored `.env` / function `.env` values and local redirect allowlist for 5173; never change Production Auth settings to localhost. Validate both email setup and Google callback if local Google provider is configured.

## Acceptance criteria

1. Teacher's and student's current balance for the same student, teacher and billing currency are identical, including zero/default and negative cases.
2. Historical ledger remains unchanged. Only teacher can record or correct payment; student page is read-only.
3. Students cannot see unpublished details or any unrelated teacher's records; teacher cannot update another teacher's instructions.
4. Published payment instructions appear for relevant currency only. HTTPS link and QR-image display work; missing data is a graceful empty state.
5. Node suites, lint, build, local pgTAP and cross-user Edge Function integration are green before merge/deploy.
