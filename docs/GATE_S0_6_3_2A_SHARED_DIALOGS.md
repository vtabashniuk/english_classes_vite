# Gate S0.6.3.2a — Shared dialogs foundation

## Scope

- New `src/shared/dialog/Dialog.jsx` and CSS module: portal, focus trapping, focus restoration, accessible labels, Escape handling (if allowed), responsive layout. No backdrop-click dismissal.
- New `ConfirmDialog`: configurable normal/destructive confirmation with distinct cancel/confirm labels; cancel receives focus first.
- New `DialogProvider` and `useConfirmDialog`: Promise<boolean> confirmation helper; queue of concurrent confirmation requests; pending promises resolve `false` on provider removal. Strings are supplied through existing i18n (`t(...)`) by callers.
- Existing, **not-yet-integrated** `UnsavedChangesDialog` from Gate S0.6.3.2 is now a thin adapter around `ConfirmDialog`.
- Security-sensitive `SessionInactivityGuard` unchanged.

## Not activated yet

The app root is **not** wrapped with `DialogProvider` in this infrastructure-only stage, and the existing 16 `window.confirm` calls stay unchanged. Provider integration and migration occur in subsequent, independently tested stages. The new shared unsaved-changes dialog will appear when the settings pages are integrated in S0.6.3.3/4.

Future integration example (within `DialogProvider`):

```jsx
const confirm = useConfirmDialog();
const accepted = await confirm({
  title: t("...title"),
  description: t("...description"),
  confirmLabel: t("...confirm"),
  cancelLabel: t("...cancel"),
  variant: "danger",
});
if (!accepted) return;
// Existing business action runs only on explicit confirmation.
```

## Checks

```
node --test tests/settingsNavigationInfrastructure.test.js tests/settingsDialogFoundation.test.js
npm run check:architecture
npm run lint
npm run build
```

After verification, stage, commit and PR only the 2a delta. Database, Edge Functions and Production remain unchanged until approval/merge. Manual checks during integration: Escape cancels, Tab/Shift+Tab loop, focus restored, mobile sizing, UA/EN/RU labels, navigation blockers, session timeout precedence.
