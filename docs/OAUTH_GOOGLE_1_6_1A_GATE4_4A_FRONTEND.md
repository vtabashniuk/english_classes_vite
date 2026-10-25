# Gate 4.4-A — Google OAuth frontend entry (local-only)

## Scope

- A Google login button **behind `VITE_GOOGLE_OAUTH_ENABLED=true`**, default OFF.
- Dedicated `/auth/google/callback` route; existing `/auth/callback` (email invitation), `/set-password`, `/reset-password` untouched.
- Student invite acceptance route `/google/accept-invitation` calls Gate 4.3 RPC after explicit teacher selection and browser confirmation.
- Existing teacher or linked student goes to existing dashboard.
- No database/edge/config migrations or Production changes.

## Local prerequisite checklist

1. Apply Gates 4.2 and 4.3 migrations **locally** and confirm **459 SQL tests PASS**.
2. Keep Google enabled and the **original** `public.crm_before_user_created_hook` active **locally**. Never point to the removed observer.
3. Ensure `.env.local` has only the **local** `VITE_SUPABASE_URL=http://127.0.0.1:54321` and **local publishable/anon key**. If it points to cloud, stop. Never place a secret/service_role key in `.env.local`.
4. In local `supabase/config.toml` `[auth]`, add **exact** `http://127.0.0.1:3000/auth/google/callback` to `additional_redirect_urls` while keeping existing entries. It should be the URL passed to `redirectTo`. Configure your Google Web OAuth Client to redirect to **Supabase** `http://127.0.0.1:54321/auth/v1/callback` (not this React route).
5. The Google Client Secret stays in a transient environment variable when restarting local Supabase; do not commit it. Never use cloud credentials.
6. Set `VITE_GOOGLE_OAUTH_ENABLED=true` in your **local** `.env.local`. `false` or absent hides Google UI.
7. Run `npx vite --host 127.0.0.1 --port 3000 --strictPort` in the project root. Close the earlier standalone harness if it occupies port 3000.
8. Use an InPrivate window. Test with the **already linked local student** first, then create a new pending invite for another test email via the previously verified flow. For a fresh invitation, acceptance must require explicit teacher selection.
9. Test email/password login, `/auth/callback` email invitation link, `/set-password`, password recovery, and existing account roles separately.

**Do not enable Google in Production.** This is frontend validation, not a security GO/NO-GO.

## Caveats requiring Gate 4.4-B/4.5

- Teacher invitation UI (`google_no_email`, list/revoke) is still to be wired.
- This patch does not harden the old email callback against an intentionally misdirected third-party OAuth callback; audit this case in Gate 4.5 before Production.
- Supabase may automatically link a verified Google identity to an existing email account. Test teacher and student account linking and unchanged UUIDs.
- Testing on localhost:5173 instead requires the exact allowed redirect URL for that origin; the flow uses `window.location.origin`.
- A signed-in Google student without an active teacher link is sent to the invitation screen and cannot accept anything without pending offers. Review route guards in Gate 4.5.

## Local checks

```powershell
node --test scripts/tests/googleOAuthPolicy.test.mjs
npm run lint
npm run build
npm run check:architecture
npx supabase test db --local
```

No migration/reset required to apply this frontend-only patch.
