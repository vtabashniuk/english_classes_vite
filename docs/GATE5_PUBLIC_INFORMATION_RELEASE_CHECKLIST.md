# Gate 5 — Public Information & Privacy (draft for review)

## Scope

Three unauthenticated routes in the existing Vite/React frontend:

- `/about`: what the invitation-only learning CRM does;
- `/privacy`: how account, learning, financial and technical data are handled;
- `/terms`: account access and service-use rules.

All three pages are translated into Ukrainian, English and Russian, link from the login screen and public footer, and use the existing `PublicLayout`. No database, RLS, Auth Hook, payment or OAuth flow is changed. Public pages use a shared component and locale arrays.

## Code-backed facts verified in the uploaded project

- Teacher and student accounts, invitation-based access, Google/email authentication.
- Lessons, attendance, requests, assignments, materials, notifications, private teacher notes, financial balances and payments.
- Google Sign-In provides basic account metadata; Google Gmail/Drive/Calendar scopes are not used in this feature (verify live Google Cloud settings separately).
- Backend is Supabase Auth/Postgres/Edge Functions; hosting is Vercel; `@vercel/speed-insights` runs in `src/main.jsx`.
- Language preference uses localStorage; temporary Google flow uses sessionStorage; Supabase JS manages auth session storage.
- Materials/meeting links can lead to external services.
- Public contact is set to `vtabashniuk@gmail.com`, matching the Google Cloud Branding support email shown during configuration. **Owner must approve public display.**

## Approval required before releasing these legal pages

1. **Who operates the service?** Confirm the real service operator/data controller (teacher, sole proprietor or other entity) and whether any additional legal name/address/details need to appear. Source code cannot establish this.
2. **Legal basis and jurisdiction.** Check the applicable Ukrainian and/or other privacy regulations for the operator and students; document the actual purpose and legal basis for each data category as required. Draft is intentionally noncommittal where the legal basis is not known.
3. **Data retention.** Confirm retention periods for accounts, lesson history, teacher private notes, finance/tax records, application logs and deleted users. No retention schedule is established by the code audit. Specify periods or precise criteria before publication if required.
4. **Minors.** Confirm how consent/guardian authorization for minor students is gathered and recorded outside the CRM, if needed. The current system does not implement a parent consent workflow.
5. **Requests for access/deletion.** Define who responds to requests, how account identity is checked, and how Supabase Auth, finance records and backups are handled.
6. **Third-party processing.** Check actual Supabase/Vercel/Google regions, processors, DPA, cross-border transfers and performance analytics settings. Avoid unsupported jurisdiction or security guarantees.
7. **Contact.** Approve the public-facing support email. If it changes, update `SUPPORT_EMAIL` in `src/pages/PublicInfoPage/PublicInfoPage.jsx` and Google Branding support contact as appropriate.
8. **Terms.** Verify that lesson cancellation, billing, refunds, rights to materials and access restrictions correspond to agreements with students.
9. **Branding and Google verification.** Confirm new routes work when directly opened in a logged-out/incognito browser on Vercel. The pages are React SPA routes; Google branding review may request separately crawlable/pre-rendered policy HTML and verified domain ownership. Do not claim Google approval based only on these pages.
10. **Privacy impact.** A text-only privacy policy is disclosure, not consent collection or automated deletion. If additional functionality is legally required, plan it separately.

## Suggested local QA

```powershell
node --test tests/pagesRouteBoundary.test.js tests/publicInformationRoutes.test.js
npm run lint
npm run check:architecture
npm run build
```

Manually test direct navigation to `/about`, `/privacy`, `/terms` without a session, language switching UA/EN/RU, and keyboard focus for the footer and login links; test on mobile and desktop in light/dark mode. Verify Google and email sign-in regression separately before deployment.

## Deployment policy

Commit only reviewed Gate 5 source changes. Create feature branch, PR, run CI and deploy through main after approval. No Production configuration changes, migrations or Supabase deployments needed for these pages. Leave Google Auth Provider and Vercel OAuth flag as currently configured.
