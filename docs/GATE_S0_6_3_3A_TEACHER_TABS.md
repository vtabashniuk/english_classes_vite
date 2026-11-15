# S0.6.3.3a — Teacher Settings tabs (intermediate)

This patch assumes S0.6.3.2 and S0.6.3.2a were merged into main.

- Six tabs: profile, learning, finance, taxes, display, security.
- Existing forms stay mounted in hidden panels so switching tabs does not destroy local draft state.
- Existing ids and legacy hash links are retained; navigating to `#tax-profile` displays the Taxes panel.
- `?tab=` drives direct URL state.
- The Profile panel is read-only email placeholder; profile editing is a later substage.

**NOT production release ready on its own.** Existing forms do not yet report dirty state to the shared guard; leaving settings entirely may still discard unsaved drafts without warning. Complete S0.6.3.3b before merging to production, or do not expose this patch to end users.

Follow-up S0.6.3.3b:
- Add dirty tracking for each existing form including payment instructions across all currencies, password form (boolean only), pagination preferences.
- Protect internal navigation with the shared blocker, and browser unload using beforeunload.
- Make tax parameter date switches safe for unsaved values.
- Add browser regression tests for all dirty-state paths.
