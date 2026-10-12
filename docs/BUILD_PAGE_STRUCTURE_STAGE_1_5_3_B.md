# 1.5.3b — Page structure and route-level code splitting

## Scope
- Moves five root-level pages (plus two matching CSS Modules) into dedicated directories.
- Updates relative imports in AuthCallback, ForgotPasswordPage, ResetPasswordPage.
- Switches page components in `src/router.jsx` to `React.lazy` with a localized `Suspense` loading fallback.
- Keeps all public URLs, layouts, providers, permission checks and business logic unchanged.
- No database or env modifications.

## Apply ZIP archive
Unzip over the project root. **ZIP extraction does not delete old files.** Before running tests and committing, delete the seven obsolete files using Git:

```powershell
git rm src/pages/AboutMePage.jsx
git rm src/pages/AuthCallback.jsx
git rm src/pages/ForgotPasswordPage.jsx
git rm src/pages/ForgotPasswordPage.module.css
git rm src/pages/NotFoundPage.jsx
git rm src/pages/ResetPasswordPage.jsx
git rm src/pages/ResetPasswordPage.module.css
```

The new copies are already contained in the ZIP under `src/pages/<PageName>/`. The Git diff should show the moved files (Git may detect renames). Keep `.env.local` untouched.

## Verify
```powershell
node --test tests/*.test.js
npm run check:architecture
npm run lint
npm run build
```

Use `dist/assets` or build output to verify that Vite produces multiple route chunks. The chunk-size warning may still appear for very large routes; measure before considering further refactoring. Do not adjust the warning threshold to hide it.

## Manual browser control
- `/`, `/about-me`, `/login`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/set-password`, unknown URL.
- Teacher: overview, students, student card, schedule, requests, materials, finance, settings, notifications.
- Student: overview, schedule, profile, assignments, materials, notifications.
- Confirm redirects for unauthenticated and wrong-role visits still work.
- Test password recovery and invitation callbacks using valid test links, where email quota allows; no need to trigger emails merely for this refactor.
- Ensure refreshing a deep route works on Vercel and the new chunks load without 404 errors.

Do not merge until GitHub CI and the targeted manual check pass.
