# Security stage 1.3 — inactivity session sign-out

**Local-only change set; no DB migrations or new dependencies.**

## Policy

- Teacher: 90 minutes after last meaningful interaction with CRM.
- Student: 60 minutes after last meaningful interaction with CRM.
- The blocking, persistent warning appears during the final 2 minutes.
- `Continue session` re-starts the clock only if the session is not already expired.
- Automatic sign-out invokes Supabase `signOut({ scope: "local" })` to leave sessions on other devices unaffected.
- Closing a browser tab does **not** immediately sign out. The stored activity time persists for checking when a tab is reopened.
- Genuine pointer, keyboard, touch and wheel input count; background polling and automatic token refresh do not.
- Tabs sharing the same login share the newest activity via localStorage and storage events. Return-to-tab, focus and periodic checks use real wall-clock time.
- When offline sign-out fails, the CRM is covered by a non-dismissable session-expired screen with a retry button.
- The policy uses the **Supabase user's `last_sign_in_at`** to distinguish newly authenticated sessions from a previous login for that user.

**Security scope:** This is a browser-side inactivity control, not server-side JWT expiry or global session revocation. Direct API calls with still-valid tokens and intentionally manipulated browser storage are outside its guarantee. Configure server Auth session limits separately when appropriate.

## Before deployment

From the project root:

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
```

## Manual acceptance tests

1. Sign in as teacher. Verify normal schedule, finances, materials and assignments behave as before.
2. In DevTools > Application > Local Storage find the key starting with `crm:auth-idle:v1:`. Preserve its `sessionMarker` and change `lastActiveAt` to `Date.now() - 88*60*1000` in the JSON object; reload. The 02:00 warning must appear for the teacher.
3. Click `Continue session`; the warning must close, the current login must remain active and a new activity timestamp must be saved.
4. Change the `lastActiveAt` to `Date.now() - 90*60*1000`; reload. Teacher must automatically sign out. Re-login must succeed normally (new sign-in marker).
5. Sign in as student and repeat the test using 58 minutes for warning and 60 minutes for sign-out.
6. Open two tabs with the same login. Keep interacting with CRM in one and confirm the other does not time out. Stop activity in both, then confirm idle expiry applies in both.
7. Reload/close and reopen a tab before the deadline: session remains. Reopen it after the deadline: user must be logged out. Closing the tab alone must not immediately sign out.
8. While the warning is open, wait until 00:00 without clicking: automatic sign-out occurs. `Continue session` must not resurrect an expired session.
9. If a sign-out fails because of unavailable network, verify that the CRM stays covered by the blocking screen and retry sign-out works after connectivity returns.
10. Confirm Ukrainian, English and Russian texts and repeat the normal manual Log out functionality.

Important: modifying the key in the **same** tab does not generate a `storage` event, so reload the page after changing the timestamp. Use disposable test accounts. Editing this key only changes the local session inactivity clock; it does not change the production database.
