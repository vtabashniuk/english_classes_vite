# Gate S0.6.3.2 — Settings tabs + unsaved changes foundation

Status: **Prepared, not integrated**. No existing settings page, router, translation, DB schema, or API was modified in this gate.

## New modules

- `src/shared/settings/SettingsTabs.jsx` + CSS: controlled, accessible tab-style navigation. Parent owns active tab and URL.
- `src/shared/settings/settingsTabs.js`: selects supported `?tab=` value, builds a tab query, and maps existing teacher `#anchor` deep links.
- `src/shared/unsavedChanges/useUnsavedChangesGuard.js`: central dirty registry and route blocker (`useBlocker`), plus browser reload/close (`beforeunload`).
- `src/shared/unsavedChanges/UnsavedChangesDialog.jsx` + CSS: confirmation with focus handling; strings supplied by caller for uk/en/ru.
- `src/shared/unsavedChanges/dirtyForms.js`: pure, password-safe dirty-state registry.
- `tests/settingsNavigationInfrastructure.test.js`: five unit tests covering URL helpers and dirty registry.

## Integration contract for Gate S0.6.3.3 / .4

1. At the settings page root, call `const guard = useUnsavedChangesGuard();` (inside `createBrowserRouter` context). Keep the hook mounted while changing tabs.
2. Read `location.search` via `getSettingsTab(location.search, tabs.map(t => t.id))`; write new tab using `navigate({ search: withSettingsTab(location.search, nextTab), hash: "" })`.
3. Render `<SettingsTabs tabs={tabs} activeTab={activeTab} onTabChange={changeTab} label={t("...")} />` and only the active panel. Do not use individual tab buttons that bypass router navigation.
4. Render `<UnsavedChangesDialog open={guard.isPromptOpen} onStay={guard.stay} onLeave={guard.leave} ...translatedProps />` at page root.
5. Each form reports only a unique form ID and boolean via `guard.setFormDirty("teacher.finance", isActuallyDifferentFromLastSaved)`; do not submit form values, personal data or passwords to the registry. Change the boolean to false **only after success**, or after undo returns to the saved baseline. Separate forms use separate IDs. To avoid stale states, unregister a form (`setFormDirty(id, false)`) on unmount where appropriate.
6. Saved baseline should update after successful API response and failed submissions should retain the dirty state. If a form is lazily mounted, its baseline comes from the most recent authoritative data. **Warning:** unmounting an unsaved form upon tab navigation loses its draft after confirmation; the action must clearly state this. If drafts should persist during navigation, keep the panels mounted or persist their state in the page container.
7. Existing hash anchors `#finance-preferences`, `#payment-accounts`, `#tax-profile`, `#tax-parameters` should first open the corresponding tab; once rendered, focus/scroll to the relevant subsection. Handle precedence of legacy hash vs `tab` deliberately. The mapped legacy anchor does not automatically scroll in this foundation.
8. Student route rename (`/student-area/profile` -> `/student-area/settings`) and teacher profile form belong to later stages. Do not rename routes now.
9. `beforeunload` shows the browser's native warning; browsers will not show custom text. `useBlocker` covers React Router navigations; external navigation initiated without the router is not intercepted by the custom dialog.
10. Focus and keyboard behavior require manual browser regression in the integrated pages, including Escape, Shift+Tab, browser Back, refresh and deep link scenarios.

## Future testing matrix

- Dirty forms across every teacher/student tab; reset, save success, save error.
- Multiple currencies of payment instructions and tax-date selection.
- Password form dirty without saving any secrets in shared state.
- Internal navigation, history back, hash navigation, reload, closing browser tab.
- Legacy deep links, invalid tabs, direct tab URLs and locale switching.
- Mobile screen widths; no sidebar or table regressions.

## Local verification

```
node --test tests/settingsNavigationInfrastructure.test.js
npm run check:architecture
node --test tests/*.test.js scripts/tests/*.test.mjs
npm run lint
npm run build
```

No node_modules were included in the source archive. lint and build must be run on the developer machine with installed dependencies.
